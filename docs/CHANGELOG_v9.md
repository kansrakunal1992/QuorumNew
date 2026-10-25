# Quorum — Natural Intake v9 (Sprint 1 of 2): Ask → learn → give something back → ask only what is essential → reframe → confirm → Council

Base: your deployed v8 (`QuorumV8_cards_changed_files.zip` on top of `QuorumZip23Oct`). **No SQL migration, no new env vars, no new
dependencies.** Deploy the whole zip at once (`app/api/events/route.ts` must ship with the client or the new events are dropped).
Assumption: no other edits to these files since v8 — please re-send the latest zip if there have been any.

## What the person experiences
1. Same chat, same branding. The first message is unchanged.
2. **Questions are only what the Council needs.** Stakes (the model's read, raised by reversibility) set how deep to go. A low-stakes
   decision stops sooner; a high-stakes one keeps asking. Safety ceilings are 5 / 7 / 9 exchanges and are *stops*, never a target.
3. **Critical fields are conditional, not universally deferred.** Money runway is asked whenever the chosen route puts income at risk
   (and skipped only when a job is already lined up or stakes are low). "Has anyone seen the idea?" is asked only on a build-my-own
   path. "Who depends on you?" is asked when income is at risk and they haven't already said. Nothing is skipped because of its category.
4. **Related questions share one step.** The first card group answers the question in the bubble; a related, still-essential group opens
   in place beneath it once the first is answered (the first collapses to one tappable line). One reply carries both. Free text,
   "None of these fit", "Not sure", "Prefer not to say" / "Skip" exist in each group. Questions already answered (typed or tapped)
   are never shown.
5. **Something back between questions.** From the second message on, at most one question turn in a row goes out without a short
   reflection above the question — a distinction, a connection, a possible tension or why the next question matters. It must be built
   from the person's own words/taps, provisional ("may", "sounds like"), not a question, not advice, not a guess at feelings, and not a
   repeat of the labels they tapped. A reflection that fails those checks is **dropped** — never replaced by filler.
6. **The one extra question is gated.** It is asked only when the planner names a real gap (tension, validation, feasibility, who is
   affected, reversibility, timing), that gap is genuinely still open on file, and the question doesn't repeat anything asked or known.
   Never on a low-stakes decision.
7. **One confirmation, and it states readiness honestly.** The chat hands straight over to the summary screen. It says either
   "Your decision now has enough context for the Council…" or that Quorum stopped with essential details still open and won't guess.
   The summary separates **What you told me** · **What you chose** · **My reading (provisional)** · **Still open** (skipped / not known /
   not asked / still open), shows the original words and the refined decision, and now also holds the lean + priority taps — so the old
   end-of-chat panel and its Continue button are gone.
8. **Edits and corrections win.** If you rewrite the decision, your wording becomes the decision, is kept on the chat, and the Council
   gets a note that it supersedes Quorum's earlier framing (which is still included, labelled superseded). Answering a question about a
   tension clears Quorum's earlier inference and records your words as a correction. Tapped selections and typed text both still reach
   the Council (selections in the structured lines, all text verbatim in the transcript).
9. **Retry-safe launch.** A double tap can't start two creations; a retry after a dropped response resumes the existing session; a
   failure now shows a message instead of silently bouncing you back.
10. When every Examiner question was already answered in the chat, those answers are listed on the reveal screen (with "Change any of
    these") and are recorded — labelled from-chat, exactly as before — only when you tap Convene. No Examiner step is removed or faked.

## Effort, reported separately (typical "quit and start something" decision)
| | v8 (before) | v9 (scripted walkthrough) | Notes |
|---|---|---|---|
| User submissions | ≈ 7 (opener, 5 answers, 1 extra) | **4** (opener + 3 steps) | scripted; real users vary |
| Individual taps | ≈ 5 card taps + lean 2 + Continue + confirm + Examiner "continue" + Convene ≈ 11 | 5 card taps + lean 2 + confirm + Convene ≈ **9** (Examiner step skipped only if fully chat-covered) | taps fall far less than submissions — fewer turns ≠ much less effort |
| Planner model calls (chat) | 1 per submission = ≈ 7 | **4** | post-chat calls unchanged: ontology tagger, prediction, insight, Examiner derivation (≥ 4) |
| Elapsed time | **not measured** | **not measured** | the Examiner poll can wait up to ~9 s (6 × 1.5 s) for the ontology tagger; unchanged. Use the new events to measure |

## Files
New: `lib/chat-intake-depth.ts`, `lib/chat-intake-reflection.ts`, `components/ChatCardStep.tsx`, `tests/chat-intake-v9.test.ts`,
`docs/CHANGELOG_v9.md`. Changed: `lib/types.ts, chat-intake-brief.ts (validation slot, deferred), chat-intake-cards.ts, chat-intake-turn.ts,
chat-intake-planner.ts, chat-intake-plan-parse.ts, chat-intake-state.ts, track.ts`, `app/api/chat-intake/route.ts`,
`app/api/chat-intake/checkpoint/route.ts`, `app/api/events/route.ts`, `components/ChatIntake.tsx, ChatCardGroup.tsx,
DecisionCheckpoint.tsx, PersonaPanel.tsx` (one marker call), `docs/decision-intake-analytics-marker-review.md` (v9 section),
`tests/chat-intake-turn.test.ts`, `tests/chat-intake-personas.test.ts` (updated for the new behaviour).

## Acceptance tests (what each proves, and what it does NOT)
Legend: **C** verified by reading the code · **S** scripted test (no real model) · **L** needs the live model · **P** needs production data.
| # | Test | Level | Status |
|---|---|---|---|
| 1 | Ceiling scales 5/7/9 and never raises the base; irreversibility raises stakes | S | pass |
| 2 | Runway deferred only when a job is lined up / still employed / low stakes; critical when income at risk or path unknown | S | pass |
| 3 | Validation / people critical only on matching paths, suppressed when already said | S | pass |
| 4 | Wrap records gaps vs not-asked separately; not-asked never shown as "unknown" | S | pass |
| 5 | Readiness copy honest about gaps | S | pass |
| 6 | Extra question: never low-stakes; needs named open gap; no duplicates; not about a non-material slot | S | pass |
| 7 | Reflection validator rejects generic ack / question / advice / mind-reading / not provisional / not grounded / repeats labels / too short | S | pass |
| 8 | Rejected reflection is omitted, counter increments, reason reported | S | pass |
| 9 | Pairing: companion only for an essential, card-able slot; both answers recorded; companion text never leaks into the primary fact | S | pass |
| 10 | "Not sure" on the second group → unknown + to-do; typed reply leaves the companion open | S | pass |
| 11 | Edited decision is authoritative and annotated in the Council context; original wording, tapped selections and deferred list survive | S | pass |
| 12 | Answering a tension question clears the inference and records the correction | S | pass |
| 13 | Existing suites (turn, personas, brief, plan-parse, natural-intake-v4, readiness-gate, cards) | S | pass (updated where behaviour intentionally changed) |
| 14 | Combined step on a 320 px phone: no horizontal scroll, ≥ 44 px targets, one column, focus moves to the second group, live region announces it, 200 % zoom | L/manual | **NOT RUN** — no browser here |
| 15 | Keyboard: arrow keys in a single-select group don't auto-submit; Tab order; screen reader announces rule + count | manual | **NOT RUN** |
| 16 | Real-model card relevance across: quit-and-start, change job, accept offer, buy vs rent, move abroad, back to college, invest vs repay loan, sell business, another child, new phone, "I don't know what to do" | L | **NOT RUN** — review 5 transcripts each; target: no irrelevant option on screen, ≥ 3 submissions typical for high-stakes, ≤ 2 for the phone |
| 17 | Reflection acceptance rate and "grounded, not generic" on real transcripts | L/P | **NOT RUN** — watch `intake_reflection_shown.reason` |
| 18 | Stakes calibration (phone = low, quitting = high, house = high) | L | **NOT RUN** |
| 19 | Card failure fallback: planner down / bad chips → approved cards → plain text; Council still reachable | S + C | pass (turn/cards suites) |
| 20 | Signed-out and free-tier launch; synthesis actually starts; retry after a dropped checkpoint response | L/P | **NOT RUN** — gates not traced (see analytics doc §v9.5) |
| 21 | No sensitive text in analytics (props are ids/counts) | S + C | pass for card events; **new** events were written to the same rule but have no dedicated test |

## Known gaps / Sprint 2 (medium & low) — not done
* Concurrent double-launch is only mitigated (client guard + idempotent resume); a real claim needs a column/migration.
* Examiner R2/R3 critical rules still gate the Council after the summary; the better fix is asking their precursors in chat when
  material — needs the rule definitions reviewed first. Do **not** derive answers server-side without teaching the three scoring engines.
* `submitExaminer` swallows failures; surface/retry. Show the question text next to each derived answer on the reveal screen.
* Live-model review of card relevance and reflection quality (tests 16–18); tune the validator from real rejection reasons.
* Remove the now-unreachable end-of-chat lean panel code in `ChatIntake.tsx` (left in place to keep this diff reviewable).
* Quality-feedback survey, mobile-vs-desktop completion split, server-side prop deny-list for `intake_*` events, `intake_checkpoint_error` alert.
