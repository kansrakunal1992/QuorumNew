// lib/decision-session-cors.ts
// ── CORS helper for /api/decision-session/* ──────────────────────────────────
//
// Every other API route in this app is only ever called same-origin (the
// Next.js app calling its own API) or server-to-server (Razorpay's webhook).
// The Decision Session routes are the first exception: they're called
// directly from the browser on the separate marketing-website origin
// (quorumvault.org calling app.quorumvault.org), so — unlike everywhere
// else in this codebase — they need explicit CORS headers or the browser
// will block the response before client-side JS ever sees it.
//
// Kept as a small shared helper rather than duplicated inline in both route
// files, and deliberately its own file rather than folded into an existing
// lib — nothing else in this app needs CORS, and it should be obvious at a
// glance which routes are the (intentional) exception.
//
// Env var:
//   WEBSITE_ORIGIN — comma-separated list of allowed origins.
//     Defaults to https://quorumvault.org,https://www.quorumvault.org
//     if unset, so this works out of the box without a Railway change.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_ORIGINS = 'https://quorumvault.org,https://www.quorumvault.org'

function allowedOrigins(): string[] {
  return (process.env.WEBSITE_ORIGIN ?? DEFAULT_ORIGINS)
    .split(',')
    .map(o => o.trim())
    .filter(Boolean)
}

// Returns the CORS headers to attach to a response. If the request's Origin
// header isn't on the allow-list, omits Access-Control-Allow-Origin
// entirely — the browser will then block the response, which is the
// correct behavior (fail closed, not open to '*').
export function corsHeaders(requestOrigin: string | null): HeadersInit {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  }
  if (requestOrigin && allowedOrigins().includes(requestOrigin)) {
    headers['Access-Control-Allow-Origin'] = requestOrigin
  }
  return headers
}
