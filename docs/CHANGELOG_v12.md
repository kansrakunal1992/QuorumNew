# v12 — the decision box after the Council: tappable options, exact comparison, honest first-decision wording

Builds on v10 + v11. No database change, no new route, no new environment variable.

## What changed

**1. The "Make your decision" box now offers taps.** It shows the SAME options the person saw on the confirm screen (same
labels, same order, same four-option cap, same clipping — built by the same function from the session's saved options),
plus **Something else**, which opens the text box exactly as before. Tapping an option → Review → Confirm & lock (the
existing one-shot review step is unchanged). The option they tapped as their first lean is marked "Your first lean", so
the two can be compared at a glance. The generic "Not sure yet" chip is not offered here (a recorded decision is a
decision; "Something else" covers "still undecided"). Sessions with fewer than two named options (older / classic
sessions) keep the plain text box. The decision text saved is the option's full text.

**2. "Did Quorum guess it?" is now exact when an option was tapped.** Quorum's prediction is already instructed to name
one of the listed options, so a tapped option is compared with it directly (`lib/final-choice.ts`). Before, it was a
keyword overlap on whatever was typed: typing "I'll accept the offer" could count as a miss against a guess of "Take the
better job", and sharing a word like "offer" could count as a hit against the wrong option. The server only trusts the
tapped label if it really is one of that session's options; anything it can't tie to the options (typed text, a guess
that names no option) keeps the old keyword comparison, so nothing gets worse. The new request field is optional
(`chosenOptionLabel`).

**3. "You started out …" now names what they actually tapped.** It used to say "leaning yes / leaning no / genuinely
unsure" from the three-value instinct. Only act / don't-act options map to yes / no, so someone who tapped "Negotiate
terms of the offer" was told they "started out genuinely unsure". It now reads, for example, *You started out leaning
toward "Negotiate terms of the offer"*. It falls back to the old wording when no label is known.

**4. First-decision wording.** For a person's first three decisions Quorum's guess was made from how people generally
decide, not from their history (the prediction engine needs three finished decisions to personalise), so:
* the reveal says *"Quorum's first guess matched"* / *"Quorum guessed differently"*, *"From what you'd told it, Quorum
  guessed …"*, and *"It doesn't know you yet — each decision is how it starts to learn the way you decide"*, instead of
  "Quorum predicted you" / "You surprised Quorum" / "whether Quorum understands you";
* the running tally no longer says *"You've surprised Quorum on your first one"* — it says *"Quorum guessed differently
  on your first one — it's still learning how you decide"*;
* returning people (4th decision on) keep the original wording.

**5. Two safety fixes found while testing.** (a) If Quorum's guess never arrived, the reveal used to say *Quorum guessed
"null"*; it now says "Decision locked" and nothing about a guess. (b) If saving the decision failed, the box went back to
the start with **no message** (the error was only drawn on the review step); it now shows the error.

## Files

Changed: app/api/session/[id]/decide/route.ts, components/{PredictionReveal, SessionView, PredictionTally}.tsx.
New: lib/final-choice.ts, tests/journey-v12.test.ts, this file.

## Verified

* `vitest`: 515 passing (503 after v11 + 12 new). `tsc`: no new errors. `next build`: compiles, lints, type-checks.
* Browser-style harness (jsdom, not shipped): 35 scenarios passing, 9 of them for this box — options + "Your first lean"
  shown with no text box; tap → review → confirm sends `{finalDecision, chosenOptionLabel}` and reveals; a different option
  reads as "guessed differently"; Something else saves typed text and claims no option; Edit keeps the selection;
  no options → original text box; returning-person wording unchanged; missing guess → "Decision locked"; failed save → message.

## Not verified / worth a look

* The decide route's use of the new field is covered by unit tests of `matchPrediction` and source guards, not by a live
  database call.
* Whether people want a "Not decided yet" option in this box. It was left out on purpose; easy to add as one more chip.
* The older keyword comparison still decides typed ("Something else") answers; it is the weaker path.
