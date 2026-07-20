-- ─────────────────────────────────────────────────────────────────
-- QUORUM INSTITUTIONAL LAYER — Tech Debt Fixes
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- Run AFTER supabase/institutional_sprint6_bias_parameter_view.sql
-- (and after institutional_tier3_deactivation.sql)
--
-- Closes, in one migration:
--   - TECH_DEBT.md #1 — non-atomic consent write (POST /api/institutions/
--     consent did an .update() then an .insert() as two separate calls;
--     see lib/institution-auth.ts-adjacent route for the old version).
--   - TECH_DEBT.md #2 (schema half) — adds get_user_emails(), a single-
--     round-trip replacement for the N+1 auth.admin.getUserById() loop in
--     both the roster route and lib/cohort-insights.ts. The two call sites
--     themselves are fixed in application code, not here.
--   - The consent_aggregate_backfill no-op (flagged in TSD §12.5/§12.17 and
--     handover PENDING/NEXT SESSION) — components/InstitutionConsentSettings.tsx
--     already collects a real Yes/No answer to this via its own modal; no
--     view has ever read it. This migration is what makes that existing
--     answer actually mean something.
--   - Institution-admin-initiated deactivation requests (schema only —
--     the actual gate stays platform-admin-only, per KDD; a request just
--     flags for review, per Kunal's own answer to this document's earlier
--     "confirm intentional" flag).
-- ─────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════
-- PART 1 — consent_aggregate_granted_at: what "future" means
-- ═══════════════════════════════════════════════════════════════════
-- consent_aggregate_backfill has been storable and toggleable since Sprint 2
-- (and the UI already asks the question — see InstitutionConsentSettings.tsx's
-- backfill modal), but no view has ever branched on it: consent_aggregate=true
-- has always meant "all of my qualifying history, past and future, starting
-- now." This column is the missing piece — a per-membership clock marking
-- when "future" starts, so backfill=false can mean what it says.

alter table institution_memberships
  add column if not exists consent_aggregate_granted_at timestamptz;

-- Backfill for members who already had consent_aggregate = true before this
-- migration ran — without this, the new date filter below would treat their
-- granted_at as NULL, and NULL comparisons are neither true nor false, which
-- would silently zero out every one of their sessions from every aggregate
-- view the moment this migration lands, regardless of their actual backfill
-- answer. Best-available provenance, in priority order:
--   1. The audit log's earliest true-transition on this exact field, if one
--      exists (consent_audit_log has existed since Sprint 2, so this covers
--      anyone who toggled consent_aggregate through the UI at any point).
--   2. Their membership's own joined_at (they cannot have consented before
--      joining) — covers rows the audit log doesn't reach.
--   3. now() as a last resort, for any edge case neither of the above covers.
-- Note this backfill is deliberately generous, not punitive: it dates
-- granted_at as early as honestly defensible, so a returning consenter's
-- historical contribution isn't retroactively narrowed by a migration they
-- had no part in.
update institution_memberships im
set consent_aggregate_granted_at = coalesce(
  (
    select min(cal.changed_at)
    from consent_audit_log cal
    where cal.user_id = im.user_id
      and cal.institution_id = im.institution_id
      and cal.field_changed = 'consent_aggregate'
      and cal.new_value = true
  ),
  im.joined_at,
  now()
)
where im.consent_aggregate = true
  and im.consent_aggregate_granted_at is null;


-- ═══════════════════════════════════════════════════════════════════
-- PART 2 — toggle_consent(): one transaction instead of two calls
-- ═══════════════════════════════════════════════════════════════════
-- Replaces the update-then-insert pair in the consent route with a single
-- function call. Also owns the consent_aggregate_granted_at side effect:
-- any transition INTO consent_aggregate = true (fresh opt-in, or re-opt-in
-- after a prior opt-out) resets the clock to now(). Deliberate: someone who
-- turned sharing off and later back on almost certainly means "count my
-- decisions from here," not "silently resume counting from whenever I
-- first joined, including the gap while I was opted out." A no-op call
-- (already true, set true again) leaves the existing clock untouched.

