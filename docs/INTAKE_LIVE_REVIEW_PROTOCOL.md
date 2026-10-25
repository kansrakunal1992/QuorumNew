# Natural Intake v9 — live review protocol (what the scripted tests cannot tell you)

Run in **staging or a private browser profile**, on a **real phone (≈ 360 px) and a desktop**. A standalone script was deliberately not
written: the production planner runs through `lib/ai-client.ts` (tiered routing, provider chosen per role, `server-only`), so a script
calling a different model would give false comfort. Use the app itself. Tick each box; note the transcript for anything that fails.

Evidence labels: **code** = read in the repo · **scripted** = unit/persona tests with a fake planner · **live** = this protocol · **prod** = real traffic.

## A. Real-model card relevance and depth (11 openers)
For each: type the opener, answer by tapping the first plausible option(s), add free text once, and record (a) every card option shown,
(b) submissions to the summary screen, (c) anything irrelevant, duplicated, unsafe or already-answered.

| # | Opener | Expect |
|---|---|---|
| 1 | Should I quit and start something of my own? | high stakes; cards about why now / next step / runway or validation only when income at risk or building; ≤ 4 submissions |
| 2 | Should I change my job? | no "build my own" or validation cards unless the person says so |
| 3 | Should I accept this offer? | offer-specific cards (pay, culture, deadline); no career-exit cards |
| 4 | Should I buy a house or continue renting? | money/horizon/downside cards, ranges not amounts |
| 5 | Should I move abroad? | work plan, who moves, alternatives (trial / visit) |
| 6 | Should I go back to college? | outcome / cost / alternatives |
| 7 | Should I invest my savings or repay my home loan? | money cards, not purchase |
| 8 | Should I sell my business? | stage / capital / people |
| 9 | Should we have another child? | gentle, optional sensitive questions, "Prefer not to say" present; no career/money-template leakage |
| 10 | Should I buy a new phone? | **low stakes**: wraps in ≤ 2 submissions; no extra question; no runway/people |
| 11 | I don't know what to do. | generic cards only; free text always available; no category guess shown |
Pass: no irrelevant card, no category-template leakage, depth matches stakes, free text usable on every question, "None of these fit" works.

## B. Reflections (live)
Read every reflection in 5 transcripts. Pass if each: uses *their* words, is provisional, adds a distinction/tension/connection/"why next",
is not a question, gives no advice, doesn't name feelings they didn't state, and doesn't just repeat what they tapped.
Then check `intake_reflection_shown`: record shown vs rejected and the `reason` distribution after ≥ 50 chats. A rejected-heavy rate means
the planner prompt needs tuning (don't loosen the validator to hide it).

## C. Extra question and conditional fields (live)
* Quit/build: is runway asked **only** when leaving without a job lined up? Say "I already have a job lined up" → runway must not be asked.
* "Who depends on you?" appears only when income is at risk and you haven't mentioned family; mention a partner in free text → not asked.
* "Has anyone seen the idea?" appears only for a build-your-own path; say you've talked to customers → not asked.
* The extra question (if any) never repeats something you said or tapped and never appears on the phone decision.

## D. Corrections and edits (live)
1. Tap "Burnout", then at the summary choose "Not quite — let me fix it", rewrite the decision, confirm → the session's decision text is your rewrite, and the Council's context says it supersedes Quorum's framing.
2. After the chat wraps, "Let me add more first" → type a contradiction → confirm the Council context lists it under "corrected or clarified".
3. Known gap: the old tap still shows under "What you chose" (documented).

## E. Council launch (live / prod)
* Signed out and signed in; free and elite tier: confirm → reveal → Convene → advisors stream → synthesis starts on its own.
* Double-click "That's right" and Convene quickly, and open the summary in two tabs: exactly **one** session is created (apply `supabase/sprint_intake_v9_claim.sql` first).
* Block `/api/chat-intake/checkpoint` once (devtools offline) → a visible error → retry works and resumes the same session.
* Make `/api/examiner` fail (devtools block) → "couldn't save your answers" with retry and "Continue anyway".
* Check `events`: `council_launch_requested` followed by `council_execution_started` for the same `session_id`; any request without a start is a failed hand-off.
* Watch the `/api/session` 429 rate before/after this release (the shared-bucket fix).

## F. Mobile and accessibility (manual)
* 320 px and 360 px: no horizontal scroll anywhere in the chat, cards one column, ≥ 44 px targets, the first group collapses to one line when the second opens and "Change" reopens it with the entries intact; typed text survives the keyboard closing and a failed send.
* 200 % zoom: nothing clipped or overlapping; Continue reachable.
* Keyboard only: Tab through cards; arrow keys in a single-choice group **do not** submit; Space toggles checkboxes; focus lands on the second group when it opens.
* Screen reader (VoiceOver/TalkBack): group name + rule announced; "N selected" and "Next question: …" announced; errors announced; selection is visible without colour (✓ + heavier border).
* Summary screen: four labelled blocks read in order; lean/priority are buttons with `aria-pressed`.

## G. Failure fallbacks (live)
* Planner unavailable (kill the model key in staging): the chat still asks approved questions with cards, and reaches the summary and the Council.
* Unusable options from the model: approved options appear instead.
* No network mid-step: the card selections and typed text are still there after the retry.
