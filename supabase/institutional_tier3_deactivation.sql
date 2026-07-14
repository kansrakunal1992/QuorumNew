-- ─────────────────────────────────────────────────────────────────
-- QUORUM INSTITUTIONAL LAYER — Tier 3: institution deactivation
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- Run AFTER supabase/institutional_sprint6_bias_parameter_view.sql
--
-- Deliberate scope decision: this adds SOFT deactivation only, not hard
-- deletion. Reasoning:
--   - Reversible — a deactivated institution can be reactivated; a deleted
--     one cannot.
--   - Doesn't destroy historical consent_audit_log / aggregate-eligible
--     data that may still be legitimately needed for audit or compliance
--     purposes even after an institution stops actively operating.
--   - Hard-delete of an institution with active members, cohorts, and
--     consent history is a materially more hazardous operation (cascading
--     deletes across institution_memberships, cohorts, consent_audit_log,
--     seen_unlock_notices, user_institution_preference) that deserves its
--     own explicit decision and almost certainly its own extra
--     confirmation UI, not a "while I'm here" addition to this migration.
-- If hard-delete is genuinely wanted later, that's a separate, deliberate
-- piece of work — not assumed here.
-- ─────────────────────────────────────────────────────────────────

alter table institutions add column if not exists deactivated_at timestamptz;

-- A deactivated institution's existing members keep their data and their
-- consent settings exactly as they were — deactivation only blocks NEW
-- redemptions (enforced in app/api/institutions/redeem/route.ts) and hides
-- the institution from the founder's active-institutions view. It does not
-- retroactively change anyone's consent, delete anything, or remove
-- anyone's membership.
