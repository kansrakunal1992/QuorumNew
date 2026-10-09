-- QUORUM -- Phase 0: retention funnel straight from the sessions table
--
-- Works TODAY, before any events exist: groups sessions by the best identity
-- available (user_id if linked, else device_id) and counts how many decisions
-- each person has made.
--
-- Caveats (read before trusting the numbers):
--  * A person with no functional-cookie consent has no device_id and cannot be
--    counted across decisions; they appear only if they later link an account.
--  * "Decision" here = a row in sessions (created when the checkpoint is
--    confirmed). It does not distinguish Council vs "I'm done" paths; join
--    sessions.session_depth if you need that split.
--  * Before the Phase 0 auth-header fix, chat-flow sessions for signed-in people
--    carried user_id = NULL; those people are counted via device_id. Run
--    phase0_backfill_chat_user_ids.sql for cleaner history.

create or replace view v_actor_decisions as
with base as (
  select coalesce(user_id::text, device_id) as actor, user_id, created_at
  from sessions
  where coalesce(user_id::text, device_id) is not null
),
firsts as (
  select actor, min(created_at) as first_at from base group by actor
)
select
  b.actor,
  bool_or(b.user_id is not null)                                           as ever_linked,
  f.first_at                                                               as first_decision_at,
  count(*)                                                                 as decisions_total,
  count(*) filter (where b.created_at <= f.first_at + interval '14 days')  as decisions_within_14d,
  count(*) filter (where b.created_at <= f.first_at + interval '30 days')  as decisions_within_30d
from base b
join firsts f using (actor)
group by b.actor, f.first_at;

-- PRIMARY FUNNEL: D1 -> D2 -> D3 -> D4 -> D5+, split anonymous vs linked.
-- Restrict to cohorts old enough to have had the chance (e.g. first decision
-- at least 30 days ago) when you read it.
create or replace view v_retention_funnel as
select
  case when ever_linked then 'linked' else 'anonymous' end as identity,
  count(*)                                                 as d1,
  count(*) filter (where decisions_total >= 2)             as d2,
  count(*) filter (where decisions_total >= 3)             as d3,
  count(*) filter (where decisions_total >= 4)             as d4,
  count(*) filter (where decisions_total >= 5)             as d5_plus,
  count(*) filter (where decisions_within_14d >= 2)        as d2_within_14d,
  count(*) filter (where decisions_within_30d >= 3)        as d3_within_30d
from v_actor_decisions
group by 1;

-- Headline KPI: share of D1 completers who complete a 3rd decision within 30 days.
--   select identity, d1, d3_within_30d,
--          round(100.0 * d3_within_30d / nullif(d1, 0), 1) as pct
--   from v_retention_funnel
--   where <cohort filter on first_decision_at via v_actor_decisions>;

-- Event-level view (needs phase0_events.sql + the Phase 0 build):
--   select event, identity_state, count(*)
--   from events where created_at > now() - interval '14 days'
--   group by 1, 2 order by 1, 2;
