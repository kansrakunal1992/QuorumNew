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

## Screen 2 — Chat turns
Generated per-turn (`generateFollowUpReply`), under 30 words, at most one
question, never re-asking something already known. Priority order when a
question is genuinely useful (never more than one per turn):
1. Name it gently if two decisions seem tangled together.
2. Invite real options if none are named yet — including waiting, doing
   nothing, or testing something small first.
3. Ask why a named stakeholder matters (expertise / challenge / approval /
   affected / trust) — only if it changes what happens next.
4. Ask what would actually change their mind, if that hasn't come up.
5. Otherwise, deepen whatever's most alive in what they just said.

Closing turn (last exchange before the reflection): no new question — a
short line signalling the handoff, e.g. *"Okay — I think I've got a clear
picture. Let me reflect it back to you."*

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
