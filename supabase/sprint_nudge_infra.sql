-- supabase/sprint_nudge_infra.sql
-- ── Shared nudge infrastructure ──────────────────────────────────────────────
-- Run once in Supabase SQL Editor before deploying the matching code.
--
-- Covers:
--   1. notification_log    — shared cross-cron gate (daily-nudge + validation-nudge
--                             share one rolling clock so they can't both contact the
--                             same user back-to-back; reanalyze-email is deliberately
--                             NOT part of this — its milestone emails are scarce by
--                             design and would be silently lost rather than retried)
--   2. user_preferences     — validation_nudge_opted_out (own opt-out, separate from
--                             daily_nudge_opted_out) + the daily-nudge decaying
--                             sequence state (lapse_sequence_step, lapse_anchor_session_at,
--                             lapse_sequence_last_sent_at)
--   3. sessions             — validation_nudge_sent_at (per-session "already targeted"
--                             bookkeeping so the same pending session isn't re-nudged)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Shared cross-cron notification log.
-- One row per nudge COMBO actually sent (push+email together — see lib/notification-throttle.ts).
-- No `channel` column: push and email are sent as a single atomic decision now,
-- so there's nothing to distinguish by channel here.
create table if not exists notification_log (
  id        uuid        primary key default gen_random_uuid(),
  user_id   uuid        references auth.users on delete cascade not null,
  source    text        not null check (source in ('daily_nudge', 'validation_nudge')),
  sent_at   timestamptz not null default now()
);

create index if not exists idx_notification_log_user_time
  on notification_log (user_id, sent_at desc);

alter table notification_log enable row level security;
-- No user-facing policies — service role only (cron routes use createServiceClient()).

-- 2. user_preferences additions.
alter table user_preferences
  add column if not exists validation_nudge_opted_out   boolean      not null default false;

alter table user_preferences
  add column if not exists lapse_sequence_step           int          not null default 0;

alter table user_preferences
  add column if not exists lapse_anchor_session_at        timestamptz;

alter table user_preferences
  add column if not exists lapse_sequence_last_sent_at     timestamptz;

-- 3. sessions addition — validation-nudge per-session targeting.
alter table sessions
  add column if not exists validation_nudge_sent_at timestamptz;
