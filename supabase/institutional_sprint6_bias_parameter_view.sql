-- ─────────────────────────────────────────────────────────────────
-- QUORUM INSTITUTIONAL LAYER — Sprint 6: Bias-Parameter Aggregate View
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- Run AFTER supabase/institutional_sprint4_restricted_role.sql
--
-- Deferred from Sprint 5 by explicit decision: PatternTile is keyed by
-- bias_parameter (matches bias_library), not the 14-dim ontology vocabulary
-- Sprint 4's views cover. This is that second, separate aggregate view
-- type — same K_FLOOR discipline, different vocabulary, different source
-- table.
--
-- ── Schema note ──────────────────────────────────────────────────
-- bias_library is keyed by user_email (text), not user_id — a pre-
-- institutional table (see supabase/sprint1_add_ledger_tables.sql comment:
-- "identifier until auth is added"). This view bridges it to the user_id-
-- keyed institutional layer via auth.users.email. If a user's bias_library
-- rows were written under an email that no longer matches their current
-- auth.users.email (e.g. they changed their login email), those rows
-- silently fall out of this join — same visibility gap that already exists
-- anywhere else in the app that reads bias_library by current session
-- identity, not a new one introduced here.
-- ─────────────────────────────────────────────────────────────────

-- ── Platform-wide bias-parameter view ───────────────────────────────
create or replace view institutional_platform_bias_parameter_segments as
with consenting_users as (
  select distinct user_id
  from institution_memberships
  where consent_aggregate = true
),
consenting_emails as (
  select cu.user_id, u.email
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

-- ── Institution-scoped bias-parameter view ──────────────────────────
create or replace view institutional_bias_parameter_segments as
with member_emails as (
  select
    im.institution_id,
    coalesce(i.k_floor_override, k_floor_default()) as k_floor,
    im.user_id,
    u.email
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

-- Deliberately NOT selecting activation_contexts, detection_count, or
-- asymmetry_score_avg anywhere above — matches lib/cohort-sharing-fields.ts's
-- existing exclusion reasoning (activation_contexts especially: per its own
-- column comment "{decision_type: [...], pressure: [...], etc}" it may
-- carry decision-specific free text, not just a parameter label).
