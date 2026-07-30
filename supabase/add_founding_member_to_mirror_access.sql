-- add_founding_member_to_mirror_access.sql
-- ── Founding Elite cohort flag on mirror_access ──────────────────────────────
--
-- Context: Founding Elite is NOT a fourth product_tier. It is a pricing/cohort
-- offer layered on top of product_tier='elite' — identical capabilities, see
-- lib/founding.ts. This migration adds the one column needed to record cohort
-- membership. Feature gating must continue to read ONLY product_tier /
-- access_type, never this column — lib/ai-client.ts and lib/mirror-access.ts
-- are both deliberately untouched by this change.
--
-- founding_member is permanent once set. A cancelled or expired founding
-- subscription keeps founding_member = true — this is cohort membership,
-- not a billing-status mirror. lib/founding.ts's cap count relies on this:
-- it counts every row ever marked true, so a lapsed member's seat is never
-- reclaimed. (If that's not the intended product behaviour, change the
-- count query in lib/founding.ts, not this column.)
--
-- Zero paying users today — no backfill/grandfathering concerns.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE mirror_access
  ADD COLUMN IF NOT EXISTS founding_member BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN mirror_access.founding_member IS
  'Founding Elite cohort marker (₹999/mo, cap 20 — see lib/founding.ts). Orthogonal to product_tier: founding members have product_tier=elite with identical features. Permanent once true; never cleared on cancellation/expiry.';
