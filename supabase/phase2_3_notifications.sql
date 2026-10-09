-- QUORUM -- Phase 2/3: habit preferences, weekly brief, pattern notice
-- Run before deploying the build. Safe to re-run.

-- 1. user_preferences: the D2 "where will you bring the next one?" answers and
--    the two new opt-outs. brief_cadence is NULL until the person chooses; the
--    weekly brief only ever goes to people who explicitly chose 'weekly'.
alter table user_preferences
  add column if not exists next_decision_cue       text,
  add column if not exists brief_cadence           text,
  add column if not exists weekly_brief_opted_out  boolean not null default false,
  add column if not exists pattern_notice_opted_out boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'user_preferences'::regclass and conname = 'user_preferences_brief_cadence_check'
  ) then
    alter table user_preferences
      add constraint user_preferences_brief_cadence_check
      check (brief_cadence is null or brief_cadence in ('weekly', 'when_stuck', 'big_only'));
  end if;
end $$;

-- 2. notification_log: allow the two new sources in the shared throttle table.
--    The original check constraint is unnamed in sprint_nudge_infra.sql, so find
--    and drop whichever CHECK mentions "source" before re-adding a wider one.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'notification_log'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%source%'
  loop
    execute format('alter table notification_log drop constraint %I', c);
  end loop;
end $$;

alter table notification_log
  add constraint notification_log_source_check
  check (source in ('daily_nudge', 'validation_nudge', 'weekly_brief', 'pattern_notice'));

-- 3. pattern_notice_log: one row per distinct finding emailed, so the same
--    pattern is never sent twice (event-driven, not scheduled).
create table if not exists pattern_notice_log (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users on delete cascade,
  pattern_key text        not null,
  sent_at     timestamptz not null default now(),
  constraint pattern_notice_log_unique unique (user_id, pattern_key)
);
create index if not exists idx_pattern_notice_log_user_time on pattern_notice_log (user_id, sent_at desc);
alter table pattern_notice_log enable row level security;
-- Service role only (cron routes use createServiceClient()).
