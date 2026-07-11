-- ─────────────────────────────────────────────────────────────────
-- QUORUM INSTITUTIONAL LAYER — Sprint 4: Aggregate Engine, Auto-Tiering,
-- Cross-Institution Rollup
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- Run AFTER supabase/institutional_sprint3_cohorts.sql
--
-- ── IMPORTANT — schema this migration depends on, now VERIFIED against the
-- actual repo migrations (supabase/sprint10d_outcomes.sql and
-- supabase/sprint11a_14dim_ontology.sql), not reverse-engineered as before:
--   outcomes(session_id uuid unique references sessions, calibration_delta
--            numeric, retrospective_confidence integer, outcome_quality text, ...)
--     — no user_id column; ownership is via session_id → sessions.user_id.
--   sessions_ontology.ontology_vector jsonb, shape per dimension:
--     { "<dim>": { "score": 1-5, "confidence": 0.0-1.0, "rationale": "..." }, ... }
--     — NOT a flat {dim: number} map. Extracting a score requires
--     ontology_vector -> dim ->> 'score', not ontology_vector ->> dim.
--     (An earlier draft of this file assumed the flat shape and would have
--     thrown a numeric-cast error at query time — fixed before this ever
--     shipped, verified against the real migration DDL.)
-- ─────────────────────────────────────────────────────────────────

-- ── K_FLOOR, defined once, mirrored in lib/k-floor.ts ───────────────
-- If you change the number, change it in both places, same commit.
create or replace function k_floor_default() returns int
language sql immutable as $$
  select 20
$$;

-- The 14-dim vector's key names, single source of truth at the SQL level,
-- mirroring lib/structural-retrieval.ts's VECTOR_DIMS array. If that array
-- ever changes, update this function to match in the same commit.
create or replace function ontology_vector_dims() returns text[]
language sql immutable as $$
  select array[
    'reversibility','time_horizon','stakes_magnitude','outcome_uncertainty',
    'ambiguity','task_complexity','decision_discriminating_info','time_pressure',
    'decision_unit','value_conflict','emotional_intensity','identity_alignment',
    'regret_asymmetry','upstream_dependency'
  ]
$$;

-- ── Platform-wide benchmark view (task 2) ───────────────────────────
-- Aggregates across every consenting user platform-wide (i.e. across all
-- institutions combined) — this is the fallback used when a specific
-- institution's own population hasn't cleared K_FLOOR for a dimension.
-- "Platform-wide" here means "every institution's consenting members
-- combined", not literally every product user — consent_aggregate lives on
-- institution_memberships, so a user with no institutional membership at
-- all is structurally outside every aggregate computation, matching
-- Section 1.7(c)'s "pixel-identical to today's product" guarantee.
--
-- Same HIGH/LOW bucketing discipline as lib/calibration-engine.ts's
-- per-user version (score >= 4 / <= 2 on the 1–5 scale), same MIN_GAP
-- (0.4) exposed as is_signal — but K_FLOOR is the hard privacy gate here,
-- enforced via HAVING, not a suggestion: below floor, the row simply does
-- not exist in this view. That absence *is* the privacy mechanism.
--
-- consenting_users is deduplicated by user_id BEFORE joining to session
-- data deliberately: a user can belong to more than one institution's
-- consenting membership, and without this dedup step their sessions would
-- be counted once per membership row, inflating both n and the average.
create or replace view institutional_platform_benchmark_segments as
with consenting_users as (
  select distinct user_id
  from institution_memberships
  where consent_aggregate = true
),
dims as (
  select unnest(ontology_vector_dims()) as dim
),
scored_sessions as (
  select
    cu.user_id,
    o.calibration_delta,
    d.dim,
    (so.ontology_vector -> d.dim ->> 'score')::numeric as dim_score
  from consenting_users cu
  join sessions s          on s.user_id = cu.user_id
  join outcomes o          on o.session_id = s.id
  join sessions_ontology so on so.session_id = s.id
  cross join dims d
  where o.calibration_delta is not null
    and so.ontology_vector is not null
    and (so.ontology_vector -> d.dim ->> 'score') is not null
),
bucketed as (
  select
    dim,
    case when dim_score >= 4 then 'high' when dim_score <= 2 then 'low' else null end as bucket,
    user_id,
    calibration_delta
  from scored_sessions
  where dim_score >= 4 or dim_score <= 2
),
aggregated as (
  select
    dim,
    avg(calibration_delta)   filter (where bucket = 'high') as high_avg_delta,
    count(distinct user_id)  filter (where bucket = 'high') as high_n,
    avg(calibration_delta)   filter (where bucket = 'low')  as low_avg_delta,
    count(distinct user_id)  filter (where bucket = 'low')  as low_n
  from bucketed
  group by dim
  having count(distinct user_id) filter (where bucket = 'high') >= k_floor_default()
     and count(distinct user_id) filter (where bucket = 'low')  >= k_floor_default()
)
select
  dim,
  high_avg_delta, high_n,
  low_avg_delta,  low_n,
  (high_avg_delta - low_avg_delta)              as gap,
  (abs(high_avg_delta - low_avg_delta) >= 0.4)  as is_signal
from aggregated;

revoke all on institutional_platform_benchmark_segments from public, anon, authenticated;

