# v15 (21 Nov 2026): close the loop, the Decision Desk, the front door

Phases 1 to 3 of the redesign. Phases 4 (Mirror reorganised around three questions, a free evidence-backed preview, a lighter
retrieval gate) and 5 (intake fast-path experiment) are not in this release.

Built against the 20 Nov 2026 snapshot. Verified: 814 tests pass (771 before, 43 added), typecheck introduces no new errors
(the 35 pre-existing `TS2802` target errors are unchanged), and `next build` completes. Not verified: anything against live
Supabase, Razorpay, Resend or Railway, and nothing was clicked through in a browser. See "Check after deploy".

## Deploy in this order

### 1. SQL

**None required for v15.** No tables, columns or views were added or changed.

Please confirm one existing migration is applied in production, because `NEXT_PUBLIC_PRETAG_ENABLED` is on and depends on it:
`supabase/sprint_intake_v13_pretag.sql`.

### 2. Railway variables

Service, then Variables.

| Variable | Action | Why |
|---|---|---|
| `NEXT_PUBLIC_AUTH_GATE_MODE` | **Remove it** (preferred). Or set it to `off`. | It is `d3` today. `d3` replaces the chat input with a sign-in card once a device has 2 decisions, and `/api/chat-intake` also refuses with a 403. That blocks the third decision, and it is the wrong moment to ask for identity. Unset and `off` behave identically (`lib/auth-gate.ts` falls back to `off` for anything other than `d3`, `d4` or `experiment`). |
| `NEXT_PUBLIC_LOCK_OPTIONAL` | Nothing. On by default. | Kill switch: set `off` to restore the old lock-before-Brief rule. |
| `NEXT_PUBLIC_DESK` | Nothing. On by default. | Kill switch: set `off` to restore the previous returning-user screen. |
| `NEXT_PUBLIC_FRONT_DOOR_V15` | Nothing. On by default. | Kill switch: set `off` to restore the previous headline and drop the new panels. |
| `NEXT_PUBLIC_NATURAL_INTAKE_ENABLED` | Leave `true`. | The Desk lives inside the natural-intake front door. If this is `false` the Desk does not render. |
| `NEXT_PUBLIC_UNIFIED_SESSION_ENABLED` | Leave `true`. | |
| `NEXT_PUBLIC_CONVENE_GATE` | Leave `off`. | See "Identity" below. |
| `NEXT_PUBLIC_WATCHLIST_ENABLED`, `NEXT_PUBLIC_EARLY_COUNCIL_START`, `NEXT_PUBLIC_PRETAG_ENABLED`, `NEXT_PUBLIC_CONTEXT_INGESTION_ENABLED` | Leave `true`. | Unchanged. |

### 3. Redeploy: this must be a fresh build, not a restart

Every variable above starts with `NEXT_PUBLIC_`. Next.js compiles those values into the browser bundle during `next build`.
Changing the variable and restarting the existing deployment will **not** change what visitors' browsers run. The server route
(`/api/chat-intake`) reads the variable at runtime and the browser reads the compiled value, so a restart without a rebuild can
leave the two disagreeing.

This service builds with Nixpacks (`railway.toml`: `builder = "NIXPACKS"`), which runs `npm run build` (`next build`) on each new
deployment. So:

1. Make the variable change in Railway (it may show as a staged change).
2. Deploy the v15 commit together with it, so one new deployment carries both the code and the variable.
3. In the deployment's **build logs**, confirm `next build` ran and finished. If you only see start-up logs and no build step,
   the existing build was reused: trigger a new deploy from a new commit or with the build cache cleared.
4. After it goes live, anyone with a tab already open must reload: their tab still holds the old bundle.

I could not verify Railway's behaviour from here, so treat step 3 as the check that matters.

## What changed

### Phase 1: close the loop

