// lib/tier-forward.ts
// ── Internal tier-header propagation ─────────────────────────────────────────
//
// middleware.ts resolves a user's product tier once per inbound request
// (from their Authorization Bearer token) and stamps it onto request headers
// (x-product-tier, x-user-id, x-private-model-family, x-model-route-fast,
// x-model-route-premium, x-private-endpoint) for lib/ai-client.ts to read
// back via next/headers — with ZERO wiring needed, for any AI call made
// directly inside a matched route's own handler.
//
// That guarantee breaks the moment a route kicks off a SEPARATE internal
// fetch() to another route — e.g. app/api/session/route.ts's
// fireOntologyTagger() → POST /api/ontology, or /api/ontology's own
// fireStructuralMatch() → POST /api/structural-match, or
// app/api/examiner/route.ts's fireBiasScore()/fireContradictions() →
// POST /api/bias-score / /api/mirror/contradictions. Each of those fetch()
// calls is a BRAND NEW HTTP request that middleware.ts sees fresh. They
// authenticate with x-internal-secret (or nothing at all) rather than a
// user's Authorization Bearer token, so middleware's "no Bearer token"
// branch just forwards the request unchanged — it never re-resolves a tier
// for it. Downstream, ai-client.ts's getTierFromHeaders() finds no
// x-product-tier header and falls back to 'free', SILENTLY, regardless of
// the original caller's real tier.
//
// Confirmed live (2026-08-05/06, session ade37bc2-1cff-4d7e-a408-4d86d5ded0d5
// and earlier session 9e1239d7): repeated "no x-product-tier header on a
// tiered-routing-eligible request" warnings paired with mistral-cloud
// createCompletion calls for what should have been an Elite session's
// ontology-tagger / bias-scorer / structural-match / contradiction-detector
// calls — all four of those run through exactly this kind of internal hop.
//
// FIX: forwardTierHeaders() copies the CURRENT request's already-resolved
// tier headers onto the outbound internal fetch's own header set.
// middleware.ts's "no Bearer token → forward headers unchanged" branch means
// these manually-set headers survive untouched to the next hop's route
// handler, so ai-client.ts reads them back exactly as if middleware had
// resolved them itself on that hop too. Call this at EVERY internal fetch()
// hop that may (even transitively, several hops deep) end up calling
// createCompletion/createStream — each hop must re-forward what IT received,
// since middleware only ever forwards what's already on a header-only
// (non-Bearer) request rather than re-deriving it.
//
// This intentionally mirrors lib/tier-context.ts's AsyncLocalStorage
// override for cron/batch routes — same goal (make sure ai-client.ts's
// resolveProvider() sees the right tier), different mechanism, because
// AsyncLocalStorage context does not cross an HTTP fetch() boundary the way
// it crosses a plain nested function call. Headers are the only thing that
// does.
// ─────────────────────────────────────────────────────────────────────────────

const TIER_HEADER_NAMES = [
  'x-product-tier',
  'x-user-id',
  'x-private-model-family',
  'x-model-route-fast',
  'x-model-route-premium',
  'x-private-endpoint',
] as const

/**
 * forwardTierHeaders — read the tier headers already present on `source`
 * (the CURRENT request's own headers — pass the `req.headers` a route
 * handler already has in scope) and return only the ones present, ready to
 * spread into an outbound internal fetch()'s `headers` object.
 *
 * @example
 *   fetch(`${baseUrl}/api/ontology`, {
 *     method:  'POST',
 *     headers: {
 *       'Content-Type':     'application/json',
 *       'x-internal-secret': internalSecret,
 *       ...forwardTierHeaders(req.headers),
 *     },
 *     body: JSON.stringify({ sessionId }),
 *   })
 */
export function forwardTierHeaders(source: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of TIER_HEADER_NAMES) {
    const v = source.get(name)
    if (v) out[name] = v
  }
  return out
}
