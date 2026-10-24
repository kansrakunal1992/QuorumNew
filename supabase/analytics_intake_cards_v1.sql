-- Natural Intake v8 — card analytics, last 30 days (READ-ONLY queries; creates nothing).
-- Source: the first-party `events` table (supabase/phase0_events.sql). The new events are
--   intake_card_group_shown · intake_card_answered · intake_card_freetext_opened
--   intake_council_ready · intake_summary_shown · intake_summary_action
-- Props are stable ids / counts / booleans only — never option wording or free text.
-- Every earlier event (landing_view, decision_started, decision_checkpointed, decision_completed ...)
-- and the chat_intakes / sessions based funnels (analytics_council_funnel_v4.sql) are unchanged and
-- remain the comparable baseline. NOT yet run against production data — treat results as unverified
-- until you have eyeballed a few rows.

-- 1) Per question: shown -> answered, how people answered, how long it took.
select
  props->>'question_id'                                                     as question_id,
  count(*) filter (where event = 'intake_card_group_shown')                 as shown,
  count(*) filter (where event = 'intake_card_answered')                    as answered,
  count(*) filter (where event = 'intake_card_answered' and props->>'response_type' = 'cards')          as picked_cards,
  count(*) filter (where event = 'intake_card_answered' and props->>'response_type' = 'free_text_only') as typed_instead,
  count(*) filter (where event = 'intake_card_answered' and props->>'response_type' = 'none_fit')       as none_fit,
  count(*) filter (where event = 'intake_card_answered' and props->>'response_type' = 'not_sure')       as not_sure,
  count(*) filter (where event = 'intake_card_answered' and props->>'response_type' = 'prefer_not')     as prefer_not,
  count(*) filter (where event = 'intake_card_answered' and props->>'response_type' = 'skip')           as skipped,
  count(*) filter (where event = 'intake_card_answered' and (props->>'used_free_text')::boolean)        as used_free_text,
  count(*) filter (where event = 'intake_card_answered' and (props->>'all_selected')::boolean)          as selected_all,
  round(avg((props->>'selected_count')::numeric) filter (where event = 'intake_card_answered' and props->>'response_type' = 'cards'), 2) as avg_selected,
  percentile_cont(0.5) within group (order by (props->>'ms_to_answer')::numeric)
    filter (where event = 'intake_card_answered') / 1000                    as median_seconds_to_answer
from events
where created_at >= now() - interval '30 days'
  and event in ('intake_card_group_shown', 'intake_card_answered')
group by 1
order by shown desc;

-- 2) Chat -> Council-ready -> summary -> confirmed (per chat_intake_id).
with ready as (
  select distinct props->>'chat_intake_id' as cid, props->>'readiness_state' as readiness_state,
         (props->>'intake_step')::int as steps, (props->>'ms_to_ready')::numeric as ms_to_ready
  from events where event = 'intake_council_ready' and created_at >= now() - interval '30 days'
),
shown as (select distinct props->>'chat_intake_id' as cid from events where event = 'intake_summary_shown' and created_at >= now() - interval '30 days'),
acted as (
  select props->>'chat_intake_id' as cid,
         bool_or(props->>'action' = 'confirm') as confirmed,
         bool_or(props->>'action' = 'confirm' and (props->>'edited')::boolean) as confirmed_after_edit,
         bool_or(props->>'action' = 'edit') as opened_edit,
         bool_or(props->>'action' = 'add_more') as went_back
  from events where event = 'intake_summary_action' and created_at >= now() - interval '30 days' group by 1
)
select
  count(*)                                                       as council_ready,
  count(*) filter (where r.readiness_state = 'ready_with_unknowns') as ready_with_unknowns,
  count(s.cid)                                                   as saw_summary,
  count(*) filter (where a.confirmed)                            as confirmed,
  count(*) filter (where a.confirmed_after_edit)                 as confirmed_after_edit,
  count(*) filter (where a.went_back)                            as went_back_to_chat,
  percentile_cont(0.5) within group (order by r.steps)           as median_intake_turns,
  percentile_cont(0.5) within group (order by r.ms_to_ready) / 1000 as median_seconds_to_ready
from ready r left join shown s using (cid) left join acted a using (cid);

-- 3) Join to the existing Council funnel: of the chats that reached "Council-ready" with cards, how many
--    reached synthesis (same definition as analytics_council_funnel_v4.sql: synthesis_versions.version = 0).
select
  count(*)                                                              as chats_with_cards,
  count(*) filter (where ci.session_id is not null)                     as confirmed_into_session,
  count(*) filter (where exists (select 1 from synthesis_versions sv
                                 where sv.session_id = ci.session_id and sv.version = 0)) as reached_synthesis
from chat_intakes ci
where ci.id::text in (select distinct props->>'chat_intake_id' from events
                      where event = 'intake_card_group_shown' and created_at >= now() - interval '30 days');
