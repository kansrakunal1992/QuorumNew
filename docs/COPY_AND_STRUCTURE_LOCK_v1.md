# Natural Intake v1 — Copy & Structure Lock

This is the copy actually shipped in v1's code (`components/ChatIntake.tsx`,
`components/DecisionCheckpoint.tsx`, `lib/chat-intake-reply.ts`). Change
copy here first, then in code — same convention as every other locked-copy
pass on this product.

## Voice rules (apply everywhere in this surface)
- Plain, direct, human — a trusted colleague, not an interviewer, consultant, or form.
- Never say: Examiner, Council, Structural Read, ontology, rule engine, readiness gate, or any other internal/engineering term.
- One idea per screen. One question per turn. Every question earns its place.
- No numeric progress ("3 of 6") — a quiet dot trail instead.

## Screen 1 — Opening
> **What's going on? Don't worry about structuring it — just tell me.**

Fixed string, no AI call (`OPENING_LINE` in `lib/chat-intake-reply.ts`).

## Screen 2 — Chat turns (updated for v7 — adaptive decision brief)
Generated per-turn by the planner (`lib/chat-intake-planner.ts`), one question
at most, plain words, under 35 words, using the person's own specifics ("Delhi",
not "your city"). Questions come from the **decision brief** for the kind of
decision (`lib/chat-intake-brief.ts`), not a generic checklist:
- Job exit: the role, what comes next, money runway, what set it off, other routes.
- Move: which city from and to, work there, who it affects, what set it off, other routes.
- (Job offer, money, business, relationship, study, purchase, other each have their own.)

Rules:
1. Ask the one open fact whose answer would most change the advice. Skip any that couldn't.
2. A vague opener gets "What happened recently that made this come up?" unless a
   higher-value concrete specific (e.g. which city) is open.
3. For "other routes", name one or two the person hasn't mentioned, as tap-answers.
4. Never ask how they feel or what success looks like (the sharpening step asks those).
5. A detailed first message is not interrogated: fill what it answers, ask only what's open.
6. Every question with a choice-shaped answer offers 2–4 tap-answers; typing always works.
   "Not sure" is always available and is remembered (never re-asked; becomes a to-do).
7. A slot is asked at most twice.

Before wrapping: one "what would a sharp friend still ask?" question (if any), then
a one-line playback — **"Here's what I've got: … Did I get that right?"** with
**Yes, that's right / Not quite**. A typed correction is accepted too.

Always available: **"That's enough — show me"** (wraps now; open items flagged as
"not sure yet"). At the start, optional: **"Not sure what to say? Walk me through it"**
(one easy step at a time, tap-answers throughout).

