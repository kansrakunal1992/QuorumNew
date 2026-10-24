# Decision intake — analytics marker review (Natural Intake v8, answer cards)

Written so another Claude session can re-inspect the instrumentation **without this conversation**.
Everything below was read from the repository snapshot `QuorumZip23Oct.zip`. Nothing was run against
production data, no dashboard was opened, and no downstream BI tool is visible from the repo, so
**analytics compatibility with historical data is "designed to be additive", not "verified live"** (see §17–18).

## 1. Existing flow stages (before v8)

| # | Stage | Where it lives |
|---|-------|----------------|
| 1 | Landing / chat entry (`/` → `NaturalIntakeClient`) | `app/NaturalIntakeClient.tsx`, `components/ChatIntake.tsx` |
| 2 | First message sent (creates `chat_intakes` row) | `POST /api/chat-intake` → `app/api/chat-intake/route.ts` |
| 3 | Intake turns: one planner call per turn → ask next slot (tap chips) / sharp-friend question / playback | `lib/chat-intake-planner.ts`, `lib/chat-intake-turn.ts`, `lib/chat-intake-brief.ts` |
| 4 | Playback "Did I get that right?" → chat wraps (`readyToReflect`) | `lib/chat-intake-turn.ts` (`closeTurn`) |
| 5 | Lean + priority chips, Continue | `components/ChatIntake.tsx`, `lib/chat-intake-lean.ts`, `app/api/chat-intake/lean/route.ts` |
| 6 | Checkpoint "Here's the decision I think you're making" (reflect / edit) | `components/DecisionCheckpoint.tsx` |
| 7 | Confirm → session created (`/api/chat-intake/checkpoint`) | `app/api/chat-intake/checkpoint/route.ts`, `lib/chat-intake-state.ts#assembleSessionInput` |
| 8 | Quick check (Examiner) → prediction reveal → "Convene the Council" / "I'm done" | `components/DecisionCheckpoint.tsx`, `PredictionReveal.tsx`, `app/api/chat-intake/done/route.ts` |
| 9 | Council synthesis | `components/SessionView.tsx`, `SynthesisCard`, `synthesis_versions` rows |

## 2. Existing event inventory (first-party `events` table)

Transport: `lib/track.ts` `track()` → `POST /api/events` (`app/api/events/route.ts`, **allow-list `ALLOWED_EVENTS`** — an
event not in that set is silently dropped) → table `events` (`supabase/phase0_events.sql`: `event, device_id, user_id,
session_id, decision_index, identity_state, props jsonb`). Server-only events: `lib/track-server.ts` (`paid_conversion`,
`mirror_unlocked`, written by `app/api/payment/webhook/route.ts`).

| Event | Trigger (source) | Props |
|---|---|---|
| `landing_view` | NaturalIntakeClient mount (`app/NaturalIntakeClient.tsx:73`) | `surface` |
| `return_visit` | NaturalIntakeClient (`:87`) | `hours_since, decisions` |
| `gate_arm_assigned` | ChatIntake mount | `arm, mode` |
| `starter_opened` / `starter_picked` | ChatIntake starter chips | – |
| `decision_started` | first chat message accepted (ChatIntake, after `onChatIntakeId`) | `entry:'chat', from_notification` |
| `notification_to_decision` | first message of a visit that began from an email | `source` |
| `decision_checkpointed` | person confirms the decision at the checkpoint (DecisionCheckpoint) | `signed_in` (+ `session_id` column) |
| `decision_completed` | "I'm done" (`path:'done'`, DecisionCheckpoint) or Council finished (`path:'council'`, SessionView) | `path` |
| `review_date_chosen`, `tally_seen`, `observation_seen`, `another_decision_clicked`, `park_*`, `habit_saved`, `auth_*`, `magic_link_requested`, `install_prompt_*`, `notification_*`, `mirror_viewed` | outside the intake path | various |

## 3. Existing marker inventory (DB-derived, not events)

