# Quorum — Natural Intake v9, Sprint 2 (medium & low priority) — on top of Sprint 1

**Deploy order:** run `supabase/sprint_intake_v9_claim.sql` (one nullable column, idempotent) — the code is safe either way (it skips the
claim and logs if the column is missing). Then deploy the zip. No new env vars or dependencies.

## What changed
* **Launch hardening (code-verified bug + fixes).** The internal session call shared one IP rate-limit bucket across all users (20 launches / 15 min for everyone) — it now forwards the real client IP. A concurrent double-launch is claimed away with a conditional write; a rate limit is reported as a wait, not an error; a retry resumes the existing session; `decision_checkpointed` no longer double-fires on a resume.
* **No more silent Examiner save failures.** The save checks the response and retries; on failure the Council is not launched silently — the person can retry or "Continue anyway" (the session page asks anything critical). This matters because synthesis only starts once the Examiner rows are ready.
* **Reveal screen shows the question beside each answer taken from the chat**, with "Change any of these".
* **One-tap quality signal** on the summary: "Did this capture what you're really deciding?" (Yes / Partly / Not really) → `intake_summary_feedback`.
* **Server-side privacy guard** for every intake / launch event (`lib/event-props.ts`): only known prop keys, identifier-shaped values.
* **Mobile vs desktop split:** `viewport` on `intake_step_shown`, `intake_summary_shown`, `intake_council_ready`.
* **Docs:** analytics review updated with the verified gates, the synthesis trigger, the R2/R3 finding and the unresolved gaps; `docs/INTAKE_LIVE_REVIEW_PROTOCOL.md` for everything that needs a phone or the real model.

## Deliberately not done
* **Pre-empting R2/R3 in chat** — they are computed from a scored vector of the finished session (`lib/rule-engine.ts`); doing it earlier means running the scorer before a session exists. Left as the only unavoidable post-summary questions.
* **Server-side derivation of Examiner answers** — would change what the bias/independence/contradiction engines see (they ignore `derived_from_chat`). Not done.
* **Removing the unreachable end-of-chat lean panel** in `ChatIntake.tsx` — intertwined with the `closing` flag in many conditions; removing it blind was riskier than leaving dead code. Remove after one clean production week.
* **A standalone live-model script** — the production planner routes through `lib/ai-client.ts`; a different client would not test the same thing. The protocol runs the real app instead.

## Verified vs not
* **Code-verified:** the shared rate-limit bucket, the silent save failure, the auto-start of synthesis, the absence of payment gates, tier-only middleware.
* **Scripted (all intake suites):** 208 tests pass, including 5 new ones for the analytics guard.
* **Not run (needs you):** the live review protocol (relevance, reflections, launch, double-click, mobile, accessibility), the SQL migration, and any production measurement.
