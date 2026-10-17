# Natural Intake v7 — adaptive decision brief

## Why

The intake chat was meant to help someone detail a decision, but "I want to quit
my job" or "Should I move to a different city" never produced the obvious
specifics (which job, what next, which city from and to). Root causes found in
the v4 code:

1. **The question picker was domain-blind.** Ten generic dimensions (feelings,
   success picture, who's involved, reversibility...) for every decision. The
   ontology tagger that understands what KIND of decision it is only ran after
   the chat ended.
2. **The prompt forbade specifics.** The reply writer could only ask about
   whatever the checklist said was missing, "never something not on this list".
3. **The score rewarded the wrong things.** "Decision statement" was any
   non-empty text; "two options" was satisfied by an inferred status quo, so a
   one-line opener scored ~45/100 with zero facts.
4. **v4's funnel work spent the question budget on feelings.** Gut feeling and
   success picture moved into the chat; with a 6-exchange ceiling (last one a
   closing line) specifics lost the budget fight.
5. **Fragile extraction.** 500-token cap + bare `JSON.parse` that silently kept
   the old state on failure, so a growing state could stall and re-ask.
6. **No test of question quality.**

## What changed

**Decision brief** (`lib/chat-intake-brief.ts`). Slots per kind of decision
(job exit, job offer, move, money, business, relationship, study, purchase,
other). Each required slot ends *known*, *explicitly unknown*, or *not
applicable*. The chat ends when the brief is filled, not after N questions.

**One call per turn** (`lib/chat-intake-planner.ts`). Extraction + readiness +
next question + playback + "sharp friend" check in one model call (was two,
and extraction could disagree with the reply). 1,400-token cap, `parseJSONLoose`
for fences / preamble / trailing commas. The model proposes; the server decides.

**Turn logic** (`lib/chat-intake-turn.ts`, pure and tested). Understands chips,
"not sure", "yes, that's right", "that's enough" without the model. A slot is
asked at most twice; an answer is never lost to a missed extraction; anything
open at wrap-up is flagged unknown and turned into a to-do.

**Adaptive depth.** First-message richness scoring; a one-line playback
("Here's what I've got … Did I get that right?"); a trigger question for sparse
openers; unnamed alternatives offered as chips; questions ranked by how much the
answer changes the advice; one final "what would a sharp friend still ask?".

**Easy answering.** Tap-answers under each question (typing always works);
"Not sure" is data; plain wording.

**UI.** Live "what I've got so far" panel (collapsed by default, dot meter, no
numbers), always-available "That's enough — show me", optional "Walk me through
it" start. Resumed chats restore the brief and the chips.

**Returning people.** Known background (accepted memory facts, life stage, risk
stance) is passed to the planner on the first three exchanges, never persisted
into `decision_state`.

**Session context.** The brief (kind, key facts, unknowns, to-dos) is written
into `context_text` for the ontology tagger and Council.

## Behaviour changes to be aware of

- Gut feeling and success picture are **no longer asked in chat** (still
  captured if volunteered). The checkpoint's derive-and-confirm step already
  asks E0/C0 when the chat didn't cover them.
- Chat ceiling 6 → **9 exchanges** (a backstop, not a target; a detailed first
  message ends in ~3). "Let me add more" still grants +3, absolute max 12.
- A playback confirmation (one tap) now precedes the lean / priority chips.
- Legacy `scoreCompleteness` / `shouldStopEarly` remain exported but no longer
  drive the chat. `extractDecisionState` is the (hardened) fallback if the
  planner call fails.
- No database migration: everything lives in the existing `decision_state` JSON.

## Targets (pinned in `tests/chat-intake-personas.test.ts`)

| Persona | Target |
| --- | --- |
| Power user (detailed opener) | 0 specifics asked, ≤ 2 questions, ≤ 4 exchanges |
| Rambler | ≤ 3 questions; never re-asks what they volunteered |
| Novice (vague opener) | trigger first, then the real specifics; ≤ 7 questions |
| Vague move | asks which city, from and to, within the first two questions |
| Evasive ("not sure" to everything) | each slot asked once; flagged unknowns + to-dos |
| Emotional (model extracts nothing) | still progresses; their own words are kept |

## Not covered / next

- Tests replay the orchestration with a scripted stand-in for the model. They do
  not measure real model wording — run a handful of live openers per persona
  against the real provider before rollout.
- Chip and question copy is first-pass; worth a pass from whoever owns voice.
- `docs/COPY_AND_STRUCTURE_LOCK_v1.md` Screen 2 updated to match.