| Marker | Definition | Source |
|---|---|---|
| Intake started | row in `chat_intakes` (`created_at`) | `chat_intakes` |
| Intake turns | `chat_intakes.exchange_count` | `app/api/chat-intake/route.ts` |
| Intake status | `chat_intakes.status` ∈ `active · checkpointed · abandoned` per the schema/type — **no code path in this snapshot writes `abandoned`** (grep: only the type in `lib/types.ts:176`); `'completed'` in `done/route.ts` is written to `sessions.status` | `supabase/sprint_natural_intake_v1.sql` |
| Lean / priority captured | `sessions.initial_instinct`, `sessions.optimization_priority` | copied at confirm |
| Saw prediction | `sessions.quorum_prediction_generated_at is not null` | `analytics_council_funnel_v4.sql` |
| Chose "I'm done" | `sessions.status = 'completed'` | same |
| **Reached synthesis (Council)** | a `synthesis_versions` row with `version = 0` | same — the canonical Council marker |
| Depth council | `sessions.session_depth = 'council'` (only reliable after v4 deploy) | same |
| Decision locked | `sessions.final_decision_locked_at is not null` | same |
| Meta Pixel | `PageView`, `ViewContent`, `CompleteRegistration` only — **none inside intake** | `components/MetaPixel.tsx`, `lib/meta-pixel.ts` |

Dashboards / views in the repo: `supabase/analytics_council_funnel_v4.sql` (7-day Council funnel, reads `chat_intakes`,
`sessions`, `examiner_responses`, `synthesis_versions`), `supabase/phase0_funnel_views.sql` (`v_actor_decisions`,
`v_retention_funnel`, built on `events` + `sessions`). **No external dashboard definitions are in the repo** — whatever
sits on top (Metabase / Supabase charts / sheets) is unknown (open question Q1).

## 4–8. Event names, triggers, properties, source files, services

Covered in §2/§3. Analytics services: first-party only (`events` table via `/api/events`, `trackServer`) + Meta Pixel
(marketing only). No Segment/GA/PostHog code found in `app/`, `components/`, `lib/`.
Identifiers: `device_id` (localStorage, consent-gated, optional), `user_id` and `identity_state` resolved server-side from
the bearer token, `session_id` passed via `track(..., { sessionId })`, `decision_index` from local history. There is **no
`chat_intake_id` on pre-v8 events** — v8 adds it to the new events so cards can be joined to `chat_intakes`.

## 9. Existing dependencies / conversion calculations

* Council reach = `synthesis_versions.version = 0` joined through `chat_intakes.session_id` (`analytics_council_funnel_v4.sql`).
* Abandonment: not written as a status anywhere. Derive it as `status = 'active'` with an old `last_turn_at`, or `checkpointed` with no `synthesis_versions` row. A stall nudge exists in `app/api/cron/council-nudge/route.ts` (not inspected in detail). No abandonment *event* exists.
* D1..D5 retention uses `events` + `sessions` (`phase0_funnel_views.sql`).
* `decision_checkpointed` / `decision_completed` are used by those views; **their names, triggers and props are unchanged in v8**.

## 10. Proposed redesigned flow stages (v8)

Chat entry (unchanged) → turns where the question shows **a card group** (approved template + model adaptation) →
chat wraps → lean/priority chips → **checkpoint summary (original words, refined decision, what Quorum understands,
tension/uncertainty)** → confirm → session → Council. **Stage 4 (the in-chat "Did I get that right?" playback) was removed**
at the owner's request, so the summary screen is the single confirmation. Cards change *how* a slot is answered.

## 11. Proposed event mapping

