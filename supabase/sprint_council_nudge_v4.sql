-- ─────────────────────────────────────────────────────────────────────────────
-- Natural Intake v4 — "your decision is still open" nudge
--
-- One new column: stamps the session once the stall nudge has gone out, so the
-- same session is never nudged twice (same pattern as
-- sessions.validation_nudge_sent_at from sprint_nudge_infra.sql).
--
-- Run once. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

alter table sessions
  add column if not exists council_nudge_sent_at timestamptz;

-- The cron's candidate query filters on (created_at window, not yet nudged).
create index if not exists idx_sessions_council_nudge_candidates
  on sessions (created_at)
  where council_nudge_sent_at is null and quorum_predicted_choice is not null;
