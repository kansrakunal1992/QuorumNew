-- ─────────────────────────────────────────────────────────────────────────────
-- Sprint — Weight Boost Event Logging
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Pure instrumentation — logs every boost computePersonaRelevance() applies,
-- alongside the existing (unchanged) score computation. No adaptive behavior
-- yet: this table exists so that once enough volume accumulates, the actual
-- boost magnitudes (currently hardcoded constants — 0.15 deliberation shift,
-- 0.10 calibration zone, etc.) can be validated against real outcomes instead
-- of remaining permanent guesses. Until then, this is write-only — nothing
-- reads from it to change behavior.
--
-- boost_type:   which mechanism fired — 'deliberation_shift' | 'calibration_zone'
--               | 'structural_match' | 'rule_signal' | 'dimension_signal'
--               | 'advisor_persuasiveness' | 'stated_divergence'
--               (the last two are new boost types added alongside this table —
--               see sprint_advisor_divergence.sql and
--               sprint_pushback_classifications.sql)
-- boost_value:  the actual delta applied to the persona's score this call
-- synthesis_version: which re-synthesis this boost was computed for, so a
--               session with many pushback rounds doesn't collapse into one
--               ambiguous row per persona
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists weight_boost_events (
  id                uuid primary key default uuid_generate_v4(),
  session_id        uuid references sessions on delete cascade not null,
  persona_key       text not null
    check (persona_key in ('contrarian', 'risk_architect', 'pattern_analyst',
                            'stakeholder_mirror', 'elder', 'competitor')),
  boost_type        text not null,
  boost_value       numeric not null,
  synthesis_version integer not null default 1,
  created_at        timestamptz not null default now()
);

create index if not exists idx_weight_boost_events_session
  on weight_boost_events(session_id);

create index if not exists idx_weight_boost_events_type
  on weight_boost_events(boost_type);

alter table weight_boost_events enable row level security;

-- Service-role only — this is written by the persona API route (service
-- client), never read directly by client-side code. No user-facing policy
-- needed, matching structural_scores and other server-only tables in this schema.
create policy "Weight boost events accessible via service role"
  on weight_boost_events for all using (auth.role() = 'service_role');

comment on table weight_boost_events is
  'Instrumentation only — logs every advisor weight boost applied, for future
   validation of boost magnitudes against outcome data. Not read by any
   adaptive logic yet.';
