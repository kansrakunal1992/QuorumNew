# v17 (24 Nov 2026), Phase 6: something we didn't ask, calibration and contradictions, anonymous continuity, the Mirror before sign-in

Applies on top of v16 (`docs/CHANGELOG_v16.md`).

Verified: 880 tests pass (848 before, 32 added), typecheck introduces no new errors (the 35 existing `TS2802` target errors are
unchanged), and `next build` compiles both new routes. Not verified: anything against live Supabase, Anthropic, Razorpay or
Railway, nothing clicked through in a browser. The website edits were checked for well-formed JSON-LD only; the site was not run.

## Deploy

### 1. SQL

**None.**

### 2. Railway variables

**Nothing is required.** Everything here is on by default. Three optional off switches:

| Variable | Kind | Value | Effect |
|---|---|---|---|
| `LEFT_OUT_CARD` | server, runtime | `off` | The "Something we didn't ask" card never appears. |
| `MIRROR_OVERVIEW_CONTRADICTIONS` | server, runtime | `off` | Hides the one stored contradiction reading from the Mirror overview. |
| `NEXT_PUBLIC_MIRROR_PREVIEW` | **build time** | `off` | `/mirror` shows the email box alone to signed-out visitors, as before. Needs a fresh build. |

Still outstanding from v15: remove `NEXT_PUBLIC_AUTH_GATE_MODE` (currently `d3`). Several things below assume people can reach a
third decision without being forced to sign in first.

## What changed

### 1. "Something we didn't ask" (after the Council)

The fast path leaves lower-weight required questions to the Council ("not asked"), and any chat that reaches its ceiling stops with
gaps. The Council knew; the person did not and could not go back. A card now appears under the Council's read listing exactly
those questions, in Quorum's own wording, heaviest first (at most four). Answers go through the **existing in-session
"new information" pipeline** (`handleShareContext`, the same one the Challenge box uses): all six advisors re-read, a new
synthesis version is produced, in the same session.

- **No second decision is created.** I first looked at the existing Reanalyze flow and rejected it for this: it starts a new
  session, which would have shown the decision twice on the Desk and counted it as "never committed to" in the Mirror.
- Never re-asks what the person answered, did not know, said did not apply, or skipped. Optional ("Not now"); renders nothing
  when there is nothing to ask or the request fails; disabled while an earlier update is still running.
- `lib/left-out.ts` (pure, tested), `app/api/session/[id]/left-out/route.ts` (questions only: no decision text, no answers),
  `components/LeftOutCard.tsx`, `components/SessionView.tsx`.

### 2. Calibration and contradictions in the Mirror overview

Each has its own evidence rule, because showing them without one would break the no-manufactured-insight rule.

- **"Sure and wrong"** (watch): needs three decisions you felt very sure about (8 or more out of 10) with a recorded outcome, at
  least two worse than expected, and at least half. "Too early" outcomes never count.
- **Confidence gap** (learned): reuses the Mirror calibration section's own thresholds: three decisions with confidence going in and
  looking back, and an average gap of at least 1.5 points out of 10. Stated as an average, not a verdict. "Established" still
  needs five or more decisions.
- **Contradictions** are a model's reading (`lib/contradiction-detector.ts`), not a count, so this adds **no detection**. It only
  surfaces what the existing pipeline already stored and the person has not dismissed, and only: to the signed-in owner (never the
  anonymous form, because it quotes their own words), one at a time (sharpest, then newest), sharp or notable only, and only when
  both decisions still exist and differ. It is labelled "Quorum's reading", linked to both decisions ("where you said it" and
  "where it seems to differ"), and has a **"That's not right"** control that uses the existing dismiss endpoint, which needs only
  the signed-in owner, so people who have not paid can use it.
- If the outcome lookup fails, calibration insights are not made at all, and check-in and uncommitted insights are hidden.
- `lib/mirror-insights.ts`, `lib/decision-history.ts`, `app/api/mirror/overview/route.ts`, `components/MirrorOverview.tsx`.

### 3. Where should Quorum reach you? (people who stay anonymous)

I did **not** add an endpoint that accepts a bare email. An unverified address would let anyone trigger emails to a third party, and
nothing could prove consent. The existing card (`ConnectCard`) already does verified linking (a magic link or Google), has a 72-hour
"Not now", and hides itself for signed-in people. What was missing was the reason and the moments:

- **A plain reason on each ask** (`reason` prop): *compare* (Quorum can only compare decisions it can tell are yours), *open
  decision*, *check-in due*. No "unlock", no urgency.
