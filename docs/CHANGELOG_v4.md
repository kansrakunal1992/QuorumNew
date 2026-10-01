# Natural Intake v4 — get people to the Council

Built on `QuorumZip1Oct.zip` (v3 applied). The 7-day funnel showed chat-intake
sessions reaching synthesis 5 of 16 times (31%) against 3 of 3 for classic.
This drop shortens the path, makes the Council the obvious next step, and adds a
prediction as the hook. The chat's own mechanics (extraction, completeness
scoring, derive-and-confirm) are unchanged in shape.

## Setup

1. **Run the migration:** `supabase/sprint_council_nudge_v4.sql`
   (adds `sessions.council_nudge_sent_at`). Nothing else needs a migration —
   the lean/priority taps live inside the existing `chat_intakes.decision_state`
   JSON, and `session_depth = 'council'` already exists in the v1 check.
2. **Schedule the nudge:** cron-job.org, `POST https://app.quorumvault.org/api/cron/council-nudge`,
   header `Authorization: Bearer <CRON_SECRET>`, daily `0 3 * * *`. No new env vars.
3. **Flags:** the lean chips, the early prediction and the reveal need
   `NEXT_PUBLIC_UNIFIED_SESSION_ENABLED` on (the same flag the old lean screen
   used). With it off, the chat ends with a plain Continue button, no
   prediction is generated, and the reveal screen shows just the early read and
   the Convene button.
4. Redeploy.

## The new flow

Chat → **two taps at the end of the chat** (where you're leaning, what matters
most) → "Here's the decision I think you're making" → **quick check** (only if
something is still needed; skipped otherwise) → **reveal** ("You lean X / we
predict Y") with Convene the Council as the one primary button → session page.
No timer anywhere. The separate lean screen after the checkpoint is gone.

## What changed

| Area | Change |
|---|---|
| `components/ChatIntake.tsx` | 5-second timer removed. When the chat is complete, a panel under Quorum's closing line shows lean chips (built from the chat's own options + "Not sure yet") and priority chips. Both required; Continue saves them then hands off. "Add one more thing first" re-opens the input. |
| `app/api/chat-intake/lean/route.ts` (new) | Saves the taps into `decision_state`. Same value contract as the old instinct route. |
| `app/api/chat-intake/checkpoint/route.ts` | Copies lean + priority onto the new session in the same write as `session_depth`. Returns `leanSaved`. |
| `lib/chat-intake-state.ts`, `lib/chat-intake-reply.ts`, `lib/types.ts` | Two new slots, `gutFeeling` and `successPicture` (the Examiner's E0 / C0 topics), with weights rebalanced so the chat is no longer than before ("what matters most" is no longer asked in chat — the chip covers it). Chip-set fields survive later extraction runs. Closing line now introduces the taps. |
| `components/DecisionCheckpoint.tsx` | Lean step removed. Prediction starts the moment the session exists. Quick check groups chat-covered answers behind one "These look right" tap and asks only real gaps; skipped if none. New reveal screen. Convene is always primary; "I'm done" is a text link. "I'm done" screen's second chance is now the primary button. |
| `lib/prediction-engine.ts`, `app/api/persona/predict/route.ts` | Prediction now sees the option labels, the exact lean label, and the gut / success lines, and is told not to echo the lean (when it matches, it names the doubt most likely to test it). Classic sessions behave as before. |
| `app/api/session/[id]/synthesis-version/route.ts` | Writes `session_depth = 'council'` after the first synthesis is saved. Nothing wrote it before. |
| `app/api/cron/council-nudge/route.ts` (new) | 24h–7d after a chat session got a prediction but never reached synthesis: one email + push, "We predicted you'd choose X. See if the Council agrees." Shares the cross-cron throttle and the validation-nudge opt-out. |
| `supabase/analytics_council_funnel_v4.sql` (new) | Funnel with the new "saw prediction" stage, an echo check, and a nudge audit. |
| `tests/natural-intake-v4.test.ts` (new) | Chip mapping, saved-tap re-matching, chip-field preservation, priority/route parity, context-line parsing. |

## Decisions worth knowing about

- **Prediction after the quick check, not before.** Examiner answers feed bias
  and independence scoring; Quorum's hypothesis shouldn't be visible while
  they're being given. The lean itself is captured before Quorum says anything
  about the decision (it's tapped inside the chat).
- **The Council-readiness wall.** `lib/readiness.ts` blocks synthesis when a
  *critical* question (R2/R3) is unanswered. The reveal now checks for that: if
  one is open, the Convene button says "Answer one quick question first" and
  returns the person to the quick check, instead of letting them hit "Not ready
  to call" on the next page. R1/R7 redirects are left to the session page's
  existing override.
- **Convene waits (up to 15s) for a prediction still in flight**, so the reveal
  and the session page can't generate two different ones.
- **E0 in chat is less personal** than at the checkpoint (the checkpoint
  version uses the fear profile from the ontology, which doesn't exist yet
  mid-chat). The derive step is still the gate: it only treats E0/C0 as covered
  if the transcript genuinely covers them.
- **Not changed:** the session page's own steps for sessions 1–3 (Decision X-Ray,
  Quorum's Read, Opening Ceremony, tension pause). They come after the
  commitment to convene; they're the next trim target if the funnel still leaks
  after this ships.

## Not verified here

I had no network or `node_modules`, so I could not run `next build` or
`vitest`. What I did run: a TypeScript check across every changed file (only
errors left are from missing type packages in this sandbox, plus one in an
untouched component) and the pure chip / parsing logic directly. Run
`npm test` and a build before deploying, then walk the flow once with a real
decision: chat → taps → confirm → reveal → Convene → lock → Save to Record.
