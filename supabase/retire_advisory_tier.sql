-- retire_advisory_tier.sql
-- ── Advisory tier retirement (Phase 6) ────────────────────────────────────────
--
-- Context: Advisory's five feature advantages over Mirror/Elite (Peer
-- Benchmark, SRI "Next Move", full Contradiction Detector detail, and the
-- Rules/Contradiction/Graph session-count threshold bypass) have been folded
-- into Elite in application code — see components/SessionReliabilityIndex.tsx,
-- components/ContradictionDetector.tsx, components/DecisionRules.tsx,
-- app/api/mirror/rules/route.ts, app/api/mirror/graph/route.ts,
-- app/mirror/page.tsx. This migration retires the one piece of Advisory
-- infrastructure that was DB-backed: the "request access to Advisory" queue.
--
-- What's NOT touched, deliberately:
--   - mirror_access.access_type still allows 'advisory' as a valid value.
--     It stays meaningful as a PROVENANCE marker — "this access was manually
--     granted, not a self-serve Razorpay subscription" — distinct from
--     feature access (which is now uniform with 'elite'/'mirror'). It also
--     still drives the non-cancellable-via-self-service behavior in
--     app/api/payment/cancel-subscription/route.ts, which is an operational
--     lock, not a feature, and was explicitly NOT folded into Elite.
--   - lib/types.ts's MirrorTier = 'mirror' | 'advisory' is unchanged for the
--     same reason.
--   - Existing 'advisory' mirror_access rows (none currently — zero paying
--     users) are left as-is; they simply get uniform Elite-level features
--     going forward, same as before this migration, just no longer via a
--     tier-specific code branch.
--
-- Run this once in the Supabase SQL Editor. Safe to re-run (IF EXISTS guards).
-- ─────────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS advisory_access_requests;

COMMENT ON COLUMN mirror_access.access_type IS
  'How this access was provisioned: monthly/annual (self-serve Razorpay), advisory (manually granted — provenance only since Phase 6, no longer a distinct feature tier; see retire_advisory_tier.sql).';
