-- ─────────────────────────────────────────────────────────────────────────────
-- Sprint — Advisor Divergence Detection
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Captures the cases where a user's own stated leaning (DecisionStateCard's
-- free-text commitment_leaning field, classified into proceed|wait|mixed via
-- lib/advisor-divergence.ts) disagrees with a given advisor's final lean in
-- that session's latest synthesis (synthesis_versions.leans).
--
-- This is the mirror image of pushback_classifications / mind-change-patterns.ts:
-- that pair tracks which advisor most often CHANGES the user's mind. This one
-- tracks which advisor's final stance the user most often ends up going
-- AGAINST — powering a counterbalance weighting boost for a persona the user
-- may be structurally underweighting. See sprint_weight_boost_events.sql's
-- 'stated_divergence' boost_type comment.
--
-- Only actual mismatches are stored — an advisor whose lean matches the
-- user's stated lean is agreement, not a signal worth counting. No decision
-- content is stored here — persona_key + two lean enum values only. Nothing
-- sensitive, nothing encrypted-at-rest needed (same reasoning as
-- pushback_classifications).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists advisor_divergence_events (
  id                uuid primary key default uuid_generate_v4(),
  session_id        uuid references sessions on delete cascade not null,
  persona_key       text not null
    check (persona_key in ('contrarian', 'risk_architect', 'pattern_analyst',
                            'stakeholder_mirror', 'elder', 'competitor')),
  advisor_lean      text not null
    check (advisor_lean in ('proceed', 'wait', 'mixed')),
  user_stated_lean  text not null
    check (user_stated_lean in ('proceed', 'wait', 'mixed')),
  user_id           uuid,
  user_email        text,
  created_at        timestamptz not null default now()
);

create index if not exists idx_advisor_divergence_events_session
  on advisor_divergence_events(session_id);

-- The aggregation query (lib/advisor-divergence.ts) groups by user across ALL
-- of that user's sessions, not per-session — same reasoning as
-- idx_pushback_classifications_user.
create index if not exists idx_advisor_divergence_events_user
  on advisor_divergence_events(user_id, user_email);

alter table advisor_divergence_events enable row level security;

create policy "Advisor divergence events accessible via service role"
  on advisor_divergence_events for all using (auth.role() = 'service_role');

comment on table advisor_divergence_events is
  'Persists cases where the user''s own stated leaning disagreed with a given
   advisor''s final lean in that session''s synthesis. Powers cross-session
   "which advisor you tend to diverge from" pattern detection — the mirror
   image of pushback_classifications. No decision content — persona + two
   lean enum values only.';
