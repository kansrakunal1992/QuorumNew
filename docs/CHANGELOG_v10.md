# v10 — shorter journey to the Council

Goal: a brand-new person reaches the Council in fewer screens, with the Council still the hero and nothing the Council or
Mirror needs thrown away. Everything below is additive or a removal of a screen; no database change, no new API route, no
new environment variable.

## What a new person sees now

1. Landing — unchanged, except the sign-in card is held back for a visitor with no decisions on this device (the header
   "Sign in" link remains; the card still shows for anyone who already has decisions here). **The "N people already
   here" pill is untouched.**
2. Chat — same engine. A job offer is no longer asked "what could you negotiate?" (the Council raises countering, timing
   and start date itself). **The deadline question stays.** No cap on the number of steps was added.
3. One confirm screen — the decision in a sentence, where you lean, what matters most, and ONE primary button, **Convene
   the Council**. "What you told me / what you chose / my reading / who's involved" are folded behind "See what I
   understood" ("Still open" stays visible — it is what the Council will be told). "Did this capture it?" is gone from here.
   "Not quite — let me fix it", "Let me add more first" and "I'm done" are unchanged in behaviour.
4. Convene → straight to the Council. The separate "quick check" screen and the "Before the Council weighs in"
   screen (prediction + "worth a closer look") no longer exist on the normal path.
5. Session page — Quorum's hypothesis card is no longer shown above the Council (the prediction is still made, silently);
   the graph teaser moved from above the Council to below the six advisors.
6. After the Council — unchanged except: (a) one new tap, "Did this feel specific to you?" (sessions 1–5), and (b) one
   sentence in the "Make your decision" box no longer says "Now that you've seen Quorum's hypothesis".

## Rules that replaced the quick-check screen (lib/checkpoint-launch.ts)

* Only a CRITICAL question (one the Council cannot run without; R1/R7 redirects excluded) is ever put in front of the
  person, as "One thing before the Council runs" — or, if the chat already answered it, "Did I get this right?" (one tap).
* Every other question is recorded without a screen: chat-covered answers as "from chat" (`derived_from_chat = true`,
  which the scoring engines already ignore), the rest blank — exactly what tapping Continue with empty boxes did — and
  the Council is told they are unresolved.
  **Behaviour change to be aware of:** a chat-covered answer to a NON-critical question is now recorded when the person
  taps Convene (they have just reviewed what they told us), not when they tap "These look right" on a screen that showed
  it. Critical ones are still never recorded without the one-tap confirmation.

## Things found while reading the code that changed the plan

* The session page blocks on a lean + priority screen if they were not captured. So **where you lean / what matters most
  stay required** on the confirm screen (the Convene button stays grey until both are picked). Making them optional
  would just have moved those two questions to the next screen.
* The opening ceremony and "Quorum's Read" are already off when the unified-session flag is on (production), so there was
  nothing to merge on the session page. They are untouched.
* Outreach ("Want to hear from <name>?") needs a saved decision to attach to, so tapping that small line saves the
  decision first (same as Convene), then shows outreach above a Convene button. "You"/"me"/"myself" are never offered.
* The prediction is now made only by the session page (hidden), so there is a single caller and no 15-second wait on
  Convene. On the "I'm done" ending it is still made (it is that screen's payoff) and "Actually, convene" waits for it.
* The onboarding-tour step "Quorum's hypothesis, made before this" was removed — it pointed at the hidden card.
* The adaptive "insight" model call that fed "Worth a closer look" is no longer made (one model call saved per decision).
  `/api/chat-intake/insight` and lib/chat-intake-insight.ts are left in place, unused.
* The wait for the Examiner's questions is polled every 1 s (was 1.5 s) with the same ~9 s ceiling, and the waiting
  screen now says "Convening the Council…".

## Analytics

* `council_launch_requested` now also carries `check_shown` (was the one-question screen shown) and `auto_recorded`
  (chat-covered answers recorded without a screen). `derived_reviewed_on_reveal` is no longer sent.
* New: `council_specificity_feedback` with `specific = yes | partly | no`.
* `intake_summary_feedback` ("did this capture it") is no longer sent. `intake_summary_action` with `action = outreach` is new.
* Compare cohorts by `flow_version` / date: before vs after this release. Watch `intake_summary_shown` →
  `council_launch_requested` → `council_execution_started`, the share with `check_shown = true`, and the
  `council_specificity_feedback` split — that last one is the early warning if a shorter intake makes the first Council feel generic.

## Files

Changed: components/{ChatIntake, DecisionCheckpoint, PredictionReveal, QuorumPrediction, SessionView, StakeholderOutreach}.tsx,
lib/{chat-intake-brief, chat-intake-cards, event-props, track}.ts, app/api/events/route.ts,
tests/{chat-intake-brief, chat-intake-personas}.test.ts.
New: components/SpecificityCheck.tsx, lib/checkpoint-launch.ts, lib/real-stakeholders.ts, tests/journey-v10.test.ts, this file.

## Verified

* `vitest`: 472 passing (447 before + 25 new; 2 existing tests updated for the removed negotiables question).
* `tsc --noEmit`: no new errors (the 36 pre-existing target warnings are unchanged).
* `next build`: compiles, lints and type-checks.
* A throwaway browser-style harness (jsdom, not shipped) mounted the real confirm screen against a mocked server and
  passed 18 scenarios: single primary action and folded detail; lean/priority required; the walkthrough path (straight to the
  Council, correct rows saved, no prediction/insight call); critical gap; critical answered in chat; "Change this"; a slow
  Examiner (9 polls, then launch); double-tap (one session); edited text; save failure + "Continue anyway" + retry without
  re-saving the lean; checkpoint failure; rate limit; outreach (saves once, never re-creates, "You" never offered); the
  "I'm done" ending and "Actually, convene"; "Not now — I'm done" from the one-question screen; back to chat.

## Not verified (needs a real phone / real data)

* The session page itself was not rendered end to end (it is too large to mount without the full backend); it is covered
  by the type-check, the production build and source-level guards in tests/journey-v10.test.ts.
* Real-device look and feel of the shorter confirm screen, and how often a critical question actually appears.