- **Three new moments:** after "Not ready to decide"; on the Desk when a check-in is due and Quorum has no way to reach the person;
  and after a second or later decision, where the default sentence now says what the email is for (comparison and check-ins).
- Why this closes the gap: the early comparison and reminders depend on Quorum recognising the person by account or email. The
  email is how that happens, and the asks now say so.

### 5. The Mirror before sign-in (your question)

**Yes, change it, and it is changed.** `/mirror` showed a signed-out visitor one thing: an email box, with nothing about what the
Mirror is and nothing from decisions already saved on their own browser. That contradicted the principle that the first
evidence-backed look is not hidden behind sign-up.

The line I drew, so the exchange is honest:

| Free, no account | Needs a linked email |
|---|---|
| The same overview the signed-in Mirror opens with, built from decisions saved on this browser: claims, how much each rests on, counts | Which decisions each point rests on (and links to them) |
| If nothing is saved here: an explanation of the three questions and what it needs (it says nothing from one decision), with a link to bring a decision | The contradiction reading, because it quotes your own words |
| | The deeper paid sections, and keeping your record across devices |

The email box follows underneath, framed as "Keep this, and see what it rests on" rather than a toll. This answers your either/or:
the preview needs no email, and an email is asked for only to link and keep. `components/AnonymousMirrorPreview.tsx`,
`app/mirror/page.tsx`. It reads this browser's stored session ids (always permitted) and writes nothing. Someone who has not
accepted functional cookies has no stored ids, so they get the explanation, not a preview; that is the consent boundary, not a bug.

### 4. The website

You attached the site files; I edited `index.html` only, and only where it was out of step with the product or missing a step.
The page already carries most of the structure I had drafted (how it builds, the four-decision record, pricing, FAQ), so this is
alignment, not a rewrite. See `website/WEBSITE_CHANGES_v17.txt`. In short: the Free tier no longer promises a Mirror look only
"after your third decision"; the three-step line gains "Then Quorum checks back on how it went"; the FAQ gains "What happens after I
decide?" and "Do I need an account to start?" (visible and in the FAQPage schema). Headline, positioning, pricing and legal are
unchanged on purpose: see the audience question below, which affects them.

## Events

New: `left_out_shown`, `left_out_submitted`, `left_out_dismissed` (items_count, answered_count, flow_version; never the answers),
`mirror_insight_dismissed` (kind, surface), `mirror_preview_viewed` (surface, total_count). `auth_prompt_seen` now carries `reason`.

To read the fast-path trade-off: of fast-path sessions that showed the card, how many answered (`left_out_submitted` over
`left_out_shown`). A high answer rate on the same slots is evidence the fast path is skipping things people care about.

## Check after deploy

1. Fast-path chat (`INTAKE_FAST_MODE=fast` in a test environment), medium-stakes financial decision: after the Council's read, a card
   lists the skipped questions. Answer one, tap "Add these and update the Council": advisors re-read, the read updates, the Desk still
   shows one decision. "Not now" hides it. A chat that asked everything shows no card.
2. Signed in with five or so decisions, three or more with a recorded outcome and a before-confidence: the overview may show a confidence
   gap and, if the thresholds are met, "sure and wrong". With fewer, it shows neither.
3. If a contradiction has been stored for the account, one appears as "Quorum's reading" with both decisions; "That's not right" removes it.
4. Signed out with decisions on this browser, open `/mirror`: a first look, then "Keep this, and see what it rests on". Signed out with
   nothing saved (or cookies rejected): the three-question explanation. Nothing asks for an email before something is shown.
5. Anonymous person taps "Not ready to decide": the reminder card appears; "Not now" hides it everywhere for 72 hours.
6. Anonymous person with a check-in due on `/`: the due row, then the reminder card.

## Rollback

`LEFT_OUT_CARD=off`, `MIRROR_OVERVIEW_CONTRADICTIONS=off`, `NEXT_PUBLIC_MIRROR_PREVIEW=off` (fresh build). The ConnectCard reasons and the
calibration insights have no switch; redeploy v16 to remove them. No data migration; nothing to undo in the database.

## Not in this release

- A bare "email me my check-in" with no verification (deliberately not built; see item 3).
- Parked decisions on the Desk for anonymous people (the Watchlist API needs an account).
- Showing which specific advisor assumption a "not asked" answer changed after the Council re-reads. The read updates in place; a
  before-and-after view would be a separate feature.
- Headline and audience changes on the website and app front door. These are a positioning decision, not an accuracy fix; see the
  separate point of view.