- **The lock no longer hides the product.** Under the unified-session flag the Brief, "Save to Record", the Record Receipt and
  the whole continuity block (prediction tally, cross-decision line, "bring me another decision", the reminder ask) used to
  appear only after a person locked a final decision and a review date. In the 20 Nov snapshot 2 people completed a Council and 0
  locked, so none of it was ever seen. Finishing the Council is now enough.
  `lib/feature-flags.ts` (`isLockOptionalEnabled`, `isLockRequired`), `components/SessionView.tsx`,
  `components/SynthesisCard.tsx` is not modified; it already took `decisionRequired` and now receives it from the same check.
- **Committing is one tap.** Tapping an option commits it ("Commit to this"); the review date is pre-filled. Typed text keeps its
  Review step, because a typed decision can contain a typo and cannot be edited afterwards.
  "Not ready to decide — leave it open" is a real choice; the decision waits on the Desk.
  `components/PredictionReveal.tsx`.
- **The check-back promise can now be kept.** After committing, a person who is not signed in is asked where Quorum can reach
  them (the existing reminder card, now on the commit step). Previously "Quorum will bring it back to you on your review
  date" was shown to people no email could ever reach. If the browser is not set to remember decisions (no functional cookies),
  the copy says so rather than claiming "recorded on this device".
  `components/PredictionReveal.tsx`, `components/NextDecisionPrompt.tsx` (`suppressConnect`, so the ask is not shown twice).
- **Sign-in always links the decision being signed in for.** `ConnectCard` stashed the current session id for the Google
  round trip only in the sign-in-before-Council gate mode. Without functional cookies that id is the only way
  `/api/auth/link-sessions` can find the decision, so it is now stashed in every mode (still only at the moment the person taps
  sign-in). `components/ConnectCard.tsx`.

### Phase 2: the Decision Desk

- **`/` becomes the Desk for anyone with decisions.** It works for signed-in people and for anyone this browser can recognise
  from stored decision ids. Seeing it never requires an account. Content: check-ins that are due first, then the "bring a
  decision" box, then examined-but-undecided, saved-but-not-examined, waiting-for-check-in, one cross-decision line labelled
  "early" under five decisions, and a plain statement of how much evidence the record has. It holds its place while history loads
  so a returning visitor never sees the first-visit screen flash. It is not a task board: no priorities, columns, overdue
  styling or streaks.
  `components/DecisionDesk.tsx`, `lib/desk.ts` (pure, tested), `components/ChatIntake.tsx`, `app/NaturalIntakeClient.tsx`.
- **`/api/history` returns five more existing columns** (`status`, `session_depth`, `final_decision_locked_at`,
  `commitment_review_date`; `outcome` was already there). Existing callers ignore them.
- **Two destinations and one action.** Desk, Mirror and "+ Bring a decision" (`/q`). The Council is deliberately not a tab: it is
  a room you enter from a decision, not a place you return to. `components/AppNav.tsx`, mounted on the Mirror and Record pages;
  the home top bar shows Desk, Mirror and FAQ for returning visitors.
- **A due check-in opens the outcome tracker** (`/record/{id}#outcome`); the record page gained the `#outcome` anchor.

### Phase 3: the front door

- **First-visit headline and sub-line name the proposition and the Council.** "Bring a hard decision. Have it challenged, and
  remembered." The box is still the first thing to act on.
- **Below the box:** what happens (examined, decided, remembered), an example result behind one tap, and how the record builds
  with use, written to avoid claiming Quorum knows or predicts the person. `components/FrontDoorExplainer.tsx`.
- **Page title is unchanged; the description** (search and share previews) now matches. `app/page.tsx`.
- **Marketing site:** not in this repo. Structure and copy for it: `docs/MARKETING_SITE_COPY_v15.md`.
- Copy rules: `docs/COPY_AND_STRUCTURE_LOCK_v1.md` has a v15 addendum lifting "never say Council" for the first-visit screen only.

## Identity: how decisions follow the person

