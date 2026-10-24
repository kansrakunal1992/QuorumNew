# Quorum — Natural Intake v8: answer cards inside the chat

Base: `QuorumZip23Oct.zip`. **No SQL migration. No new env vars. No new dependencies.** Deploy the whole zip at once
(`app/api/events/route.ts` must go out with the client, or the new events are silently dropped).

## What changed for the user
* The chat entry is unchanged. When Quorum's next question has options, a **card group** appears under its message:
  tap one or several, add context in your own words (inside the group), or say *None of these fit*, *Not sure*,
  *Prefer not to say* (money / family questions) or *Skip for now* (less critical questions). Typing in the message box still works.
* Selection rules per question: choose one · at least N · up to N · all that apply (selecting every option is allowed and
  is passed to Quorum as "ticked everything" for it to interpret, never rejected).
* **One confirmation, not two.** The in-chat "Did I get that right?" step is gone. When the chat has enough, it wraps →
  lean/priority taps → the summary screen, which is now the single confirmation. It shows *You started with…*, the refined
  decision, *What I understand so far* (only what you told us), the main unknown, and a possible tension (labelled as
  Quorum's reading). Confirm / Not quite / Add more are unchanged. Chats mid-playback at deploy time still finish correctly.
* Cards are **always on**. If a question has no usable options (or card building fails) it is asked as plain text, as before.

## How cards are chosen (approved templates + model adaptation + validation)
`lib/chat-intake-cards.ts` holds approved templates per decision type and question (job exit, offer, move, money, business,
relationship, education, purchase, other) with stable IDs and the selection rule. The planner sees the approved options and may
keep, drop, reword or add up to two of its own. The app then validates (length, duplicates, "not sure" look-alikes, unsafe words),
re-attaches stable IDs, caps the count (7 multi / 5 single), and falls back to the approved list.
Questions with free-form answers (e.g. "what is the role?") stay plain text.

## Council handoff
`assembleSessionInput` now adds: the person's original first words; intake readiness; "Chosen from options"; skipped/declined
items; "ticked every option" flags; unconfirmed tensions; and a source key. The verbatim transcript (all free text) is still appended.
Free text is **not** copied into `decision_state`; only option IDs/labels, skipped slots and model-noticed tensions are.

## Analytics (additive — nothing renamed or removed)
New events: `intake_card_group_shown`, `intake_card_answered`, `intake_card_freetext_opened`, `intake_council_ready`,
`intake_summary_shown`, `intake_summary_action`. IDs / counts / booleans only. Full mapping, risks and open questions:
`docs/decision-intake-analytics-marker-review.md`. Read-only queries: `supabase/analytics_intake_cards_v1.sql` (not yet run).

## Files
New: `lib/chat-intake-cards.ts`, `components/ChatCardGroup.tsx`, `tests/chat-intake-cards.test.ts`,
`docs/decision-intake-analytics-marker-review.md`, `docs/CHANGELOG_v8.md`, `supabase/analytics_intake_cards_v1.sql`.
Changed: `lib/types.ts`, `lib/track.ts`, `lib/chat-intake-turn.ts`, `lib/chat-intake-planner.ts`, `lib/chat-intake-plan-parse.ts`,
`lib/chat-intake-state.ts`, `app/api/chat-intake/route.ts`, `app/api/events/route.ts`, `components/ChatIntake.tsx`,
`components/DecisionCheckpoint.tsx`, `tests/chat-intake-turn.test.ts`, `tests/chat-intake-personas.test.ts`
(the last two updated for "no in-chat playback").

## Verified / not verified
* Verified: `tsc --noEmit` on the changed files (errors only from packages missing in this sandbox); 165 intake tests pass
  (41 new) using a small vitest stand-in (no network); scripted walkthrough of "Should I quit and start something of my own?".
* **Not verified:** no `next build`, no browser. Card UI, 320 px layout, keyboard/screen-reader behaviour and real-model card
  quality are untested — please click through on a phone before sending traffic. Firefox may not auto-advance single-choice taps
  (Continue still works).
* Please run `npm run lint && npm run build && npx vitest run` on your side.

## Known follow-ups (not done)
* The planner prompt still asks the model for a `playback` line that is now unused (small token waste) — safe to delete later.
* Typed text in a card group is lost if you navigate away mid-question (it is restored after a failed send).
* Quality-feedback survey from the brief, mobile-completion split, and a server-side prop deny-list for `intake_*` events.
* Cards + playback removal ship together, so their effects can't be separated in the funnel (see the analytics doc §17.5).
