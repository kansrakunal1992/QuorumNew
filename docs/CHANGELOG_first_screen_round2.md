# First-screen conversion, round 2 (Nov 2026)

Unzip over the repo root AFTER `quorum-first-screen-deploy.zip` (round 1). 6 changed files, 5 new. No env var, no SQL,
no new event names. Verified: unzipped over round 1, `npm test` = 42 files, 749 tests pass.

Changed: app/api/chat-intake/route.ts, components/ChatIntake.tsx, components/VoiceInput.tsx,
         lib/chat-intake-planner.ts, lib/intake-examples.ts, lib/url-prefill.ts
New:     components/IntakeQuickStarts.tsx, lib/post-scenarios.ts, scripts/build-post-links.mjs,
         scripts/post-calendar.sample.csv, tests/first-screen-conversion-2.test.ts

## 1. Post-to-page match: ?scenario=<slug>
Short campaign links that open the box with the scenario from the post. Wording lives in lib/post-scenarios.ts, so it can be
fixed after a post is published. Behaves exactly like ?decision= (never sent for the visitor; ?decision= wins if both are present;
unknown slug = blank box; tidied out of the address bar; utm_* kept).
    node scripts/build-post-links.mjs scripts/post-calendar.sample.csv > links.csv
Copy the sample CSV, one row per post (source,medium,campaign,content,scenario). A typo in a slug stops the script.
Example: https://app.quorumvault.org/?scenario=job_offers&utm_source=linkedin&utm_medium=post&utm_campaign=nov_gtm&utm_content=li_post_12

## 2. One-tap start
Six pills under "Help me decide": Career, Money, Business, Relationships, Personal, Smaller calls. A tap SENDS "It's about my career."
as the first message in guided mode (the mode "Walk me through it" already uses: one small question at a time, tap-answers).
Event: starter_picked with props placement='quick_start', example='qs_career' ...  decision_started fires as usual.
These are lower-intent starts than typed ones. Compare them: decision_started minus starter_picked(placement=quick_start) = typed.

## 3. Voice
Landing: a labelled row "Or speak your decision" under the button (was an unlabelled icon in the box corner).
Fix: the transcript is cumulative; the chat appended it, which repeated words. It now replaces the dictated part (VoiceInput got an
optional onStart prop; HomeClient is unaffected). Please test dictation on a real phone.

## 5. The wait for the first reply
- Planner returns only what is new or changed (lib/chat-intake-planner.ts). mergeNotes already merges, so nothing is lost
  (tested). Fewer output tokens = faster reply. Expect the biggest gain from turn 2 onward.
- Route: skips the transcript query for a new chat; fetches row + transcript together for a resumed one; saves the user message
  while the planner runs; saves Quorum's reply and the chat state together. Order of rows is unchanged.
- Chat: after 4 s "Reading what you wrote...", after 10 s "Still thinking ...".
Measure: intake_step_shown.api_ms and the admin "typical wait for a chat reply" (was 12 s over 7 replies).

## Roll back
git checkout -- <the 6 changed files> and delete the 5 new ones. Round 1 keeps working on its own.
