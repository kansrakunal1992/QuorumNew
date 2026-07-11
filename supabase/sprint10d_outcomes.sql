-- ─────────────────────────────────────────────────────────────────
-- QUORUM — Sprint 10d: Session Outcomes (FIXED)
-- Run after: sprint9_contradictions.sql (or latest migration)
--
-- Fix vs v1: removed outcomes.user_id column entirely.
-- User ownership is already implicit via session_id → sessions.user_id.
-- The existing api/outcome/route.ts never wrote user_id, so the column
-- was both unused and causing a migration error on deployments where
-- sessions.user_id isn't visible at view-creation time.
-- ─────────────────────────────────────────────────────────────────

-- ── Outcomes table ───────────────────────────────────────────────
create table if not exists outcomes (
  id             uuid        primary key default uuid_generate_v4(),
  session_id     uuid        not null references sessions(id) on delete cascade,

  -- What actually happened
  what_decided   text        not null,
  council_helped text        not null
                             check (council_helped in ('yes', 'partially', 'no')),

  -- Optional qualitative signal (future: feeds Contradiction causal layer)
  notes          text,

  -- Timestamps
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- One outcome per session (upsertable)
  constraint outcomes_session_id_key unique (session_id)
);

create index if not exists idx_outcomes_session_id on outcomes(session_id);
create index if not exists idx_outcomes_created_at on outcomes(created_at);

-- ── Row Level Security ───────────────────────────────────────────
alter table outcomes enable row level security;

-- Ownership is through the parent session — join to sessions to check auth.uid()
create policy "Users can manage their own outcomes"
  on outcomes for all
  using (
    exists (
      select 1 from sessions s
      where s.id = outcomes.session_id
        and s.user_id = auth.uid()
    )
  );

-- Service role bypasses RLS automatically — no extra policy needed.

-- ── Trigger: keep updated_at current ────────────────────────────
create or replace function update_outcomes_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists outcomes_updated_at on outcomes;
create trigger outcomes_updated_at
  before update on outcomes
  for each row execute function update_outcomes_updated_at();

-- ── View: sessions pending an outcome (30+ days, no record) ──────
-- Joined through sessions — no dependency on outcomes.user_id.
-- Used by: future scheduled reminder job / dashboard query.
create or replace view sessions_pending_outcomes as
  select
    s.id           as session_id,
    s.decision_text,
    s.created_at,
    date_part('day', now() - s.created_at) as days_elapsed
  from sessions s
  left join outcomes o on o.session_id = s.id
  where
    o.session_id is null                            -- no outcome yet
    and s.created_at < now() - interval '30 days'   -- at least 30 days old
    and s.status = 'completed'
  order by s.created_at asc;
