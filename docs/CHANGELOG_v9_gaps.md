# Quorum — Natural Intake v9, gap-closing pass (checklist points 4, 5, 6, 7, 10)

Same deploy notes as Sprint 2 (the claim migration is already in that zip). No new env vars, dependencies or events.

## What I could close in code — and did
| Point | Gap | Now |
|---|---|---|
| **4** | Duplicate detection was literal word overlap, so a paraphrase slipped through | Light stemming + a domain synonym map (cash/savings/pay/salary, quit/leave, job/role/work, partner/wife/kids…). Works on 2-word asks too (both words must match). A golden set of paraphrases and non-duplicates is pinned in tests. **Still lexical**: a paraphrase that shares no vocabulary can pass the word check — the *slot-level* gap check (what is already on file) is the second layer, and is tested to catch the common cases |
| **5** | "Useful reflection" was only checked by rules | **Found by building a golden set:** the validator was *rejecting* 4 of 5 reflections I judged good (it didn't know job≈work, treated "the Council" as jargon, and didn't recognise "yet / though / whether" as a distinction). Fixed with the synonym map, allowing "Council", and a wider distinction check — without loosening the rejections (generic acknowledgement, advice, mind-reading, questions, label echoes, not-grounded all still rejected, 7 bad cases pinned). Also new: a **near-repeat check** (hashed fingerprints of the last 3 reflections, never text) so Quorum can't say nearly the same thing twice |
| **6** | A later typed correction left the old tap under "What you chose" | The tap is now flagged `superseded` (kept, never deleted) when the planner names the corrected slot **and** gives a new value. Summary shows the newer words first, "(you earlier chose: …)"; Council context lists it under "Earlier taps the person later changed". Planner prompt updated |
| **7** | Launch logic was only read, not exercised | Claim / release / stale-claim / "never block a launch because the claim failed" / per-person IP forwarding extracted to `lib/chat-intake-checkpoint-helpers.ts` and tested against a fake database |
| **10** | "Change" on a collapsed first answer **lost the entries** (and wiped the second group) — a real bug found by re-reading the component | Both groups now stay mounted and are only hidden, so Change restores every selection and typed word. Static tests pin the accessibility structure (fieldset/legend, radio/checkbox, live regions, alerts, 16 px input, one-column grid, no `preventDefault` on inputs) and lint every approved card template (2–7 options, unique ids/labels, ≤ 60 chars, no look-alikes of the system buttons) |

## What cannot be closed without external feedback (and why)
| Point | Needs | Why code can't do it |
|---|---|---|
| 4 | Real conversations | Whether a *semantic* paraphrase slips through is an empirical rate. Measure it: in the live review, count extra questions that repeat something already said |
| 5 | The live planner model | The validator now has a labelled regression set, but whether the model *produces* useful reflections, and how often they are rejected, only shows up in `intake_reflection_shown.reason` after real chats. If rejections are mostly `not_grounded` / `no_distinction`, tune the prompt — don't loosen the validator |
| 6 | The live planner model | Whether it reliably emits `correctedSlots` when someone changes their mind is model behaviour |
| 7 | Signed-out / free / elite runs, two tabs, the real database and proxy | Gates and the proxy's `x-forwarded-for` behaviour are environment facts. Confirm the 429 rate on `/api/session` drops after release |
| 10 | A phone, a screen reader, 200 % zoom, the real model across the 11 openers | Layout, focus and announcement behaviour, and card relevance on real phrasing, can't be asserted from source. `docs/INTAKE_LIVE_REVIEW_PROTOCOL.md` has the exact checks |

## Files
New: `lib/chat-intake-checkpoint-helpers.ts`, `tests/intake-gaps.test.ts`, `docs/CHANGELOG_v9_gaps.md`.
Changed: `lib/types.ts`, `lib/chat-intake-depth.ts`, `lib/chat-intake-reflection.ts`, `lib/chat-intake-cards.ts`, `lib/chat-intake-turn.ts`,
`lib/chat-intake-plan-parse.ts`, `lib/chat-intake-planner.ts`, `components/ChatCardStep.tsx`, `app/api/chat-intake/checkpoint/route.ts`,
`docs/decision-intake-analytics-marker-review.md`.

## Verified
`tsc` clean on the changed files (apart from my stand-in React types); 241 scripted intake tests pass (33 new). Nothing here was run in a browser or against the live model.
