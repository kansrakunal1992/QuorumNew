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

// Institutional layer master kill switch (Institutional Sprint 1).
// Same pattern as isWatchlistEnabled() above: one NEXT_PUBLIC_ var, default
// OFF when unset, read identically client and server, baked in at build
// time (redeploy required after changing it in Railway).
//
// Difference from the Watchlist precedent: this flag gates real permission
// logic — institution/membership rows, code redemption, admin routes — not
// just a UI surface. So every institution-related API route checks this
// server-side too, not just the client hiding the badge/switcher. See
// app/api/institutions/redeem/route.ts and
// app/api/admin/create-institution/route.ts.

export function isInstitutionalModeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_INSTITUTIONAL_MODE_ENABLED === 'true'
}