-- ── Institution-scoped benchmark view (task 3) ──────────────────────
-- Identical logic, scoped per institution, using that institution's own
-- k_floor_override if set (else k_floor_default()). This is what lets an
-- institution large enough to clear the floor see its own population's
-- patterns instead of always falling back to platform-wide.
create or replace view institutional_benchmark_segments as
with dims as (
  select unnest(ontology_vector_dims()) as dim
),
member_sessions as (
  select
    im.institution_id,
    coalesce(i.k_floor_override, k_floor_default()) as k_floor,
    im.user_id,
    o.calibration_delta,
    d.dim,
    (so.ontology_vector -> d.dim ->> 'score')::numeric as dim_score
  from institution_memberships im
  join institutions i        on i.id = im.institution_id
  join sessions s             on s.user_id = im.user_id
  join outcomes o             on o.session_id = s.id
  join sessions_ontology so   on so.session_id = s.id
  cross join dims d
  where im.consent_aggregate = true
    and o.calibration_delta is not null
    and so.ontology_vector is not null
    and (so.ontology_vector -> d.dim ->> 'score') is not null
),
bucketed as (
  select
    institution_id, k_floor, dim,
    case when dim_score >= 4 then 'high' when dim_score <= 2 then 'low' else null end as bucket,
    user_id, calibration_delta
  from member_sessions
  where dim_score >= 4 or dim_score <= 2
),
aggregated as (
  select
    institution_id, k_floor, dim,
    avg(calibration_delta)   filter (where bucket = 'high') as high_avg_delta,
    count(distinct user_id)  filter (where bucket = 'high') as high_n,
    avg(calibration_delta)   filter (where bucket = 'low')  as low_avg_delta,
    count(distinct user_id)  filter (where bucket = 'low')  as low_n
  from bucketed
  group by institution_id, k_floor, dim
  having count(distinct user_id) filter (where bucket = 'high') >= k_floor
     and count(distinct user_id) filter (where bucket = 'low')  >= k_floor
)
select
  institution_id,
  dim,
  high_avg_delta, high_n,
  low_avg_delta,  low_n,
  (high_avg_delta - low_avg_delta)              as gap,
  (abs(high_avg_delta - low_avg_delta) >= 0.4)  as is_signal
from aggregated;

revoke all on institutional_benchmark_segments from public, anon, authenticated;

-- ── Cross-institution rollup view (task 5) ──────────────────────────
-- A parent institution's number, built ONLY from its children's already-
-- aggregated, already-floor-cleared rows in institutional_benchmark_segments
-- above — never sessions/outcomes/sessions_ontology/institution_memberships
-- directly. Verify by construction: read the FROM/JOIN list below — it is
-- institutional_benchmark_segments and institutions, full stop. There is no
-- join path from this view to any table finer-grained than a child
-- institution's own aggregate view.
--
-- Addition beyond the letter of the task: requires >= 2 contributing
-- children, not 1. A rollup of exactly one child's own already-floor-
-- cleared numbers is just that child's number relabeled as the parent's —
-- which both defeats the point of rolling up and edges toward isolating
-- one population as a de facto "segment", the spirit Section 1.10 warns
-- against even though each individual child number already independently
-- cleared its own K_FLOOR.
create or replace view institutional_rollup_benchmark_segments as
with child_segments as (
  select
    i.parent_institution_id,
    ibs.dim,
    ibs.institution_id as child_institution_id,
    ibs.high_avg_delta, ibs.high_n,
    ibs.low_avg_delta,  ibs.low_n
  from institutional_benchmark_segments ibs
  join institutions i on i.id = ibs.institution_id
  where i.parent_institution_id is not null
),
rolled as (
  select
    parent_institution_id,
    dim,
    count(distinct child_institution_id) as contributing_children,
    -- n-weighted average across children, not a flat average of averages —
    -- a child with 80 consenting members shouldn't count the same as one
    -- with 21.
    (sum(high_avg_delta * high_n) / nullif(sum(high_n), 0)) as high_avg_delta,
    sum(high_n) as high_n,
    (sum(low_avg_delta * low_n) / nullif(sum(low_n), 0))    as low_avg_delta,
    sum(low_n) as low_n
  from child_segments
  group by parent_institution_id, dim
  having count(distinct child_institution_id) >= 2
)
select
  parent_institution_id,
  dim,
  contributing_children,
  high_avg_delta, high_n,
  low_avg_delta,  low_n,
  (high_avg_delta - low_avg_delta)              as gap,
  (abs(high_avg_delta - low_avg_delta) >= 0.4)  as is_signal
from rolled;

revoke all on institutional_rollup_benchmark_segments from public, anon, authenticated;

-- ── Task 7 note ──────────────────────────────────────────────────────
-- The three REVOKE statements above already mean these views are
-- unreachable by the anon/authenticated roles — only service_role (which
-- bypasses grants/RLS entirely in Supabase) can query them today, same as
-- every other institutional table so far. A dedicated, more restricted
-- credential for the aggregate-serving path specifically (narrower than
-- service_role) is set up separately — see
-- supabase/institutional_sprint4_restricted_role.sql — since it's a
-- distinct piece of DB configuration, not part of the view definitions
-- themselves.
