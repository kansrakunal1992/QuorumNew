-- ============================================================================
-- gtm_lifecycle_v1.sql  --  RUN IN THE *QUORUM APP* SUPABASE PROJECT (not the GTM OS project).
-- Run AFTER supabase/../gtm_export (001_gtm_export.sql from the GTM OS repo). Safe to re-run.
--
-- What this adds (the app's own cron /api/cron/gtm-lifecycle uses it; the GTM OS never reads or writes user rows):
--   1. user_preferences.lifecycle_opted_out    -- one-click unsubscribe target for these emails (+ notification_log accepts source 'gtm_lifecycle')
--   2. gtm_outbox                              -- approved lifecycle programs handed over by the GTM OS (copy + segment KEY only)
--   3. gtm_lifecycle_sends                     -- one row per (program, user): 'sent' or 'holdout'; the unique key prevents double sends
--   4. gtm_segment_users()                     -- resolves a segment key to REAL user ids inside this database (service role only)
--   5. gtm_export.lifecycle_outcomes           -- aggregate delivered-vs-holdout results for the GTM OS (no user ids, no emails)
--   6. gtm_outbox_writer role                  -- insert/select on gtm_outbox ONLY; this is what QUORUM_OUTBOX_DATABASE_URL uses
-- Segment SQL matches gtm/product/segments.py, with one deliberate difference: only activity in the last 90 days counts, so nobody gets an
-- email about something they did a year ago. GTM OS segment sizes are therefore an upper bound of what this app will actually message.
-- ============================================================================

-- 1) opt-out flag ------------------------------------------------------------
alter table public.user_preferences add column if not exists lifecycle_opted_out boolean not null default false;

-- 1b) shared nudge gate: allow the new source in notification_log ---------------------------
-- notification_log only accepts known sources; without this, recordNudge(..., 'gtm_lifecycle') would be rejected and the shared 3-day gate
-- would not know a lifecycle email was sent. Aborts (changes nothing) if your live table already holds a source this file does not know about.
do $$
declare c text; extra text;
begin
  if to_regclass('public.notification_log') is null then
    raise exception 'public.notification_log not found: apply the app''s sprint_nudge_infra.sql first';
  end if;
  select string_agg(distinct source, ', ') into extra from public.notification_log
   where source not in ('daily_nudge','validation_nudge','weekly_brief','pattern_notice','gtm_lifecycle');
  if extra is not null then
    raise exception 'notification_log has other sources (%): add them to the list below before running this file', extra;
  end if;
  for c in select conname from pg_constraint where conrelid = 'public.notification_log'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%source%' loop
    execute format('alter table public.notification_log drop constraint %I', c);
  end loop;
  alter table public.notification_log add constraint notification_log_source_check
    check (source in ('daily_nudge','validation_nudge','weekly_brief','pattern_notice','gtm_lifecycle'));
end $$;

-- 2) outbox ------------------------------------------------------------------
create table if not exists public.gtm_outbox (
  id                 uuid primary key default gen_random_uuid(),
  source_program_id  uuid not null unique,                      -- lifecycle_programs.id in the GTM OS (idempotency key)
  slug               text not null check (slug ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  segment_key        text not null check (segment_key in ('free_one_and_done','locked_no_second','saw_paywall_not_paid','mirror_curious_free','signed_up_never_decided','paid_inactive_21d')),
  name               text,
  objective          text,
  copy_variants      jsonb not null default '[]'::jsonb,
  asset_refs         text[] not null default '{}',
  holdout_pct        int  not null default 10 check (holdout_pct between 0 and 50),
  max_per_run        int  not null default 50 check (max_per_run between 1 and 500),
  cooldown_days      int  not null default 7  check (cooldown_days between 1 and 90),
  status             text not null default 'pending' check (status in ('pending','active','paused','done','cancelled')),
  ends_at            timestamptz not null default now() + interval '45 days',   -- a program never emails forever
  created_at         timestamptz not null default now()
);

-- 3) sends log -----------------------------------------------------------------
create table if not exists public.gtm_lifecycle_sends (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references public.gtm_outbox(id) on delete cascade,
  user_id     uuid not null,
  arm         text not null check (arm in ('delivered','holdout')),
  status      text not null check (status in ('claimed','sent','holdout')),
  variant     int,
  claimed_at  timestamptz not null default now(),      -- assignment time: outcomes are measured from here for BOTH arms
  sent_at     timestamptz,
  unique (program_id, user_id)
);
create index if not exists gtm_lifecycle_sends_user_sent_idx on public.gtm_lifecycle_sends (user_id, sent_at) where status = 'sent';

