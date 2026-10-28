# v11 — fewer steps before the Council, for any kind of decision

Builds on v10. Nothing here is specific to one decision type: the changes are in the chat engine, the confirm screen and
one examiner route option. No database change, no new API route. One new opt-in environment flag (idea 3).

## What changed

**1. A step can carry up to three related questions** (was two). The chat's planner makes a model call per step, so
three questions on one card instead of three steps removes round trips as well as screens. Only still-essential
questions that have an approved card group are batched; free-text and follow-up questions keep their own step; the
"walk me through it" mode stays one thing at a time; every question still counts as asked once and "Not sure" on any of
the three is recorded correctly. All answers still travel as ONE reply.
*How much this saves depends on the decision type:* a type whose essential questions mostly have cards (e.g. leaving a
job) now covers them in about one step; a job offer only has approved cards for "what's giving you pause" and the
deadline, so those two are batched and the rest stay separate.

**2. Preparing the session while the person is still on the confirm screen — NOT built as described.** Creating the
session early would leave a real session behind for everyone who looks at the confirm screen and leaves, which would
feed the session count (which decides what first-time users see), Mirror, the graph and the history list. Doing it
properly needs a "draft" session flag and filtering in every place sessions are read — a database change that should be
a deliberate decision. What was built instead (safe, small): the confirm screen now asks the examiner route to hold the
request for up to ~5 s and answer the instant the ontology tagger is done or has failed (`?wait=1`), instead of polling
once a second — no more waiting for the next tick, far fewer requests, and a failed tagger no longer costs ~9 s. The
route behaves exactly as before without the parameter.

**3. Returning, signed-in people are not re-asked situation facts.** From their own earlier, *confirmed* decisions,
Quorum passes the planner a few background lines (role and how long, money runway, who depends on them), each with how
long ago they said it (runway ≤ 120 days, the others ≤ 1 year), newest first. The planner already marks anything it
relies on "(from earlier)" so it appears that way in "What you told me" on the confirm screen, where the person can
correct it. Never reused: anything specific to one decision (the offer, the deadline, what they'd give up), anything they
said they didn't know, or anything that was itself carried over. First-time and anonymous people are unaffected.
**Off by default.** Enable with `NEXT_PUBLIC_INTAKE_HISTORY_REUSE=true` (requires `NEXT_PUBLIC_NATURAL_INTAKE_ENABLED=true`),
then redeploy. There is no per-person switch beyond that flag.

**5. "What matters most" is suggested, never the lean.** When the person's own words make one priority clear (at least
two mentions and a lead of at least two over the next), it arrives selected and labelled "Suggested from what you told
me — tap another to change it", so only the lean tap is then required. Built only from their own messages and taps. If
it isn't clear, nothing is suggested and both taps are required, as in v10. Their tap on Convene saves it.
*Worth knowing:* this value feeds Quorum's prediction and Mirror, so a suggestion the person doesn't question makes the
prediction partly circular. `council_launch_requested` now carries `priority_source` (`suggested` | `chosen` | `changed`) so
you can compare, and exclude if you wish, decisions where the priority was only suggested.

**6. A nudge toward a richer first message.** While typing a short, vague first message, one line appears under the box:
"Tip: add what you're choosing between, and any deadline — you'll get fewer questions." It never blocks sending, only
shows before the first send, and uses the existing richness scorer. "A rough version is fine" is unchanged.

**7. Tap-first answers for amount / duration / count / yes-no questions.** When a question has no card and no options of
its own, a small generic set is offered (percentage ranges, "Under 3 months…", "Under a year…", "None / 1–2 / 3–5 / More
than 5", "Yes / No"). Anything that is a choice ("A or B?"), open-ended, or unrecognised gets nothing, as before. Typing
and "Not sure" are still there.

(Idea 4 — a more prominent "That's enough, show me" — was intentionally not done.)

## Analytics

`intake_card_answered` / `intake_card_group_shown` `group_count` can now be 3. `council_launch_requested` adds
`priority_source`. No other event changes.

## Files

Changed: app/api/{chat-intake/route, examiner/route}.ts, components/{ChatCardStep, ChatIntake, DecisionCheckpoint}.tsx,
lib/{chat-intake-memory, chat-intake-turn, event-props, feature-flags, types}.ts,
tests/{chat-intake-personas, intake-gaps}.test.ts.
New: lib/{chat-intake-history, chat-intake-priority, chat-intake-quantity}.ts, tests/journey-v11.test.ts, this file.

## Verified

* `vitest`: 503 passing (472 after v10 + 31 new). Two existing tests were updated because they asserted the exact shape of
  the old two-group step; the persona simulator now answers a third group the way the screen does.
* `tsc --noEmit`: no new errors. `next build`: compiles, lints, type-checks.
* Browser-style harness (jsdom, not shipped), 26 scenarios, all passing: the 21 confirm-screen scenarios from v10
  (updated for the server-held wait) plus suggested priority (selected + labelled + lean-only required + reported;
  changing it; no suggestion), and the card step with one, two and three groups (open in order, collapse to one line,
  "Change" keeps entries, one reply sent, restore after a failed send).

## Not verified

* The planner's use of the "(from earlier)" background is the existing model behaviour; the new lines and the database
  read are unit-tested, but I could not run the model, so check a real returning-user chat with the flag on.
* Real-phone feel of a three-question card; whether the tap-first chips ever fit a question badly (watch for answers
  chosen as chips followed immediately by a typed correction).
