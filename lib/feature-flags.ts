// lib/feature-flags.ts
// Sprint W1 — feature flags controlled via Railway environment variables.
//
// Deliberately a single NEXT_PUBLIC_-prefixed var, used identically from both
// server and client code. NEXT_PUBLIC_ is required for anything read in a
// 'use client' component (app/page.tsx, SessionView.tsx) — Next.js inlines
// NEXT_PUBLIC_ vars into the client bundle at build time. Server-only code
// (API routes) can read the same var just fine via process.env, so there's
// no need for a second, unprefixed variable for the same concept — one flag,
// one name, checked the same way everywhere.
//
// Default is OFF when unset, matching how every other feature-flag-shaped
// decision in this codebase has defaulted (safer for a new, user-facing
// surface — see ADVISORY_BYPASSES_THRESHOLDS in lib/mirror-tier-config.ts
// for the same pattern).
//
// To enable in Railway: set NEXT_PUBLIC_WATCHLIST_ENABLED=true on the
// service, then redeploy (NEXT_PUBLIC_ vars are baked in at build time, so a
// plain restart without a rebuild will NOT pick up a change to this var).

export function isWatchlistEnabled(): boolean {
  return process.env.NEXT_PUBLIC_WATCHLIST_ENABLED === 'true'
}
