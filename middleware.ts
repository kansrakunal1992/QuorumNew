// middleware.ts
// ── Product-tier resolution middleware ───────────────────────────────────────
//
// Runs before every matched request (see config.matcher below). Reads the
// user's Bearer token — the same auth scheme every route already uses — and
// resolves their product tier (free/elite/private), any TD-LD-11 per-user
// routing override, and their user id, via the same mirror_access table
// lib/product-tier.ts's getProductTier() reads. Stamps the result onto
// request headers (x-user-id, x-product-tier, x-private-model-family,
// x-model-route-fast, x-model-route-premium) and forwards the request
// unmodified otherwise.
//
// This is what lets lib/ai-client.ts's tiered routing (TIERED_ROUTING_ENABLED)
// work with ZERO changes to any of the 15 AI call sites or their route
// handlers — ai-client.ts reads these headers back via next/headers, however
// deeply the actual createCompletion/createStream call is nested.
//
// Does NOT enforce auth — each route already does its own 401 check. This
// middleware only adds tier information when a valid token is present.
// Product decision (confirmed 2026-08): if tier resolution can't be
// completed for any reason — including for an authenticated, paying
// customer — the request is still allowed through on the free tier rather
// than blocked or delayed. A brief, occasional quality downgrade during a
// genuine backend hiccup is preferable to an outage; this middleware will
// never fail a request open into an error. See the retry + explicit-
// fallback logic below for how the *silent* and *unexplained* parts of that
// downgrade (not the downgrade itself) were closed.
//
// Runtime: Edge (this project is on Next.js 15.2.8 — Node.js middleware
// runtime needs 15.5+). Supabase's JS client is fetch-based and Edge-safe;
// this is the standard supported pattern for Supabase auth in Next.js
// middleware, so no runtime constraint is actually hit here.
//
// Structural exception — cron/batch routes: daily-nudge and reanalyze-email
// are deliberately excluded from the matcher below. They're triggered by a
// scheduler (not a per-end-user request) and loop over many users
// internally — there is no single "the user" for this middleware to resolve
// a tier for. Those routes use lib/tier-context.ts's explicit per-iteration
// override instead (see that file's doc comment; not yet wired in — flagged
// as an open follow-up).
//
// Also excluded: /api/payment/webhook (Razorpay signature auth, no user
// Bearer token) and /api/admin/* (x-admin-key auth) — neither makes AI calls
// that need tiering, and neither carries a user Bearer token to resolve.
//
// Root-cause fix (2026-08): the original incident this file's history refers
// to (an authenticated Elite customer's synthesis call silently landing on
// free-tier routing, confirmed via logs 2026-08-05) traced to two distinct
// gaps in the `if (authHeader?.startsWith('Bearer '))` branch below, neither
// of which is "the AI provider itself failing" — that class of fallback
// (Claude erroring, handled inside lib/ai-client.ts, not here) was already
// fine and is intentionally left as-is per the product decision above:
//
//   1. `anon.auth.getUser(token)` can return no user for reasons that have
//      nothing to do with whether the customer is real or paying — a
//      transient Supabase Auth API blip, a token mid-refresh, brief clock
//      skew. When that happened, the `if (user)` block below was skipped
//      entirely, and — unlike the no-token branch just above it — NO tier
//      header was set at all, explicit or otherwise. ai-client.ts's own
//      undefined-tier fallback then landed on 'free' with zero signal that
//      this was a resolution failure rather than a genuine anonymous visitor.
//   2. `getProductTier(user.id)` is a DB read; a transient DB blip (or, for
//      a customer who just upgraded, replication lag right after their
//      webhook fired) throwing here fell into the outer `catch` block, which
//      only logged an error — again with no tier header set at all.
//
// Both paths now get one quick, unconditional retry (no backoff — this is
// Edge middleware, not a background job; a single immediate retry is cheap
// and the whole point is that these are usually transient) before being
// treated as a real failure, and BOTH now fall through to an *explicit*
// `x-product-tier: free`, exactly like the no-token branch already did —
// so ai-client.ts's warning always fires from a deliberate, known state
// rather than an ambiguous unset header. Critically, the log line for this
// path is distinct from the no-token path's (see hadToken below), so an
// authenticated resolution failure is never confused with ordinary
// anonymous traffic again.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase'
import { getProductTier, FREE_TIER, type ProductTierInfo } from '@/lib/product-tier'
import type { User } from '@supabase/supabase-js'

export const config = {
  matcher: [
    '/api/persona/:path*',
    '/api/examiner/:path*',
    '/api/session/:path*',
    '/api/record/:path*',
    '/api/mirror/:path*',
    '/api/case-study/:path*',
    '/api/voice/:path*',
    '/api/structural-match/:path*',
    '/api/ontology/:path*',
    '/api/bias-score/:path*',
    // Bug fix (2026-08-06): this whole route family was missing entirely.
    // lib/context-extractor.ts (used by both routes below) calls
    // createCompletion directly, and Context Ingestion is an Elite-only
    // feature — but since neither route was ever matched here, this
    // middleware never ran for them at all, regardless of what the client
    // sent, so tier resolution never happened and every call silently fell
    // back to Free-tier Mistral routing for every user, Elite or not.
    '/api/context-ingestion/:path*',
  ],
}