create or replace function toggle_consent(
  p_user_id         uuid,
  p_institution_id  uuid,
  p_field           text,
  p_value           boolean
) returns table (
  institution_id                 uuid,
  consent_aggregate               boolean,
  consent_aggregate_backfill      boolean,
  consent_shared_cohort           boolean,
  consent_aggregate_granted_at    timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_value boolean;
begin
  if p_field not in ('consent_aggregate', 'consent_aggregate_backfill', 'consent_shared_cohort') then
    raise exception 'toggle_consent: invalid field %', p_field;
  end if;

  -- Row lock for the duration of the transaction — closes the same race
  -- the admin-seat-claim logic elsewhere in this layer already guards
  -- against, just for a consent write instead of a redemption.
  perform 1 from institution_memberships
    where user_id = p_user_id and institution_id = p_institution_id
    for update;

  if not found then
    raise exception 'toggle_consent: no membership for user % in institution %', p_user_id, p_institution_id;
  end if;

  if p_field = 'consent_aggregate' then
    select im.consent_aggregate into v_old_value
      from institution_memberships im
      where im.user_id = p_user_id and im.institution_id = p_institution_id;

    update institution_memberships
      set consent_aggregate = p_value,
          consent_aggregate_granted_at = case
            when p_value = true and (v_old_value is distinct from true) then now()
            else consent_aggregate_granted_at
          end
      where user_id = p_user_id and institution_id = p_institution_id;

  elsif p_field = 'consent_aggregate_backfill' then
    select im.consent_aggregate_backfill into v_old_value
      from institution_memberships im
      where im.user_id = p_user_id and im.institution_id = p_institution_id;

    update institution_memberships
      set consent_aggregate_backfill = p_value
      where user_id = p_user_id and institution_id = p_institution_id;

  elsif p_field = 'consent_shared_cohort' then
    select im.consent_shared_cohort into v_old_value
      from institution_memberships im
      where im.user_id = p_user_id and im.institution_id = p_institution_id;

    update institution_memberships
      set consent_shared_cohort = p_value
      where user_id = p_user_id and institution_id = p_institution_id;
  end if;

  insert into consent_audit_log (user_id, institution_id, field_changed, old_value, new_value, changed_at)
  values (p_user_id, p_institution_id, p_field, coalesce(v_old_value, false), p_value, now());

  return query
    select im.institution_id, im.consent_aggregate, im.consent_aggregate_backfill,
           im.consent_shared_cohort, im.consent_aggregate_granted_at
    from institution_memberships im
    where im.user_id = p_user_id and im.institution_id = p_institution_id;
end;
$$;

-- Same grant posture as every other institutional object in this layer:
-- callable by the service-role client the app already uses for every
-- institutional route, not by anon/authenticated directly (the route
-- itself is what authenticates the caller and supplies p_user_id from
-- their verified token — this function trusts its caller, it doesn't
-- re-derive identity).
revoke all on function toggle_consent(uuid, uuid, text, boolean) from public, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- PART 3 — get_user_emails(): one round trip instead of N
-- ═══════════════════════════════════════════════════════════════════
-- auth.users isn't directly queryable by ordinary grants — security definer
-- lets this function read it (as its owner) for exactly one narrow purpose:
-- resolving a batch of user_ids to emails, nothing else from the user
-- record. Deliberately a shared utility, not institution-specific — used
-- by both the roster route and lib/cohort-insights.ts, per the tracker's
-- own note that both call sites should move to the same fix together.
-- Narrower than what it replaces, too: auth.admin.getUserById() returns
-- the full user object over the Admin API; this returns id + email only.

create or replace function get_user_emails(p_user_ids uuid[]) returns table (
  user_id uuid,
  email   text
)
language sql
security definer
set search_path = public
as $$
  select u.id, u.email
  from auth.users u
  where u.id = any(p_user_ids)
$$;

revoke all on function get_user_emails(uuid[]) from public, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- PART 4 — Institution-admin deactivation requests (flag only)
-- ═══════════════════════════════════════════════════════════════════
-- Per KDD (confirmed): the actual deactivation gate stays platform-admin-
-- only (ADMIN_CODE) — an institution's own admin cannot deactivate their
-- org unilaterally, since deactivation has billing/relationship
-- implications outside this admin's authority. This adds a request flag
-- only: an institution admin can ask, and it surfaces on the platform
-- admin's own institutions panel for review. Nothing about the actual
-- deactivation mechanism (institutions.deactivated_at, from
-- institutional_tier3_deactivation.sql) changes.

alter table institutions
  add column if not exists deactivation_requested_at timestamptz,
  add column if not exists deactivation_requested_by  uuid references auth.users(id);

-- Clearing a request (whether by actually deactivating, or by the platform
-- admin dismissing it as not warranted) just means setting both columns
-- back to null — no separate "dismissed" state is tracked, matching this
-- layer's existing preference for absence over a status enum (same
-- reasoning as K-floor's "the row doesn't exist" pattern elsewhere in
-- this file's sibling migrations).


-- ═══════════════════════════════════════════════════════════════════
-- PART 5 — Aggregate views, updated to honor consent_aggregate_backfill
-- ═══════════════════════════════════════════════════════════════════
-- Re-declares all four views from institutional_sprint4_aggregate_views.sql
-- and institutional_sprint6_bias_parameter_view.sql with one addition each:
-- a session/row only counts if consent_aggregate_backfill = true for that
-- membership, OR the session/row postdates consent_aggregate_granted_at.
-- Everything else (K-floor gating, HIGH/LOW bucketing, dedup logic) is
-- unchanged from those two files — only pasted in full here because
-- CREATE OR REPLACE VIEW requires the whole definition, not a diff.
--
-- institutional_rollup_benchmark_segments (Sprint 4) is NOT redefined here
-- — it's built exclusively from institutional_benchmark_segments' own
-- already-filtered rows (see TSD §12.8), so it inherits this fix for free
-- once the view below is replaced.

-- ── Platform-wide benchmark view (calibration-delta) ─────────────────
create or replace view institutional_platform_benchmark_segments as
with consenting_users as (
  -- Grouped by user_id (not one row per membership) because this view is
  -- platform-wide and a user can consent via more than one institution.
  -- bool_or: if backfill=true anywhere, treat as full backfill everywhere
  -- for this user. min(granted_at): the earliest of their consenting
  -- memberships' clocks — the more generous (earlier) cutoff wins when a
  -- user has multiple institutions with different grant dates. Both are
  -- defensible tie-breaks for a genuinely ambiguous multi-institution case;
  -- neither is spelled out in the plan doc, flagging as a judgment call.
  select
    user_id,
    bool_or(consent_aggregate_backfill) as backfill,
    min(consent_aggregate_granted_at)   as granted_at
  from institution_memberships
  where consent_aggregate = true
  group by user_id
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
    and (cu.backfill = true or s.created_at >= cu.granted_at)
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

-- ── Institution-scoped benchmark view (calibration-delta) ────────────
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
    and (im.consent_aggregate_backfill = true or s.created_at >= im.consent_aggregate_granted_at)
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

-- ── Platform-wide bias-parameter view ─────────────────────────────────
-- bias_library has no session-level granularity (session_ids is an array
-- on a single accumulating row per user × bias_parameter — see that
-- table's own definition), so there's no clean per-session "before/after
-- consent" split available the way there is for the calibration views
-- above. Using bl.created_at (when the row was FIRST created) as the
-- proxy: a row that started accumulating before the consent clock started
-- is excluded entirely under backfill=false, even if some of its later
-- detections happened after. Conservative in the direction of excluding
-- too much rather than too little — flagged here, not silently assumed,
-- since it's a real simplification, not a fully accurate per-detection
-- cutoff.
create or replace view institutional_platform_bias_parameter_segments as
with consenting_users as (
  select
    user_id,
    bool_or(consent_aggregate_backfill) as backfill,
    min(consent_aggregate_granted_at)   as granted_at
  from institution_memberships
  where consent_aggregate = true
  group by user_id
),
consenting_emails as (
  select cu.user_id, u.email, cu.backfill, cu.granted_at
  from consenting_users cu
  join auth.users u on u.id = cu.user_id
  where u.email is not null
),
matched as (
  select
    ce.user_id,
    bl.bias_parameter,
    bl.confidence_weight
  from consenting_emails ce
  join bias_library bl on bl.user_email = ce.email
  where ce.backfill = true or bl.created_at >= ce.granted_at
),
aggregated as (
  select
    bias_parameter,
    count(distinct user_id)      as member_count,
    avg(confidence_weight)       as avg_confidence_weight
  from matched
  group by bias_parameter
  having count(distinct user_id) >= k_floor_default()
)
select * from aggregated;

revoke all on institutional_platform_bias_parameter_segments from public, anon, authenticated;

-- ── Institution-scoped bias-parameter view ────────────────────────────
create or replace view institutional_bias_parameter_segments as
with member_emails as (
  select
    im.institution_id,
    coalesce(i.k_floor_override, k_floor_default()) as k_floor,
    im.user_id,
    u.email,
    im.consent_aggregate_backfill   as backfill,
    im.consent_aggregate_granted_at as granted_at
  from institution_memberships im
  join institutions i on i.id = im.institution_id
  join auth.users u   on u.id = im.user_id
  where im.consent_aggregate = true
    and u.email is not null
),
matched as (
  select
    me.institution_id,
    me.k_floor,
    me.user_id,
    bl.bias_parameter,
    bl.confidence_weight
  from member_emails me
  join bias_library bl on bl.user_email = me.email
  where me.backfill = true or bl.created_at >= me.granted_at
),
aggregated as (
  select
    institution_id,
    k_floor,
    bias_parameter,
    count(distinct user_id)      as member_count,
    avg(confidence_weight)       as avg_confidence_weight
  from matched
  group by institution_id, k_floor, bias_parameter
  having count(distinct user_id) >= k_floor
)
select institution_id, bias_parameter, member_count, avg_confidence_weight from aggregated;

revoke all on institutional_bias_parameter_segments from public, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- PART 6 — Wiring aggregate_reader in (the actual point of Sprint 4
-- task 7, left undone since — see institutional_sprint4_restricted_role.sql's
-- own "how to actually use this role" note, which named this exact
-- approach as option (c))
-- ═══════════════════════════════════════════════════════════════════
-- Five SECURITY DEFINER wrapper functions, one per view family, each
-- OWNED BY aggregate_reader below (not by whoever runs this migration).
-- This is the mechanism that actually narrows privilege: a SECURITY
-- DEFINER function's body executes with its OWNER's grants, not its
-- caller's — so calling any function below via supabase.rpc() (still
-- authenticated as service_role at the PostgREST layer, same as every
-- other institutional route) can only ever read the specific views
-- aggregate_reader itself has been granted, nothing else. This holds
-- regardless of how broad service_role's own default access is — RLS-
-- bypass and this ownership mechanic are independent, that's what makes
-- it a real restriction rather than a cosmetic one.
--
-- p_dim / p_bias_parameter are optional: pass a value to filter to one
-- dimension/parameter (matches getBenchmarkForDimension's per-dimension
-- calls), or omit (pass null) to get every row for that institution in
-- one call (matches the admin dashboard routes' existing "one call for
-- everything" pattern — see TSD §12.11 for why that's deliberate).
--
-- Extends the role's own grants first, to also cover the two bias-
-- parameter views added in Sprint 6 — after institutional_sprint4_
-- restricted_role.sql was written, never revisited since.
grant select on institutional_platform_bias_parameter_segments to aggregate_reader;
grant select on institutional_bias_parameter_segments           to aggregate_reader;

create or replace function aggregate_read_institution_benchmark(
  p_institution_id uuid, p_dim text default null
) returns setof institutional_benchmark_segments
language sql stable as $$
  select * from institutional_benchmark_segments
  where institution_id = p_institution_id
    and (p_dim is null or dim = p_dim)
  order by dim
$$;

create or replace function aggregate_read_platform_benchmark(
  p_dim text default null
) returns setof institutional_platform_benchmark_segments
language sql stable as $$
  select * from institutional_platform_benchmark_segments
  where (p_dim is null or dim = p_dim)
  order by dim
$$;

create or replace function aggregate_read_rollup_benchmark(
  p_parent_institution_id uuid, p_dim text default null
) returns setof institutional_rollup_benchmark_segments
language sql stable as $$
  select * from institutional_rollup_benchmark_segments
  where parent_institution_id = p_parent_institution_id
    and (p_dim is null or dim = p_dim)
  order by dim
$$;

create or replace function aggregate_read_institution_bias_parameter(
  p_institution_id uuid, p_bias_parameter text default null
) returns setof institutional_bias_parameter_segments
language sql stable as $$
  select * from institutional_bias_parameter_segments
  where institution_id = p_institution_id
    and (p_bias_parameter is null or bias_parameter = p_bias_parameter)
  order by bias_parameter
$$;

create or replace function aggregate_read_platform_bias_parameter(
  p_bias_parameter text default null
) returns setof institutional_platform_bias_parameter_segments
language sql stable as $$
  select * from institutional_platform_bias_parameter_segments
  where (p_bias_parameter is null or bias_parameter = p_bias_parameter)
  order by bias_parameter
$$;

-- The ownership change that makes all five of the above actually
-- restricted rather than merely relocated:
alter function aggregate_read_institution_benchmark(uuid, text)        owner to aggregate_reader;
alter function aggregate_read_platform_benchmark(text)                 owner to aggregate_reader;
alter function aggregate_read_rollup_benchmark(uuid, text)              owner to aggregate_reader;
alter function aggregate_read_institution_bias_parameter(uuid, text)    owner to aggregate_reader;
alter function aggregate_read_platform_bias_parameter(text)             owner to aggregate_reader;

-- Callable via the existing service-role client / supabase.rpc() pattern —
-- not opened to anon/authenticated directly (those roles have no path to
-- institutional data at all today, and this migration isn't the place to
-- change that).
revoke all on function aggregate_read_institution_benchmark(uuid, text)     from public, anon, authenticated;
revoke all on function aggregate_read_platform_benchmark(text)              from public, anon, authenticated;
revoke all on function aggregate_read_rollup_benchmark(uuid, text)          from public, anon, authenticated;
revoke all on function aggregate_read_institution_bias_parameter(uuid, text) from public, anon, authenticated;
revoke all on function aggregate_read_platform_bias_parameter(text)          from public, anon, authenticated;

-- ── Verify this actually restricts, before trusting it in production ──
-- Suggested smoke test, run once after this migration: temporarily revoke
-- aggregate_reader's grant on one view (e.g. `revoke select on
-- institutional_benchmark_segments from aggregate_reader;`), confirm the
-- matching function now errors instead of silently returning rows, then
-- re-grant. This isn't automated here because it's destructive against
-- whatever environment it's run in — worth doing once by hand against a
-- non-production database before leaning on this as a real security
-- boundary rather than an assumed one.

