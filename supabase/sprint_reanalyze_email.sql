-- ─────────────────────────────────────────────────────────────────────────────
-- QUORUM — Reanalyze Email Cadence: email_send_log table
--
-- Run in: Supabase Dashboard → SQL Editor → New Query
--
-- Purpose: tracks which reanalyze nudge emails have been sent per session,
-- so the cron job never sends the same milestone email twice.
--
-- Milestones: 'reanalyze_7d' | 'reanalyze_14d' | 'reanalyze_30d'
--   Cron fires daily. The 12-hour window in the route handles drift.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists email_send_log (
  id          uuid        primary key default uuid_generate_v4(),
  user_id     uuid        references auth.users on delete cascade not null,
  session_id  uuid        references sessions   on delete cascade not null,
  email_type  text        not null,   -- 'reanalyze_7d' | 'reanalyze_14d' | 'reanalyze_30d'
  sent_at     timestamptz not null default now(),

  -- Prevent duplicate sends for the same session + milestone
  constraint email_send_log_unique unique (session_id, email_type)
);

create index if not exists idx_email_send_log_user
  on email_send_log (user_id);

create index if not exists idx_email_send_log_session
  on email_send_log (session_id);

-- RLS: service role only (cron route uses service key — bypasses RLS automatically)
alter table email_send_log enable row level security;

comment on table email_send_log is
  'Deduplication log for outbound reanalyze nudge emails. '
  'One row per (session_id, email_type) — unique constraint prevents re-sends.';