-- No RLS policies for anon/authenticated: only the service role (the Next.js server) and the writer role below can touch these tables.
alter table public.gtm_outbox          enable row level security;
alter table public.gtm_lifecycle_sends enable row level security;

-- 6) write-only outbox role --------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'gtm_outbox_writer') then
    create role gtm_outbox_writer login password 'CHANGE_ME_BEFORE_USE' nobypassrls;
  end if;
end $$;
revoke all on all tables in schema public from gtm_outbox_writer;
grant usage on schema public to gtm_outbox_writer;
grant insert, select on public.gtm_outbox to gtm_outbox_writer;
drop policy if exists gtm_outbox_writer_insert on public.gtm_outbox;
drop policy if exists gtm_outbox_writer_select on public.gtm_outbox;
create policy gtm_outbox_writer_insert on public.gtm_outbox for insert to gtm_outbox_writer with check (status = 'pending');
create policy gtm_outbox_writer_select on public.gtm_outbox for select to gtm_outbox_writer using (true);
alter role gtm_outbox_writer set statement_timeout = '20s';

-- 4) segment resolution (service role only) -----------------------------------------------
create or replace function public.gtm_lifecycle_excluded(p_user uuid, p_program uuid, p_cooldown_days int)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_preferences up where up.user_id = p_user and up.lifecycle_opted_out)
      or exists (select 1 from public.gtm_lifecycle_sends s where s.program_id = p_program and s.user_id = p_user)
      or exists (select 1 from public.gtm_lifecycle_sends s where s.user_id = p_user and s.status = 'sent' and s.sent_at > now() - make_interval(days => p_cooldown_days))
$$;

create or replace function public.gtm_segment_users(p_segment text, p_program uuid, p_cooldown_days int default 7, p_limit int default 500)
returns table (user_id uuid) language plpgsql stable security definer set search_path = public, auth as $$
begin
  if p_segment = 'free_one_and_done' then
    return query select c.uid from (
      select s.user_id as uid from public.sessions s
       where s.user_id is not null and exists (select 1 from public.synthesis_versions sv where sv.session_id = s.id and sv.version = 0)
       group by s.user_id
      having count(*) = 1 and max(s.created_at) < now() - interval '7 days' and max(s.created_at) > now() - interval '90 days'
         and not exists (select 1 from public.mirror_access m where m.user_id = s.user_id and (m.expires_at is null or m.expires_at > now()))) c
     where not public.gtm_lifecycle_excluded(c.uid, p_program, p_cooldown_days) order by md5(c.uid::text || p_program::text) limit p_limit;
  elsif p_segment = 'locked_no_second' then
    return query select c.uid from (
      select s.user_id as uid from public.sessions s where s.user_id is not null group by s.user_id
      having bool_or(s.final_decision_locked_at is not null) and max(s.created_at) < now() - interval '14 days' and max(s.created_at) > now() - interval '90 days') c
     where not public.gtm_lifecycle_excluded(c.uid, p_program, p_cooldown_days) order by md5(c.uid::text || p_program::text) limit p_limit;
  elsif p_segment in ('saw_paywall_not_paid', 'mirror_curious_free') then
    return query select c.uid from (
      select e.user_id as uid from public.events e
       where e.user_id is not null and e.created_at > now() - interval '90 days'
         and ((p_segment = 'saw_paywall_not_paid' and e.event in ('paywall_viewed','checkout_opened','checkout_dismissed')) or (p_segment = 'mirror_curious_free' and e.event = 'mirror_viewed'))
         and not exists (select 1 from public.mirror_access m where m.user_id = e.user_id and (m.expires_at is null or m.expires_at > now()))
       group by e.user_id) c
     where not public.gtm_lifecycle_excluded(c.uid, p_program, p_cooldown_days) order by md5(c.uid::text || p_program::text) limit p_limit;
  elsif p_segment = 'signed_up_never_decided' then
    return query select c.uid from (
      select u.id as uid from auth.users u
       where u.email is not null and u.created_at < now() - interval '2 days' and u.created_at > now() - interval '90 days'
         and not exists (select 1 from public.sessions s where s.user_id = u.id)) c
     where not public.gtm_lifecycle_excluded(c.uid, p_program, p_cooldown_days) order by md5(c.uid::text || p_program::text) limit p_limit;
  elsif p_segment = 'paid_inactive_21d' then
    return query select c.uid from (
      select m.user_id as uid from public.mirror_access m
       where (m.expires_at is null or m.expires_at > now())
         and not exists (select 1 from public.sessions s where s.user_id = m.user_id and s.created_at > now() - interval '21 days')
       group by m.user_id) c
     where not public.gtm_lifecycle_excluded(c.uid, p_program, p_cooldown_days) order by md5(c.uid::text || p_program::text) limit p_limit;
  else
    raise exception 'unknown segment %', p_segment;
  end if;
