# Marketing site: structure and copy (v15)

**Status: not deployed.** The marketing site (quorumvault.org) is not in this repository, so nothing here ships with the app
release. This is the structure and copy to hand to whoever edits that site. The in-app first-visit screen already carries the
short version of this (see `components/ChatIntake.tsx` and `components/FrontDoorExplainer.tsx`); the marketing site is where the
longer story goes.

## Positioning

- **Category (internal, for investors and docs):** personal judgment intelligence.
- **What a visitor sees:** a council for hard decisions, with a memory. The promise is two beats: the decision in front of you
  gets examined properly, and Quorum remembers it, checks back and shows you how you actually decide, over time.
- **Why not lead with "intelligence":** it names a category, not a reason to start, and it is the language of every AI product.
  The Council is the first thing a person can feel. The memory is why they come back.
- **One line:** *The decision record that argues back, and learns how you decide.*

## Audience (initial)

Founders and independent operators who decide alone: hiring, pricing, pivots, partners, what to stop. They make frequent,
ambiguous, high-regret decisions without a board to challenge them, so they get the compounding benefit soonest. Narrow the
message and the channels, not the product: anyone who brings a decision gets the same experience.

## Page structure (top to bottom)

1. **Hero.** Headline, sub-line, one action (bring a decision, which opens the app with the box focused at `/q`).
2. **What happens when you bring a decision.** Examined, decided, remembered (three short steps).
3. **The Council.** The Examiner and six advisors, each with one line on why they exist. Show where they disagree.
4. **An example result.** One invented decision, labelled as invented: the Examiner's question, the advisors' split, the
   Council's read, what Quorum checks back on.
5. **How it builds.** First decision, second, third to fifth, with check-ins. Honest about early evidence.
6. **One person, four decisions.** A concrete journey (below). Invented and labelled.
7. **Privacy and your data.** What is stored, what is not, what you control.
8. **Pricing.** Short, after the value is clear.
9. **Final action.** Same action as the hero.

Visible immediately: 1, 2. Visible on scroll: 3 to 7. Secondary: 8 and detail pages. Do not show every feature; the Mirror's
depth, the decision graph, monthly reviews and personal-context import are introduced inside the product when they are useful.

## Copy

### 1. Hero

**Headline:** Bring a hard decision. Have it challenged, and remembered.

**Sub-line:** Six independent advisors and an Examiner pressure-test it. Quorum then checks back on what happened and, over time,
shows you the patterns in how you decide.

**Action:** Bring a decision

**Under the action:** Private. Nothing is shared without your permission.

### 2. What happens

- **Examined.** An Examiner finds what your decision is missing. Then six independent advisors, weighted by how relevant each is
  to your situation, argue it from different angles and show you where they genuinely disagree.
- **Decided.** You commit to what you will do and choose a date to check back. Quorum notes what it expected you to choose.
- **Remembered.** On that date Quorum asks how it turned out and keeps the answer with the decision. Over time that record is
  what lets it point to patterns in how you decide.

### 3. The Council

> Six perspectives, because one confident voice is how decisions go wrong.

One line per advisor (use the existing names and descriptions from the app, `lib/personas.ts`). Then:

> The Examiner goes first. It looks for what the decision depends on and what you have not said, and asks only what matters.
> The advisors are weighted by relevance to this decision, so the loudest voice is not always the same one.

### 4. Example result

Use the example in `components/FrontDoorExplainer.tsx` (hire a senior engineer now, or wait for the round) so the site and the
app tell the same story. Keep the label: *An invented example, to show the shape of a result. Not a real person's decision.*

### 5. How it builds

- **First decision.** A starting point. One decision cannot say how you decide, and Quorum does not pretend it can.
- **Second.** A first comparison: what the two decisions have in common.
- **Third to fifth.** Early signals. Recurring priorities and blind spots begin to show, marked as early.
- **With check-ins.** Once you have recorded how decisions turned out, Quorum can show where your confidence ran ahead of what
  happened, or behind it.

> Quorum calls an observation early when the evidence is thin, and does not claim to know you from one or two decisions.

### 6. One person, four decisions (invented, labelled)

Write this as a short dated sequence, not a testimonial:

1. *Week 1.* Decides on a contractor trial instead of a full-time hire. Quorum records the choice and a check-in date.
2. *Week 9.* The check-in: the trial confirmed demand. Records the outcome. Quorum notes it had expected a different choice.
3. *Week 12.* A pricing decision. The Council points to the earlier decision as the closest comparison and why.
4. *Week 20.* A fourth decision. Quorum can now say, with the decisions it rests on, that two of the four were driven by the same
   concern, and marks it early because it is four.

Keep every claim in this sequence something the product actually does today. Do not add personality or prediction claims.

### 7. Privacy

Say plainly: decisions are private; nothing is shared without permission; what is stored and for how long; how to delete a
decision or an account; that personal-context import is optional and under the person's control. Link to the privacy page.
Do not add claims the privacy page does not support.

### 8. Pricing

Keep to what the app already shows (Founding Mirror, Elite, and the single-session option). Lead with what is free to try only
if that is true at the time of publishing; the in-app copy deliberately makes no "free" claims.

### 9. Final action

**Headline:** Bring the decision you keep circling.
**Action:** Bring a decision

## Measurement for the site

- Landing visit to first decision started, by channel (UTM already captured at signup and first touch).
- Which panel was opened before starting: example result, how it builds (`front_door_section_opened` in the app; replicate on
  the site).
- Do not infer "understood the proposition" from clicks alone. If the site can host a one-question poll ("In one sentence, what
  does Quorum do?"), use it, and read the answers rather than counting them.