Live panel (collapsed by default): **"What I've got so far"** — a dot meter and a
plain sentence ("Getting the picture" / "Filling in the picture" / "I've got the
picture"), never a number. Tapping a row starts "About …:" in the input to correct it.

Closing turn (after the confirming tap): no new question — a short hand-off line,
e.g. *"Okay — I think I've got a clear picture. Two quick taps below, then I'll show
you what I think you'll choose."*

## Screen 3 — Reflection
> **Here's the decision I think you're actually making**

Shows: decision statement, options (if any), the single biggest open
question, who's involved (if named). Three actions:
- **That's right** → creates the session, moves to Screen 4.
- **Not quite — let me fix it** → inline edit of the decision statement; the user's correction always wins.
- **Let me add more first** → back to the chat, a few more exchanges.

*Deferred to v1.1:* explicit "I think there may be two decisions here —
treat them separately or together?" splitting UI. v1 only names the
possibility inside the ordinary chat flow (priority 1 above); it doesn't yet
offer a structured split action.

## Screen 4 — Sharpening + exit
> **A couple of things to make this sharper**

Per question: if already covered in the chat, show *"You mentioned: '…' —
is that right?"* with **That's right** / **Let me add to it**. Otherwise a
plain optional text box.

Then:
> **You don't need the full Council for every decision.**

Two buttons: **Convene the Council** / **I'm done**. Choosing "I'm done"
reveals one optional line: *"Anything you're actually going to do next?"*
before a final **Done**.

## Screen 5 — Done (light path)
> **Got it — saved.**
> This is part of your Quorum history now, whether or not you dig deeper.

*Deferred to v1.1:* a third **Keep thinking** option at this screen (after a
session already exists) — see `docs/CHANGELOG_v1.md` for why it's scoped
out of v1.

## Style tokens used (matching the existing app, no new ones introduced)
`--bg-void`, `--bg-card`, `--bg-inset`, `--border-dim`, `--border-mid`,
`--text-1` through `--text-4`, `--gold`, `--gold-bright`, `--gold-dim`,
`--font-body`, `--font-display`.

## Phase 1 additions (retention work) -- copy and structure

Same convention: this section is the source of truth; code follows it.
None of these lines use internal terms (Council, Examiner, Mirror-as-feature
names) except where the existing screen already did.

### Front door positioning (replaces "high-stakes" on free surfaces)
- Hero sub-line (`ChatIntake`): **"For the big calls, and the smaller ones you keep circling. Full Council comes in once we know the decision."**
- Meta / OG / JSON-LD descriptions (`app/layout.tsx`, `app/page.tsx`): "...for the big calls, and the smaller ones you keep circling."
- Classic nav tagline (`HomeClient`): **"Decision Intelligence for the calls that matter"**
- Do NOT promise speed or a lighter path -- the full flow is unchanged.
- Paid / Mirror / methodology / terms copy keeps its high-stakes framing on purpose.

### Starters (compact chat hero only)
Chips: Career, Business, Money, Personal, Relationships, **Small calls**.
Small calls items: "Should I reply to this today?" / "Which of these two should I do first?" / "Should I keep this or return it?" / "Should I say yes to this invite?" / "Should I raise this with them or let it go?"

### Top-bar label (`ChatIntake`)
Anonymous visitor with decisions on the device: **"Keep my record"** (was "Sign in").

### Post-decision continuity block (`NextDecisionPrompt`)
Shown on the "I'm done" ending, the Council page (once the decision is locked), and the record page.
- Tally (only once a prediction outcome exists): "Quorum has guessed right 1 of 2 so far." / "You've surprised Quorum on your first one."
- Why another decision helps (by count): 1 -> "Quorum learns how you decide by comparing decisions. Two are enough for a first comparison." / 2 -> "A third decision gives Quorum its first real look at how you decide." / 3+ -> "Each new decision sharpens what Quorum can see in how you decide."
- Field label: **"Anything else you're going back and forth on?"**
- Buttons: **"Bring me another decision ->"** (becomes **"Bring this one now ->"** once text is typed); **"Park it for later"** (only with text, only when the Watchlist flag is on).
- Parked confirmation: "Parked on your Watchlist." (signed in) / "Parked." (anonymous, then the connect card opens).
- The "I'm done" ending keeps "Actually, convene the Council" as the primary action; the button above is the outline/secondary style there.

### Soft connect card (`ConnectCard`, mode `d1_soft`)
- Collapsed line, by context:
  - parked item: "Parked. Quorum will hold "..." and bring it back to you. Where should it reach you?"
  - review date known: "Quorum will bring this decision back to you on {date}. Where should it reach you?"
  - otherwise: "Quorum can remember your decisions and tell you when it finds something. Where should it reach you?"
- Buttons: **"Keep my record"** (expands), **"Not now"** (hides for 72 hours).
- Expanded: Continue with Google, then "or", then email field + **"Email me a link"**. Footnote: "No password. Just a link, or Google."
- After sending: "Check your inbox." / "The link brings you back here with your decisions connected."

### Review date (`PredictionReveal`)
Quick-pick chips: **In 3 days / In 1 week / In 1 month** plus the existing date picker. The date stays required.

## Phase 2 + 3 additions (retention work) -- copy and structure

### Cross-decision observation (`NextDecisionPrompt`, from the second decision on)
Deterministic, counts-only lines (`lib/cross-decision-observations.ts`). Second decision shows it in a small card headed **"Across your two decisions"**; later decisions show it as the one-liner that replaces the explainer.
- "Both times, you put {priority} first." / "You put {priority} first in {k} of your last {n} decisions."
- "You went with your first instinct both times." / "...in {k} of {n} decisions." / "You overrode your first instinct in all {n} decisions."
- Nothing overlaps: **"No overlap yet. Each new decision gives Quorum more to compare."** Never invent a pattern.

### Habit card (`HabitSetupCard`, once, under the second decision)
- "Next time you catch yourself going back and forth, where will you bring it?" -> Before I buy something / When I'm stalling on a message / Sunday planning / When I notice I'm stuck
- "How should Quorum bring decisions back to you?" -> Weekly / Only when I'm stuck / Only for big decisions
- Buttons: **Save**, **Not now**. Weekly is the only choice that triggers email.

### Connect card modes (`ConnectCard`)
- `d2_earned` (under the second decision's observation): "Keep your record connected and Quorum can tell you when it finds something. Where should it reach you?" -- or, when they chose Weekly while anonymous: "Weekly needs somewhere to send it. Where should Quorum reach you?"
- `d3_gate` (Phase 3, only when `NEXT_PUBLIC_AUTH_GATE_MODE` is on): "Your record has {n} decisions. Connect to keep going. Quorum will hold your record, remind you on your review dates, and tell you when it finds something." Footnote: "No password. Your existing records stay open." No "Not now".

### Progress pips (`EarlyEchoCard`, decisions 2-4)
- 2: "Second decision recorded." / "One more gives Quorum its first look at how you decide. Five lets the Council start connecting them." (pips to 3)
- 3: "Three decisions in." / "Quorum's first look is ready in your Mirror. Two more activate pattern memory." (pips to 5)
- 4: unchanged copy, pips to 5.

### Emails
- Weekly brief -- subject/lead **"Anything you're weighing this week?"**; optional line "You said you'd bring one here {when}. This is that moment, if it has come up."; list label "On your list"; CTA **"Bring me one"** -> `/q`; footer "Stop the weekly brief".
- Pattern notice -- subject **"Quorum noticed something across your decisions"**; lead "Quorum noticed something across your decisions."; detail = the observation line; CTA **"See what Quorum noticed"** -> `/mirror`; footer "Stop these emails".
- Review-date emails: one quiet line under the button, "Got another one on your mind? Bring it to Quorum." (link, not a second button).

### Home-screen prompt (`AddToHomeScreenPrompt`, from the second decision)
- Android/desktop: "Keep Quorum one tap away for the next time you catch yourself going back and forth." [Add to home screen] [Not now]
- iOS (people PushEnablePrompt does not already cover): "Keep Quorum one tap away: in Safari, tap Share, then Add to Home Screen." [Got it]

### `/q`
Short door that opens the app with the chat input focused (`/?q=1`).

## Phase 4 additions (retention work) -- copy and structure

### Settings -> Notifications (`/settings/notifications`, 4th settings tab)
- Title: **Notifications**.
- Card **"How should Quorum bring decisions back to you?"** (same three choices as the second-decision card):
  - **Weekly** -- "A short note on Sundays: anything you're weighing, plus what you've parked."
  - **Only when I'm stuck** -- "No weekly note. Quorum still checks in if a decision stalls or you've been away for a while."
  - **Only for big decisions** -- "No weekly note and no "you've been away" nudges. Reminders for review dates you set still arrive."
- Card **"Other emails"** (switch on = you receive them): **When Quorum notices something** / **Check-ins on past decisions** / **Nudges when you've been away**.
- After a one-click unsubscribe from the weekly note: "You unsubscribed from the weekly note. Choosing Weekly turns it back on."
- Signed out: card "Sign in to manage notifications" -> "Connect your email".
- Review-date reminders are deliberately not listed (each is tied to a date chosen for a specific decision).
