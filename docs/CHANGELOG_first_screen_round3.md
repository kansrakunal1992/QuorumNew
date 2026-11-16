# First-screen conversion, round 3 (Nov 2026)

Unzip over the repo root AFTER rounds 1 and 2. 4 changed files, no new ones. No SQL, no new events.
Verified over round 2: `npm test` = 42 files, 751 tests pass.

Changed: components/ChatIntake.tsx, components/IntakeQuickStarts.tsx, lib/intake-examples.ts, tests/first-screen-conversion-2.test.ts

## What changed
- The six "kind of decision" pills now come first: right after the headline lines, before the box.
  Order on screen: headline, one-line orientation, "Start with a tap: what kind of decision is it?", pills, box, Help me decide,
  Or speak your decision, example sentences.
- Pills are a little larger (min height 40 px).
- starter_picked (placement='quick_start') now also carries position='above'|'below'.
- Switch back without code: set NEXT_PUBLIC_QUICK_START_POSITION=below and redeploy (build-time variable).
- Still hidden together with the box when the returning-visitor sign-in gate is showing. Never a sign-in element.

## Watch after deploy
- typed starts vs tapped starts: decision_started minus starter_picked(placement=quick_start)
- do typed starts fall? (the pills push the box down about 120 px on a phone)
- how far tapped chats get (intake_council_ready / confirm) compared with typed ones