| Existing marker / event | In v8 | Status |
|---|---|---|
| `landing_view`, `decision_started`, `starter_*`, `gate_arm_assigned`, `notification_*`, `return_visit` | fire exactly as before | **retained unchanged** |
| `decision_checkpointed` | still fires on confirm; semantics identical | **retained unchanged** |
| `decision_completed` (`done` / `council`) | unchanged | **retained unchanged** |
| Intake started / turns / status / abandoned (`chat_intakes`) | unchanged — card answers are ordinary chat turns (`exchange_count` still +1 per answer) | **retained unchanged** |
| Intake question shown | *no pre-v8 event existed* (derive from `chat_intake_messages`); v8 adds `intake_card_group_shown` for card questions only | new, additive |
| Intake question answered | no pre-v8 event; v8 adds `intake_card_answered` | new, additive |
| Decision summary shown | no pre-v8 event; v8 adds `intake_summary_shown` | new, additive |
| Decision confirmed / edited | `decision_checkpointed` (confirm) retained; v8 adds `intake_summary_action {action: confirm|edit|add_more, edited}` | retained + new |
| Council entry shown / Council started | unchanged (`synthesis_versions` marker, `decision_completed path=council`) | **retained unchanged** |
| Current leaning / priority captured | unchanged (`sessions` columns) | **retained unchanged** |
| Time to Council | derive from `chat_intakes.created_at` → `synthesis_versions.created_at`; v8 adds `intake_council_ready.ms_to_ready` (chat start → ready) | retained + new |

## 12–14. Retained / remodelled / obsolete

* **Retained unchanged:** everything in §2 and §3.
* **Remodelled:** none. (Nothing that was measured before measures something different now.)
* **Obsolete:** none. One caution — the chip-tap path is still used for questions with no card group, so "chips tapped"
  style analyses keep working; for card questions, a tap is now `intake_card_answered`.

## 15. New events (all additive; added to `TrackEventName` in `lib/track.ts` **and** `ALLOWED_EVENTS` in `app/api/events/route.ts`)

| Event | Fires | Props (ids / counts / booleans only) |
|---|---|---|
| `intake_card_group_shown` | a card group appears (`ChatIntake.tsx`, once per question per turn) | `chat_intake_id, question_id, slot_key, decision_category, intake_step, select_mode, min_selections, max_selections(-1 = none), option_count, adaptive, essential, sensitive` |
| `intake_card_answered` | Continue / single tap / Not sure / None fit / Prefer not / Skip, **or** typed instead of tapping | `chat_intake_id, question_id, slot_key, decision_category, intake_step, response_type (cards·free_text_only·none_fit·not_sure·prefer_not·skip), selected_count, option_ids (comma list; model-written options collapse to "<slot>.adaptive"), used_free_text, all_selected, met_minimum, ms_to_answer` |
| `intake_card_freetext_opened` | "Add context" opened | `chat_intake_id, question_id, slot_key` |
| `intake_council_ready` | chat wraps (`readyToReflect`) | `chat_intake_id, readiness_state (ready·ready_with_unknowns·needs_more), unknown_count, decision_category, intake_step, card_groups_answered, skipped_count, has_tension, ms_to_ready` |
| `intake_summary_shown` | checkpoint summary loads | `chat_intake_id, readiness_state, decision_category, unknown_count, has_tension, changed_from_original` |
| `intake_summary_action` | confirm / edit / add_more at the checkpoint | `chat_intake_id, action, edited` |

Prompt-listed measures **not** implemented as separate events (derivable): option selected/deselected (only the final
selection is reported), minimum-selection-satisfied (`met_minimum`), "None of these"/"Not sure"/"Prefer not to say"/"Skip"
(`response_type`), select-all (`all_selected`), adaptive follow-up shown (`adaptive`, plus a card group at `intake_step` > 1),
detailed decision accepted/edited (`intake_summary_action`), Council-ready (`intake_council_ready`).
Not built: mobile-completion split (add `viewport` to `intake_council_ready` if wanted), post-intake quality survey
(the five feedback questions in the brief need UI + a store; out of scope), "return after interruption" (derivable from
`chat_intakes.last_turn_at` vs. the next message — no event).

Queries for all of the above: `supabase/analytics_intake_cards_v1.sql` (read-only; **not run**).

## 16. Privacy considerations

