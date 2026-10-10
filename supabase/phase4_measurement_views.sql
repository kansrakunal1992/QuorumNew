-- QUORUM -- Phase 4: measurement views for the retention work
-- Needs supabase/phase0_events.sql, phase0_funnel_views.sql and phase2_3_notifications.sql.
-- Safe to re-run (create or replace).

-- 1. Gate experiment -----------------------------------------------------------
-- One row per device: the arm it was assigned (first gate_arm_assigned event).
create or replace view v_gate_arm_devices as
select distinct on (device_id)
  device_id,
  props ->> 'arm' as arm,
  created_at      as assigned_at
from events
where event = 'gate_arm_assigned' and device_id is not null
order by device_id, created_at asc;

-- D1 -> D5 reach per arm, counted from sessions on the device.
-- READ IT LIKE THIS: compare d4 / d1 (and d3 / d1) ACROSS arms. Do NOT compare
-- authenticated vs anonymous people -- that is selection-biased; the arms are
-- the control. Restrict to devices assigned long enough ago to have had the
-- chance (e.g. assigned_at < now() - interval '30 days') when you read it.
create or replace view v_gate_experiment as
with per_device as (
  select
    a.arm,
    a.device_id,
    count(s.id)                                    as n_decisions,
    bool_or(s.user_id is not null)                 as ever_linked
  from v_gate_arm_devices a
  left join sessions s on s.device_id = a.device_id
  group by a.arm, a.device_id
)
select
  arm,
  count(*)                                           as devices,
  count(*) filter (where n_decisions >= 1)           as d1,
  count(*) filter (where n_decisions >= 2)           as d2,
  count(*) filter (where n_decisions >= 3)           as d3,
  count(*) filter (where n_decisions >= 4)           as d4,
  count(*) filter (where n_decisions >= 5)           as d5_plus,
  count(*) filter (where ever_linked)                as linked,
  round(100.0 * count(*) filter (where n_decisions >= 4)
        / nullif(count(*) filter (where n_decisions >= 1), 0), 1) as pct_d1_reaching_d4
from per_device
group by arm;

-- 2. Notification funnel (last 30 days) ----------------------------------------
-- sent       <- notification_log (the shared throttle table)
-- opened     <- events.notification_opened     (visit arrived with ?n=<source>)
-- to_decision<- events.notification_to_decision (that visit started a decision)
-- Sources: weekly_brief, pattern_notice are in both. review_date emails are
-- tagged (?n=review_date) but are logged by their own cron, not notification_log,
-- so they show opened/to_decision with sent = null. daily_nudge / validation_nudge
-- links are not tagged yet, so they show sent only.
create or replace view v_notification_funnel_30d as
with sent as (
  select source, count(*) as sent
  from notification_log
  where sent_at > now() - interval '30 days'
  group by source
),
opened as (
  select props ->> 'source' as source, count(*) as opened
  from events
  where event = 'notification_opened' and created_at > now() - interval '30 days'
  group by 1
),
conv as (
  select props ->> 'source' as source, count(*) as to_decision
  from events
  where event = 'notification_to_decision' and created_at > now() - interval '30 days'
  group by 1
)
select
  coalesce(s.source, o.source, c.source)             as source,
  s.sent,
  o.opened,
  c.to_decision,
  round(100.0 * o.opened      / nullif(s.sent, 0), 1) as pct_opened_of_sent,
  round(100.0 * c.to_decision / nullif(o.opened, 0), 1) as pct_decided_of_opened
from sent s
full join opened o on o.source = s.source
full join conv   c on c.source = coalesce(s.source, o.source)
order by 1;

-- 3. Habit adoption ------------------------------------------------------------
create or replace view v_habit_adoption as
select
  coalesce(brief_cadence, '(not chosen)')   as cadence,
  count(*)                                  as people,
  count(*) filter (where weekly_brief_opted_out) as unsubscribed_weekly
from user_preferences
group by 1
order by 2 desc;

-- 4. Everything the client/server logs, last 14 days ---------------------------
create or replace view v_event_counts_14d as
select event, identity_state, count(*) as n
from events
where created_at > now() - interval '14 days'
group by 1, 2
order by 1, 2;

-- Full event list now logged (see README): landing_view, return_visit,
-- decision_started, decision_checkpointed, decision_completed,
-- another_decision_clicked, park_started, park_saved, tally_seen,
-- observation_seen, habit_saved, review_date_chosen, auth_prompt_seen,
-- auth_started, magic_link_requested, auth_skipped, auth_completed,
-- gate_arm_assigned, install_prompt_seen, install_prompt_accepted,
-- notification_opted_in, notification_opened, notification_to_decision,
-- mirror_viewed, mirror_unlocked (server), paid_conversion (server).
-- d1..d5 completion is derived from sessions (phase0_funnel_views.sql), not events.
