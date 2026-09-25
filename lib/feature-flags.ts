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

// Context Ingestion master kill switch — same pattern as the two flags above:
// one NEXT_PUBLIC_ var, default OFF when unset, checked identically client
// and server, baked in at build time (redeploy required after changing it).
//
// Like isInstitutionalModeEnabled(), this gates real logic (Elite-tier check,
// extraction pipeline, encrypted storage), not just a UI surface — every
// app/api/context-ingestion/* route checks this server-side in addition to
// the client hiding the entry points in ProfileCaptureOverlay/Mirror/Settings.
//
// To enable in Railway: set NEXT_PUBLIC_CONTEXT_INGESTION_ENABLED=true on
// the service, then redeploy.

export function isContextIngestionEnabled(): boolean {
  return process.env.NEXT_PUBLIC_CONTEXT_INGESTION_ENABLED === 'true'
}

// Whether an accepted context-ingestion fact is allowed to override a
// conflicting structured UserProfile field (archetype/fears/life_stage/
// risk_stance) inside buildCouncilContext(). Server-only — never read from a
// client component — so no NEXT_PUBLIC_ prefix. Default OFF: imported facts
// stay strictly supplementary; explicit profile picks always win.
//
// To allow override in Railway: set CONTEXT_INGESTION_ALLOW_PROFILE_OVERRIDE=true.

export function contextIngestionCanOverrideProfile(): boolean {
  return process.env.CONTEXT_INGESTION_ALLOW_PROFILE_OVERRIDE === 'true'
}

// Unified session experience — same pattern as the three flags above: one
// NEXT_PUBLIC_ var, default OFF when unset, checked identically client and
// server, baked in at build time (redeploy required after changing it).
//
// This is a presentation-layer flag, not a reasoning-layer one. When ON:
//   - Examiner renders at the top of the session, before Council/Synthesis,
//     instead of after Synthesis/Validation/EarlyEcho/MirrorEcho/RuleRecall
//     (see SessionView.tsx — the old position is suppressed, not duplicated).
//   - The six-persona grid ("Council") is still generated exactly as today —
//     nothing changes in app/api/persona/route.ts — but it renders collapsed
//     behind a "See how Quorum got here" disclosure instead of always-open.
//     Hidden by default, never removed: a user who wants to inspect the
//     six perspectives still can, one click away.
//   - The Mirror calibration gate (getMirrorAccessState) is bypassed in
//     app/api/mirror/calibration/route.ts so free-tier sessions can see
//     their own pre/retro confidence delta from session one, not only
//     after 3 sessions on Elite.
//
// To enable in Railway: set NEXT_PUBLIC_UNIFIED_SESSION_ENABLED=true on the
// service, then redeploy.

export function isUnifiedSessionEnabled(): boolean {
  return process.env.NEXT_PUBLIC_UNIFIED_SESSION_ENABLED === 'true'
}

// ── Natural Intake — master kill switch (Natural Intake Sprint 1, v1) ───────
// Same pattern as every flag above: one NEXT_PUBLIC_ var, default OFF when
// unset, checked identically client and server, baked in at build time
// (redeploy required after changing it in Railway).
//
// When ON:
//   - app/page.tsx renders the new chat entry point (components/ChatIntake.tsx)
//     instead of the classic decision-input form in HomeClient.tsx. The
//     classic form is untouched and still exists — a user only ever sees
//     one or the other, decided by this flag, never both.
//   - The checkpoint screen (components/DecisionCheckpoint.tsx) runs after
//     the chat, reusing the EXISTING /api/session (→ ontology tagger) and
//     /api/examiner pipeline exactly as the classic flow does — no second
//     structural-analysis or bias-scoring code path is created.
//   - app/api/examiner/route.ts's derive-and-confirm check (see
//     lib/examiner-derive.ts) only runs for sessions with intake_mode ===
//     'chat'. A classic-flow session's Examiner behaviour is byte-for-byte
//     unchanged, flag on or off.
//   - Six mechanical Mirror/outcome-tracking queries additionally match on
//     commitment_captured_at rather than only status = 'completed' (see
//     docs/MIRROR_TOUCHPOINTS_v1.md) — this half of the fix is NOT gated by
//     this flag, since it only ever widens eligibility (a session that
//     already matched status = 'completed' still matches), so it's safe to
//     ship active even before the flag is flipped on anywhere.
//
// To enable in Railway: set NEXT_PUBLIC_NATURAL_INTAKE_ENABLED=true on the
// service, then redeploy.

export function isNaturalIntakeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_NATURAL_INTAKE_ENABLED === 'true'
}

// ── Natural Intake — connector sub-flags (Phase 2–4) ─────────────────────────
// Each external connector clears its own approval process on its own
// timeline (Slack Marketplace review, Google verification, Microsoft
// publisher checks) — a single flag would force hiding a connector that's
// ready or exposing one that isn't. Same pattern as the master flag; each
// is meaningful only when isNaturalIntakeEnabled() is also true — every
// connector call site checks both, not just its own sub-flag.
//
// No code in this v1 drop reads these yet (Slack/Gmail/Outlook/WhatsApp
// ship in Phases 2–4). Defined now so Phase 2 doesn't need a second flags
// migration, and so Railway's env var list is set up once.

export function isSlackConnectorEnabled(): boolean {
  return isNaturalIntakeEnabled() && process.env.NEXT_PUBLIC_SLACK_CONNECTOR_ENABLED === 'true'
}

export function isGmailConnectorEnabled(): boolean {
  return isNaturalIntakeEnabled() && process.env.NEXT_PUBLIC_GMAIL_CONNECTOR_ENABLED === 'true'
}

export function isOutlookConnectorEnabled(): boolean {
  return isNaturalIntakeEnabled() && process.env.NEXT_PUBLIC_OUTLOOK_CONNECTOR_ENABLED === 'true'
}

export function isWhatsAppShareEnabled(): boolean {
  return isNaturalIntakeEnabled() && process.env.NEXT_PUBLIC_WHATSAPP_SHARE_ENABLED === 'true'
}