end $$;

revoke all on function public.gtm_lifecycle_excluded(uuid, uuid, int) from public, anon, authenticated;
revoke all on function public.gtm_segment_users(text, uuid, int, int) from public, anon, authenticated;
grant execute on function public.gtm_lifecycle_excluded(uuid, uuid, int) to service_role;
grant execute on function public.gtm_segment_users(text, uuid, int, int) to service_role;

-- 5) aggregate outcomes for the GTM OS (read through the existing gtm_readonly role) --------------
-- Outcome window: 14 days from assignment, the same for both arms. Recent assignments have incomplete windows in BOTH arms, so rates
-- look low early; the GTM OS also ignores comparisons below 30 delivered / 10 holdout.
create schema if not exists gtm_export;
create or replace view gtm_export.lifecycle_outcomes as
with a as (
  select o.slug as program_slug, s.arm, s.user_id, s.claimed_at as assigned_at
    from public.gtm_lifecycle_sends s join public.gtm_outbox o on o.id = s.program_id
   where s.status in ('sent','holdout')),
agg as (
  select a.program_slug, a.arm, count(*) as n,
         count(*) filter (where exists (select 1 from public.sessions x where x.user_id = a.user_id and x.created_at > a.assigned_at and x.created_at <= a.assigned_at + interval '14 days')) as started,
         count(*) filter (where exists (select 1 from public.sessions x where x.user_id = a.user_id and x.final_decision_locked_at > a.assigned_at and x.final_decision_locked_at <= a.assigned_at + interval '14 days')) as locked,
         count(*) filter (where exists (select 1 from public.events e where e.user_id = a.user_id and e.event = 'payment_success' and e.created_at > a.assigned_at and e.created_at <= a.assigned_at + interval '14 days')) as paid
    from a group by a.program_slug, a.arm)
select d.program_slug, d.n::int as delivered, coalesce(h.n, 0)::int as holdout,
       d.started::numeric / nullif(d.n, 0) as started_rate_delivered, h.started::numeric / nullif(h.n, 0) as started_rate_holdout,
       d.locked::numeric  / nullif(d.n, 0) as locked_rate_delivered,  h.locked::numeric  / nullif(h.n, 0) as locked_rate_holdout,
       d.paid::numeric    / nullif(d.n, 0) as paid_rate_delivered,    h.paid::numeric    / nullif(h.n, 0) as paid_rate_holdout,
       now() as as_of
  from agg d left join agg h on h.program_slug = d.program_slug and h.arm = 'holdout'
 where d.arm = 'delivered';
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gtm_readonly') then
    grant usage on schema gtm_export to gtm_readonly;
    grant select on gtm_export.lifecycle_outcomes to gtm_readonly;
  end if;
end $$;

-- Pause or stop a program at any time (no code needed):
--   update public.gtm_outbox set status = 'paused'    where slug = '<slug>';
--   update public.gtm_outbox set status = 'cancelled' where slug = '<slug>';
-- Sanity check after deploying (must return zero rows):
--   select column_name from information_schema.columns where table_schema = 'gtm_export' and table_name = 'lifecycle_outcomes' and column_name ~* '(user|email|name)';