* No event carries free text, option wording, amounts, names or employers. `option_ids` are template ids; any
  model-written option is reported as `"<slot>.adaptive"`.
* **Caveat in existing code:** `cleanProps` in `app/api/events/route.ts` stores any string ≤200 chars a client sends.
  Privacy therefore depends on the *callers* (all v8 callers pass ids only; `tests/chat-intake-cards.test.ts` pins this).
  A server-side deny-list for v8 event props would be a cheap hardening step (not done — changes shared code).
* `decision_state` (unencrypted jsonb) now additionally stores `cardAnswers` (ids + the **approved/adapted option labels
  the person tapped**, never their typed text), `skippedSlots`, `contradictions` (model's reading). Free text stays only in the
  encrypted transcript (`chat_intake_messages.content`) and the session `context_text`, exactly as before. Model-adapted labels
  can echo a detail the person gave (e.g. a name) — same exposure class as the existing `facts` (≤160-char phrases).
* Sensitive questions (money ranges, who depends on you) are optional ("Prefer not to say"), and use ranges, not amounts.

## 17. Historical comparability risks

1. `exchange_count`/turns: a multi-select answer is still ONE turn, so turn counts should fall or stay flat — a
   *drop* after v8 is expected, not a regression.
2. "Time to Council" baseline unchanged (table-derived). `ms_to_ready` is new; no history before the v8 deploy date.
3. Cohorts straddling the deploy: card events exist only for chats started after deploy; treat as an A/B only if a flag
   is used (**v8 ships with no kill-switch** — see Q3).
4. `decision_checkpointed` rate may move because the checkpoint screen is richer; compare against `intake_summary_shown`.
5. **Confounded release:** cards AND the removal of the playback step ship together, so a change in turns, time-to-Council or
   Council reach cannot be attributed to either one alone. `chat_intake_messages` rows no longer include the playback
   question/“Yes, that's right” pair for new chats, so any analysis that counted those messages (e.g. `exchange_count` minus one
   for the playback) shifts by roughly one turn. Chats already mid-playback at deploy time still finish through the old path.

## 18. Data migration / dashboard risks

* **No migration required** (no schema change): `events.props` is jsonb; `chat_intakes.decision_state` is freeform jsonb.
* Existing views are untouched. Any external dashboard filtering on an *explicit event list* is unaffected (new names only).
* `ALLOWED_EVENTS` must be deployed together with the client — otherwise the new events are silently dropped (the route
  answers 204). Deploy the route and the client in the same release.

## 19. Open questions

* Q1. What reads `events` / `chat_intakes` outside this repo (Metabase, sheets, alerts)? Any with hard-coded event lists?
* Q2. Should `intake_*` events get a server-side prop deny-list (see §16)?
* Q3. ~~Flag for cards?~~ **Decided: cards are always on** (no flag). Consequence: there is no concurrent control group; compare
  pre/post cohorts using the table-derived markers (§3) instead, and note the playback removal ships in the same release (§17.5).
* Q4. ~~Two confirmations?~~ **Decided: removed the in-chat playback**; the checkpoint summary is the only confirmation.
* Q5. Quality feedback survey (5 questions in the brief): where should it live and where should answers be stored?

## 20. Recommended next steps for the next Claude session

1. Read `app/api/events/route.ts`, `lib/track.ts`, `components/ChatIntake.tsx` (search `intake_`), `components/DecisionCheckpoint.tsx`
   (search `intake_summary`), `lib/chat-intake-cards.ts` (`cardShownProps`, `cardAnsweredProps`).
2. Ask the owner for Q1; if dashboards exist, export their queries and diff against §2/§3.
3. After deploy, run `supabase/analytics_intake_cards_v1.sql` queries 1–3 and sanity-check one chat end-to-end
   (`chat_intake_id` ↔ `chat_intakes` ↔ `sessions` ↔ `synthesis_versions`).
4. Decide Q3/Q4, then compare median turns and Council reach (`analytics_council_funnel_v4.sql`) for pre/post cohorts.
