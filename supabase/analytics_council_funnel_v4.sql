-- Natural Intake v4 — Council funnel, last 7 days
-- Supersedes council_reach_last_7d.sql. Run in the Supabase SQL editor.
--
-- What changed from the earlier version:
--   • new stage "saw the prediction" (quorum_prediction_generated_at is set the
--     moment the prediction lands, which in v4 is right after the person
--     confirms their decision)
--   • "reached synthesis" now ALSO cross-checks sessions.session_depth, which
--     v4 finally writes ('council' once the first synthesis completes)
--   • the end-of-chat chip taps are counted (lean + priority are copied onto
--     the session at confirm time)
--
-- "Reached synthesis" is still defined by a synthesis_versions row with
-- version = 0 (written by SynthesisCard after the first stream completes).
-- Sessions created before v4 deploys never have session_depth = 'council', so
-- keep using synthesis_reached for any window that spans the deploy.
--
-- Requires: sprint_council_nudge_v4.sql only for the nudge query at the bottom.

with cohort as (
  select ci.id as chat_intake_id, ci.status as intake_status,
         ci.exchange_count, ci.session_id, ci.created_at
  from chat_intakes ci
  where ci.created_at >= now() - interval '7 days'
    -- and ci.user_email not in ('your-own-test-email@example.com')   -- exclude test accounts
),
enriched as (
  select
    c.*,
    (s.initial_instinct is not null and s.optimization_priority is not null)  as chips_saved,
    (s.quorum_prediction_generated_at is not null)                            as saw_prediction,
    exists (select 1 from examiner_responses er
            where er.session_id = c.session_id)                               as examiner_saved,
    (s.status = 'completed')                                                  as chose_im_done,
    exists (select 1 from synthesis_versions sv
            where sv.session_id = c.session_id and sv.version = 0)            as synthesis_reached,
    (s.session_depth = 'council')                                             as depth_council,
    (s.final_decision_locked_at is not null)                                  as decision_locked
  from cohort c
  left join sessions s on s.id = c.session_id
)
-- ── 1. Funnel ────────────────────────────────────────────────────────────────
select
  count(*)                                                        as chats_started,
  count(*) filter (where intake_status = 'checkpointed')          as confirmed_decision,
  count(*) filter (where chips_saved)                             as lean_and_priority_tapped,
  count(*) filter (where saw_prediction)                          as prediction_generated,
  count(*) filter (where examiner_saved)                          as quick_check_saved,
  count(*) filter (where chose_im_done and not synthesis_reached) as chose_im_done_no_council,
  count(*) filter (where synthesis_reached)                       as reached_synthesis,
  count(*) filter (where decision_locked)                         as locked_decision,
  round(100.0 * count(*) filter (where synthesis_reached)
        / nullif(count(*), 0), 1)                                 as pct_started_reaching_synthesis,
  round(100.0 * count(*) filter (where synthesis_reached)
        / nullif(count(*) filter (where intake_status = 'checkpointed'), 0), 1)
                                                                  as pct_confirmed_reaching_synthesis,
  -- sanity check on the new write: should equal reached_synthesis for any
  -- session created after v4 deployed
  count(*) filter (where depth_council)                           as session_depth_council
from enriched;

-- ── 2. Where each person stopped (mutually exclusive) ───────────────────────
with cohort as (
  select ci.id, ci.status as intake_status, ci.session_id
  from chat_intakes ci
  where ci.created_at >= now() - interval '7 days'
),
enriched as (
  select
    c.*,
    (s.initial_instinct is not null and s.optimization_priority is not null)  as chips_saved,
    (s.quorum_prediction_generated_at is not null)                            as saw_prediction,
    exists (select 1 from examiner_responses er where er.session_id = c.session_id) as examiner_saved,
    (s.status = 'completed')                                                  as chose_im_done,
    exists (select 1 from synthesis_versions sv
            where sv.session_id = c.session_id and sv.version = 0)            as synthesis_reached,
    (s.final_decision_locked_at is not null)                                  as decision_locked
  from cohort c
  left join sessions s on s.id = c.session_id
)
select
  case
    when decision_locked                      then '8. Locked a decision'
    when synthesis_reached                    then '7. Saw synthesis, did not lock'
    when chose_im_done                        then '6. Chose "I''m done" (skipped Council)'
    when examiner_saved                       then '5. Passed quick check, never saw synthesis'
    when saw_prediction                       then '4. Saw prediction, left before Convene'
    when intake_status = 'checkpointed'       then '3. Confirmed decision, left before prediction'
    when chips_saved                          then '2. Tapped lean/priority, did not confirm'
    else                                           '1. Left during chat'
  end as furthest_stage,
  count(*) as people
from enriched
group by 1
order by 1;

-- ── 3. Does the prediction match the lean? (echo check) ─────────────────────
-- If most predictions simply repeat the lean, the reveal is not adding
-- information. predicted vs. lean can only be compared loosely (free text vs.
-- accept/reject/unsure), so this lists the raw pairs for a human read.
select
  s.initial_instinct,
  s.quorum_predicted_choice,
  s.quorum_prediction_used_search as used_web_search
from sessions s
where s.intake_mode = 'chat'
  and s.quorum_prediction_generated_at >= now() - interval '7 days'
order by s.quorum_prediction_generated_at desc
limit 50;

-- ── 4. Stall-nudge audit (needs sprint_council_nudge_v4.sql) ────────────────
select
  count(*) filter (where council_nudge_sent_at >= now() - interval '7 days') as nudges_sent_7d,
  count(*) filter (
    where council_nudge_sent_at >= now() - interval '7 days'
      and exists (select 1 from synthesis_versions sv
                  where sv.session_id = sessions.id and sv.version = 0
                    and sv.created_at > sessions.council_nudge_sent_at)
  ) as reached_synthesis_after_nudge
from sessions;
