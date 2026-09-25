# Mirror "status = completed" Touchpoints — Full Audit, v1 Status

Nine real places in the codebase filtered sessions on `status = 'completed'`
(a tenth and eleventh grep hit — `app/api/admin/case-studies/route.ts` and
`app/api/watchlist/route.ts` — turned out to be unrelated tables using the
same word for a different status field; not touched, not relevant).

## Fixed in this v1 drop (6) — outcome/calibration tracking
These all answer one question: "did this person actually commit to a
decision, and can we check back on it later?" That's a `commitment_captured_at`
question, not a `status` question — a light-path "I'm done" with a real next
action should qualify; a light-path "I'm done" with no commitment at all
correctly should not, even though its `status` also becomes `'completed'`
(see `app/api/chat-intake/done/route.ts`).

Fix applied to all six, identically:
`.eq('status', 'completed')` → `.or('status.eq.completed,commitment_captured_at.not.is.null')`

This is additive-only: every session that already matched `status = 'completed'`
still matches. Nothing that worked today stops working.

1. `app/api/mirror/pending-outcomes/route.ts`
2. `app/api/mirror/calibration/route.ts`
3. `app/api/mirror/outcomes/route.ts`
4. `lib/calibration-engine.ts` (dimensional calibration zones)
5. `lib/bias-scorer.ts` (`fetchCalibrationContext` — the narrative-blurb helper only; the separate C0 rule_id pull elsewhere in this file is untouched and already correct as-is)
6. `lib/cohort-insights.ts` (`averageCalibrationDelta`)

## Deferred — fast-follow, NOT changed in this drop (2)
Both are about a different question — "did the structural read run at all,"
not "was a decision committed to" — which is what `sessions.session_depth`
(added in this migration, currently unset by any deferred code) is *for*.
Deferring rather than patching blind: both files carry denser logic
(stalled-session detection; per-decision-context bucketing) that deserves a
dedicated read-through rather than a mechanical find-and-replace risking a
subtle regression in bias/avoidance signal you already rely on.

7. `lib/avoidance-detector.ts` (two call sites) — detects a user avoiding a
   decision that's sitting unresolved. Needs its own look at whether
   "unresolved" should include a checkpoint-depth chat session that never
   reached a exit choice at all, which is a genuinely different shape of
   "stalled" than today's Council-flow model assumes.
8. `lib/bias-trigger-engine.ts` — buckets bias detections against decision
   context (type, dominant emotion) for the personalized bias-trigger
   narrative. Should include light/checkpoint-depth sessions once
   `session_depth` is being set reliably at both write points (only the
   checkpoint path sets it in this drop — a "Convene the Council" path
   setting it to `'council'` is also still open, see `docs/CHANGELOG_v1.md`).

**Recommendation:** take both as the very next small PR once this drop is
reviewed, rather than folding them in now.
