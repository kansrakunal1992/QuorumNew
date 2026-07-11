-- ─────────────────────────────────────────────────────────────────────────────
-- QUORUM — Sprint: Daily Nudge
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- Safe to re-run: all statements use IF NOT EXISTS / IF NOT EXISTS pattern.
--
-- Two changes:
--   1. Add daily_nudge_opted_out column to user_preferences (one-click unsub)
--   2. Create daily_nudge_log table (dedup + analytics)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. user_preferences: opt-out column ──────────────────────────────────────
-- Added here rather than in a new table so the cron can check it in a single
-- .in() + .eq() query without an extra join.

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS daily_nudge_opted_out boolean NOT NULL DEFAULT false;

-- ── 2. daily_nudge_log ───────────────────────────────────────────────────────
-- One row per send. Used for:
--   • 22-hour dedup window (prevents double-fire on cron drift)
--   • variant_index analytics — which copy variant drove returns at 20+ users
--     TD: review copy mix at 20-user corpus milestone (see HANDOVER_DOC TD-*)

CREATE TABLE IF NOT EXISTS daily_nudge_log (
  id            uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       uuid        REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  sent_at       timestamptz NOT NULL DEFAULT now(),
  variant_index smallint    NOT NULL    -- NUDGE_VARIANTS index 0-29
);

-- Composite index: fast lookup by (user_id, sent_at) for cooldown check
CREATE INDEX IF NOT EXISTS idx_daily_nudge_log_user_sent
  ON daily_nudge_log (user_id, sent_at DESC);

ALTER TABLE daily_nudge_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Daily nudge log accessible via service role"
  ON daily_nudge_log FOR ALL USING (true);
