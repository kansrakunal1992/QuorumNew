# First-screen conversion, round 4 (Nov 2026)

Unzip over the repo root AFTER rounds 1 to 3. 8 changed files, 3 new. No SQL, no new env var needed.
One new event: `intro_video_opened`.

Changed: components/ChatIntake.tsx, components/IntakeQuickStarts.tsx (comment only), lib/intake-examples.ts,
         lib/track.ts, app/api/events/route.ts, docs/COPY_AND_STRUCTURE_LOCK_v1.md,
         tests/first-screen-conversion.test.ts, tests/first-screen-conversion-2.test.ts
New:     components/IntakeVideoLink.tsx, tests/first-screen-conversion-3.test.ts, docs/CHANGELOG_first_screen_round4.md

## What changed
1. Fewer choices on the landing screen. Removed: the four example sentences ("Two job offers...", "Pay off a loan early...")
   with their caption, and the "Not sure what to say? Walk me through it" link (the pills start the same guided mode).
2. The six pills are unchanged but now sit under the button (and the voice row), so the box is the first thing on the screen.
   Default flipped in lib/intake-examples.ts. NEXT_PUBLIC_QUICK_START_POSITION=above puts them back in front of the box.
3. Kept as they were: the text box and "Help me decide", the voice row, "More examples" (with its panel and events),
   the privacy line, the "N people already here" pill (not part of this code).
4. New: a one-line "Watch the intro" link in the same row as "More examples", opening the intro video in a modal.
   Order of the last row: [Watch the intro] . [More examples]. See "Video" below.

Screen order now: headline, subline, box, Help me decide, voice row, "Start with a tap" + six pills,
[Watch the intro . More examples], privacy line, 1,599 pill.

## Before you deploy
- Railway: if NEXT_PUBLIC_QUICK_START_POSITION is already set, it overrides the new default. Remove it, or set it to `below`.
  (It is a build-time variable: redeploy after changing it.)
- Video: copy the website's intro video to  public/videos/quorum-intro.mp4  in the app repo. It is the same file the website
  serves at https://quorumvault.org/videos/quorum-intro.mp4. Until the file is there the link does not show at all
  (the component checks with a HEAD request), so it is safe to deploy the code first.
- Optional cleanup, not needed for the build: components/IntakeExamples.tsx is no longer rendered anywhere. Delete it together
  with INTAKE_EXAMPLES_SHORT_SCREEN_COUNT in lib/intake-examples.ts. Do NOT delete INTAKE_EXAMPLES itself: lib/post-scenarios.ts
  builds the ?scenario= campaign links (job_offers, leave_job, hard_conversation, loan_or_invest) from it.

## Video
- Served from this app (/videos/quorum-intro.mp4), so the content-security policy is unchanged (media-src 'self').
- Nothing downloads or plays until the link is tapped. Esc, the Close button or a tap outside closes it and stops it.
- Hidden for a device with 3 or more decisions (INTRO_VIDEO_HIDE_AT_DECISIONS in components/IntakeVideoLink.tsx).
- No captions track is attached. If you have a .vtt for the intro, add a <track> line in IntakeVideoLink.tsx.
- Event: intro_video_opened { placement: 'landing' }. The usage dashboard is a separate Railway project: add the event name
  there if it keeps a list of known events.

## Watch after deploy
- decision_started / landing_view before vs after (exclude bots, as before).
- starter_picked with position='below' (pill taps) vs typed starts (decision_started minus pill taps).
- starter_opened (More examples) rate. If it is very low, the link can go next round.
- intro_video_opened, then decision_started among the people who opened it vs those who did not.
- starter_picked with placement='inline' stops firing (the sentences are gone). That is expected, not a tracking bug.

## Check by eye before announcing (I could not render the page)
- Phone widths 375x667 and 390x844: box, button and pills visible without scrolling; no odd gap above or below the pills
  (the spacing was tuned for the old stack and uses small negative margins).
- Light and dark theme: the link row text is the same quiet grey as before.
- Tap "Watch the intro": plays with sound, Close and Esc work, the cookie banner does not sit on top of it.

## Roll back
git checkout -- <the changed files> and delete the three new ones. Or, for the pills only, set
NEXT_PUBLIC_QUICK_START_POSITION=above and redeploy.
