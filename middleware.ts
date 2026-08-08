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
// middleware only adds tier information when a valid token is present; a
// missing/invalid token just means no tier header gets set, and
// ai-client.ts's resolveProvider() falls back to 'free'. Never blocks or
// redirects a request.
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
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase'
import { getProductTier, FREE_TIER } from '@/lib/product-tier'

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

  try {
    const token = authHeader.slice(7).trim()
    const anon  = createClient()
    const { data: { user } } = await anon.auth.getUser(token)

    if (user) {
      const tierInfo = await getProductTier(user.id)
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
    }
  } catch (err) {
    // Never block a request over a tier-resolution hiccup — fall through to
    // 'free' (ai-client.ts's conservative default) rather than failing every
    // API call because of an auth/DB blip here.
    console.error('[middleware] tier resolution failed (non-fatal):', err)
  }

  return NextResponse.next({ request: { headers: requestHeaders } })
}