- **Anonymous, consent given:** decisions are remembered through the stored session list and device id. The Desk reads them
  (reads are always permitted). On sign-in, `/api/auth/link-sessions` links them by id list, by device id and by email, all bound
  to the verified token. Unchanged.
- **Anonymous, no functional cookies:** nothing is stored on the browser, so there is no Desk to recognise them by, and this release
  does not bypass that. Their one route to continuity is signing in, and the reminder card at commitment is where it is
  offered. The sign-in now carries the current decision's id in every mode, so that decision is linked. Decisions they made
  earlier without consent cannot be linked, because nothing identifies them. This is the existing architecture's limit.
- **Signed in:** `/api/history` merges stored ids with everything on the account, so the Desk is complete on a new device.
- **Parked items (Watchlist) are shown to signed-in people only,** because that API needs an account. Not changed.
- Why the Convene gate stays off and the d3 gate comes off: both put the sign-in demand where intent is highest and value has
  not been delivered. The commit step asks after value, and offers the benefit in the same breath (a reminder on the date).

## Events

New: `decision_locked` (via, days_out, signed_in), `commit_deferred`, `desk_viewed` (counts per section),
`desk_card_clicked` (section, action), `nav_clicked` (to, surface), `front_door_section_opened` (section).
All pass through the existing privacy guard (`lib/event-props.ts`): counts and identifiers only, no decision text.
Also now emitted from the Desk: `observation_seen` with `surface: 'desk'`.

**Cutover warning.** Before this release, `decision_completed` with `path: 'council'` fired when the decision was *locked*
(unified flag on). It now fires when the Council *finishes*. Expect it to rise on the day of release. Use `decision_locked`
for commitment, and mark 21 Nov 2026 as the break in any trend.

Existing events that now matter more: `consent_shown`, `consent_accepted`, `consent_rejected` (how many people can ever have a
Desk), `review_date_chosen`, `outcome_recorded`, `notification_opened`.

## Check after deploy

1. Private window, accept cookies. Make a decision through to the Council result: the Brief, Save to Record and the "bring me
   another decision" block are visible **before** committing. Commit with one tap on an option.
2. Reload `/`: you see the Desk with that decision under "Waiting for a check-in", and the box above it. Not signed in.
3. Make a second and a third decision from the same window. The third opens the chat input (no sign-in card), and
   `POST /api/chat-intake` returns 200, not 403.
4. Sign in from the reminder card with Google, then again in a fresh window with an email link. After sign-in `/` shows the
   earlier decisions under the account.
5. Private window, **reject** cookies: finish a Council. The copy says the browser will not remember it and offers sign-in.
6. Set a review date in the past on a test decision: it appears first on the Desk and opens the outcome tracker.
7. Phone width (about 375px): the Desk rows and the commit step are tappable, nothing overflows.
8. In the first-visit window, open both panels; confirm `front_door_section_opened` arrives.

## Rollback

Each change has its own kill switch (above); set `off` and redeploy with a fresh build. To restore the sign-in demand at the
third decision, set `NEXT_PUBLIC_AUTH_GATE_MODE=d3` again. No data was migrated, so there is nothing to undo in the database.

## Not in this release

- Mirror reorganised around "what I've learned, what to watch for, what to try next", and a free evidence-backed preview.
- Lowering the structural-retrieval gate (`MIN_SESSIONS = 5`) so a second decision can draw on a first. Until then cross-decision
  context in the Council arrives late for most people.
- Shortening intake. The ceilings (5, 7, 9 exchanges) are unchanged; this needs the fast-path experiment first.
- A bookmarkable `/desk` route, and push or email changes. The existing review-date, check-in and council-nudge emails are
  untouched; the generic weekly email remains on by default and is worth reviewing.
- Production configuration beyond the eight flag values supplied. `INTAKE_HISTORY_REUSE`, `EXAMINER_IN_CHAT`, the connector flags
  and `INSTITUTIONAL_MODE` were assumed unset.
