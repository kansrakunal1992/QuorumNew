// lib/tier-context.ts
// ── Explicit product-tier override (batch/cron routes only) ──────────────────
//
// For a normal per-user request, tier resolution is fully automatic and
// needs nothing from this file: middleware.ts resolves the caller's tier
// once per request and stamps it onto request headers; lib/ai-client.ts
// reads those back via next/headers. No route handler or lib/*.ts function
// needs to know this file exists.
//
// This file exists for the one case middleware structurally cannot cover:
// cron/batch routes (app/api/cron/daily-nudge/route.ts,
// app/api/cron/reanalyze-email/route.ts, and any future batch job) that
// process MANY users in a single request. Middleware resolves a tier for
// the incoming request — but a cron trigger is one request fanning out to
// many different users' data, so there is no single tier for it to resolve.
// For those routes, call runWithTier() explicitly, PER USER, INSIDE THE
// LOOP — resolve that iteration's user's tier via getProductTier(userId)
// from lib/product-tier.ts, then wrap that iteration's AI-calling logic in
// runWithTier(). Not yet wired into daily-nudge/reanalyze-email — flagged as
// an open follow-up rather than guessed at, since it needs each file's
// actual call chain traced first.
//
// AsyncLocalStorage is what makes runWithTier() work without threading a
// tier param through every nested lib function's signature — set once per
// iteration, readable by any async call downstream via getCurrentTier(),
// however deeply nested (bias-scorer.ts, contradiction-detector.ts,
// structural-retrieval.ts, ontology-tagger.ts, etc. never need to change).
//
// Precedence in ai-client.ts's resolveProvider(): a context set here always
// wins over headers — so a batch route's per-user wrap is never shadowed by
// whatever tier its own trigger request happens to carry.
//
// If neither this context nor headers are set, ai-client.ts's
// resolveProvider() falls back to 'free' — a deliberately conservative
// default: an un-wired call site under-serves (cheapest tier) rather than
// accidentally over-serving a free user with Elite/Private-tier models.
// ─────────────────────────────────────────────────────────────────────────────

import 'server-only'
import { AsyncLocalStorage } from 'async_hooks'
import type { ProductTierInfo } from './product-tier'

const storage = new AsyncLocalStorage<ProductTierInfo>()

/**
 * runWithTier — wrap a route handler's (or a single loop iteration's) logic
 * so any AI call made within fn() resolves to this tier.
 */
export function runWithTier<T>(tierInfo: ProductTierInfo, fn: () => Promise<T>): Promise<T> {
  return storage.run(tierInfo, fn)
}

/** getCurrentTier — read the tier set by the nearest enclosing runWithTier(). */
export function getCurrentTier(): ProductTierInfo | undefined {
  return storage.getStore()
}
