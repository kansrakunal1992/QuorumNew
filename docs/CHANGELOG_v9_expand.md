# Quorum — Natural Intake v9: expandable answers and lean choices

Deploy on top of the summary-fix zip. No migration, env vars, dependencies or new events.

## What changed (summary screen)
* **Clipped answers expand in place.** "What you told me" still shows the stored answer clipped as before (160 characters, ending in "…"). When that answer was clipped and the person's own message is still in the chat, a **Show full answer / Show less** control appears and shows their full wording. Nothing is invented: the full text is taken from their own messages (latest matching message wins, so a correction outranks earlier wording), up to 700 characters. If it can't be matched with confidence there is no control — never a guess.
* **Lean choices expand in place.** A clipped choice ("Negotiate role clarity or protections with current…") now has a small **+ / −** control (screen-reader name "Show full wording" / "Show shorter wording") and shows its full wording automatically once chosen. Short choices look and behave exactly as before.
* Default clipping is unchanged (current behaviour), as you said either was fine.

## Notes
* The full text for an answer is read from the transcript the summary screen already loads; no new request, no new stored field, nothing extra sent to analytics.
* For a combined two-question step the person's message contains both answers on separate lines, so an expanded answer may show the companion answer after it (still their own words).
* Only answers that were clipped by the app are expandable. Short model-written facts and the tapped "What you chose" labels are not clipped, so they show no control.

## Files
New: `components/ExpandableText.tsx`, `tests/intake-expand.test.ts`, `docs/CHANGELOG_v9_expand.md`.
Changed: `lib/chat-intake-depth.ts` (`fullAnswerFor`), `components/DecisionCheckpoint.tsx`.

## Verified
`tsc` clean on changed files (apart from my stand-in React types); 265 scripted intake tests pass (11 new). Not run in a browser: the expand controls' layout on a 320 px screen and their screen-reader announcements are **not** verified — add them to the manual checks in `docs/INTAKE_LIVE_REVIEW_PROTOCOL.md` §F.