// One quick, unconditional retry — no delay. Edge middleware runs on a very
// tight execution budget, so this is deliberately not the same
// wait-then-retry pattern used for background/cron work elsewhere in this
// codebase; it exists purely to absorb a single transient blip, not to wait
// out a sustained outage (a sustained outage should — and will — just fall
// through to the explicit free-tier default below, immediately).
async function withQuickRetry<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt()
  } catch {
    return attempt()
  }
}

export async function middleware(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const requestHeaders = new Headers(req.headers)

  if (!authHeader?.startsWith('Bearer ')) {
    // No token — not this middleware's job to enforce auth. Genuinely
    // unauthenticated traffic (unlinked users, first-decision-before-signup
    // flows) is expected and legitimate — but it must still get an explicit
    // tier header, not just "no header at all".
    //
    // Bug fix (2026-08-08): this branch used to forward with no tier header
    // set, relying on ai-client.ts's undefined-tier fallback to land on
    // 'free' anyway. Functionally harmless (anonymous users are free tier),
    // but it made lib/ai-client.ts's getTierFromHeaders() warning fire on
    // every single anonymous request — identical to what a genuine paid-tier
    // resolution failure logs (see that function's doc comment, which
    // already assumed this header was always set explicitly and was wrong
    // about it). Confirmed via logs 2026-08-07, session 5b63b9fb: every
    // AIClient call for one ordinary anonymous free-tier session logged that
    // warning, which is exactly the kind of signal that should be reserved
    // for "middleware ran but resolution actually failed". Setting it
    // explicitly here turns a fully-missing header back into a real anomaly.
    requestHeaders.set('x-product-tier', FREE_TIER.tier)
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  // hadToken=true from here on — a resolution failure below is a real
  // anomaly worth distinct logging, not the expected anonymous-visitor case
  // handled above.
  let user: User | null = null
  let tierInfo: ProductTierInfo | null = null
  let resolutionError: unknown = null

  try {
    const token = authHeader.slice(7).trim()
    const anon  = createClient()

    const { data } = await withQuickRetry(() => anon.auth.getUser(token))
    user = data.user

    if (user) {
      tierInfo = await withQuickRetry(() => getProductTier(user!.id))
    }
  } catch (err) {
    resolutionError = err
  }

  if (user && tierInfo) {
    requestHeaders.set('x-user-id', user.id)
    requestHeaders.set('x-product-tier', tierInfo.tier)
    if (tierInfo.privateModelFamily) {
      requestHeaders.set('x-private-model-family', tierInfo.privateModelFamily)
    }
    // TD-LD-10/TD-LD-11 per-user routing override — see lib/product-tier.ts
    // and lib/ai-client.ts's resolveProvider() for how these are checked
    // before the tier's default model mapping.
    if (tierInfo.modelRouteFast) {
      requestHeaders.set('x-model-route-fast', tierInfo.modelRouteFast)
    }
    if (tierInfo.modelRoutePremium) {
      requestHeaders.set('x-model-route-premium', tierInfo.modelRoutePremium)
    }
    // Per-customer Private tier deployment (baseUrl/apiKey/models) — one
    // header, JSON-encoded, rather than four separate ones. This never
    // leaves the server: Next.js only forwards request headers set here to
    // the downstream route handler in the same process, never back to the
    // browser. See lib/product-tier.ts's PrivateEndpoint doc comment.
    if (tierInfo.privateEndpoint) {
      requestHeaders.set('x-private-endpoint', JSON.stringify(tierInfo.privateEndpoint))
    }
  } else {
    // Tier resolution genuinely could not complete for an authenticated
    // request, even after one retry each on getUser and getProductTier.
    // Per the product decision documented above, still let the request
    // through rather than failing it — just fall through to free explicitly
    // (never a silently-unset header) and log this distinctly from the
    // no-token branch above, since — unlike that branch — this one really
    // is a signal something needs attention. `!user` (auth/token-level
    // failure) and `user && !tierInfo` (DB-level failure, post-auth) are
    // logged separately since they point at different systems to check.
    if (!user) {
      console.error(
        '[middleware] authenticated request but getUser() returned no user after retry — falling back to free tier',
        resolutionError,
      )
    } else {
      console.error(
        '[middleware] authenticated as user', user.id,
        'but getProductTier() failed after retry — falling back to free tier',
        resolutionError,
      )
    }
    requestHeaders.set('x-product-tier', FREE_TIER.tier)
  }

  return NextResponse.next({ request: { headers: requestHeaders } })
}
