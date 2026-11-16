# First-screen conversion (Nov 2026)

Unzip over the repo root. 3 changed files, 3 new files. No env var, no SQL, no new event names.

Changed:  components/ChatIntake.tsx, components/CookieConsent.tsx
New:      components/IntakeExamples.tsx, lib/intake-examples.ts, tests/first-screen-conversion.test.ts

## What changed
1. Four tappable example openers sit under "Help me decide" (a tap fills the box, never sends).
   Event: `starter_picked` with props `placement: 'inline'`, `example: <id>`. The old category chips are now "More examples";
   `starter_opened` / legacy `starter_picked` are unchanged.
2. Sub-headline replaced by: "Type it below. Quorum asks the questions that move it forward, then weighs your options." H1 unchanged.
3. Phones (<=480px): tighter hero spacing; the fourth example hides on screens shorter than 700px.
4. Cookie banner: phones start with a one-line bar (Cookies / Manage / Reject / Accept all). "Cookies" opens the full banner.
   Global, all pages. Confirm against your consent obligations, or revert CookieConsent.tsx alone.
5. Landing textarea grows with its text (max 168px).
6. A ?decision= prefill shows "This is a starting point from the link. Change it to fit your situation." until edited.
7. Sign-in: no change needed. The card is below the input, for devices with decisions only. A test locks it.

## Measure
- starter_picked where props.placement = 'inline'  (which example, how often)
- decision_started where props.prefilled = true    (do link visitors send?)
- consent_shown / consent_accepted / consent_rejected  (slim bar vs full banner)
- Compare decision_started / landing_view before vs after, excluding bots (see reply notes).

## Verify before deploy
npm test          (41 files, 732 tests at packaging time)
Revert: git checkout -- components/ChatIntake.tsx components/CookieConsent.tsx and delete the three new files.
