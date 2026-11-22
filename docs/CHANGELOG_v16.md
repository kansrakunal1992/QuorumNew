# v16 (21 Nov 2026): the Mirror as three questions, a lighter retrieval tier, the intake fast path

Phases 4 and 5. Applies on top of v15 (`docs/CHANGELOG_v15.md`).

Verified: 848 tests pass (814 before, 34 added), typecheck introduces no new errors (the 35 existing `TS2802` target errors are
unchanged), and `next build` completes with the new route compiled. Not verified: anything against live Supabase, Anthropic,
Razorpay or Railway, nothing clicked through in a browser, and the two SQL queries below have not been run.

## Deploy

### 1. SQL

**None.** No tables, columns or views changed. The intake arm rides on `flow_version`, which every intake event already carries.

### 2. Railway variables

All three are **server-side** (no `NEXT_PUBLIC_` prefix). The browser bundle does not depend on them, so unlike v15 there is no
rebuild requirement for the browser. Saving a variable in Railway redeploys the service as usual.

| Variable | Action | Effect |
|---|---|---|
| `INTAKE_FAST_MODE` | **Set to `experiment`** to start the comparison. Leave unset (or `off`) to change nothing. | `off` is today's intake. `fast` puts everyone on the fast path. `experiment` splits half and half. Anything else means `off`. |
| `STRUCTURAL_LIGHT_MIN_SESSIONS` | Nothing. Default is `1`, so the light tier is live on deploy. Set `0` to switch it off. | A person's second decision can now draw on their first. |
| `STRUCTURAL_LIGHT_MATCH_THRESHOLD` | Nothing. Default `60`. | Similarity bar for the light tier (the full tier stays at `MATCH_THRESHOLD`, default 45). |
| `MIN_SESSIONS`, `MATCH_THRESHOLD` | Leave as they are. | Unchanged; they still govern the full tier. |

The Mirror overview has no switch: it is read-only, free, and makes no model call. To undo it, redeploy the v15 commit.

**On `experiment` versus `fast`.** At roughly six started decisions a week, a half-and-half split gives about three per arm per
week. No difference in completion or in "did this feel specific to you?" will be readable for months. If you want to move
faster, `fast` for everyone with the guard metrics below is defensible, but then the evidence is before-and-after, which is weaker.
My recommendation is `experiment`, read the guard metrics as they arrive, and switch to `fast` yourself if they are clearly not worse.

## What changed

### Phase 4: the Mirror, answered as three questions

- **A free, evidence-backed overview at the top of `/mirror`**, for anyone signed in (including people who have not paid, and
  people below the teaser line): *what Quorum has learned*, *what to watch for*, *what to try next time*. Every insight is a count
  over the person's own decisions and shows how much it rests on. Signed-in owners can open the decisions behind each one.
  `lib/mirror-insights.ts` (pure, tested), `app/api/mirror/overview/route.ts`, `components/MirrorOverview.tsx`,
  `lib/decision-history.ts` (`loadInsightRows`), `app/mirror/page.tsx`.
- **Nothing is manufactured.** A repeated priority is shown only if it is a majority of the decisions that named one; an instinct
  split only if it is lopsided (3 of 4, not 2 of 3); "never committed to" needs two examined decisions at least two days old;
  "established" needs five decisions and a clear majority. With nothing above its threshold the page says so and says what
  would change that. No model call, no personality language (tested).
- **Insights now include two the Mirror lacked:** examined-but-never-committed decisions, and check-ins waiting. Both come from
  facts already on the record. If the outcome lookup fails, these are hidden rather than guessed.
- **The Desk's single line becomes the strongest insight**, with its confidence label. It is loaded by session id so it works
  without an account and carries counts only.
- **The paid Mirror is untouched.** Fingerprint, rules, contradictions, calibration, graph and the rest follow below, as before.
- **The Council's memory starts at the second decision.** Retrieval gained a light tier: from one past session, one match, at a
  higher similarity bar (60), with an instruction to the advisors that it is a single comparison and not a pattern. The Council
  page labels it "Early comparison … One comparison, not a pattern." The full tier (five past sessions) is unchanged.
  `lib/structural-retrieval.ts` (`retrievalPlan`), `app/api/structural-match/route.ts`, `components/SessionView.tsx`,
  `components/PersonaPanel.tsx`. Matching is by `user_id` or `user_email` on the session, as before; a device id alone is not enough, so
  someone who has not signed in or given an email gets no early comparison.

### Phase 5: the intake fast path

- **A second flow version, `v9_fast_path`**, run by the same engine. It changes two things: ceilings are 3, 4 and 5 exchanges
  instead of 5, 7 and 9, and lower-weight required slots (below 70; below 60 at high stakes) may be left to the Council as "not
  asked". It does **not** change what is critical: a slot the person's own situation makes material (for example runway when
  they are leaving a job) is still asked, and high-weight required slots are still asked. "Let me add more" restores the standard
  ceilings. `lib/chat-intake-depth.ts`, `app/api/chat-intake/route.ts`.
- **The server assigns the arm once**, on a chat's first exchange, and stores it, so it cannot change mid-conversation. In
  experiment mode a known device id keeps a person in one arm; without one the arm is random per chat.
- **Every intake event carries the arm.** The client now reads the cohort from the server's response instead of a constant, so
  `decision_started`, card events and checkpoint events all say which flow they belong to. `components/ChatIntake.tsx`. Two
  existing tests that locked the literal old call were updated for this.

## Events

New: `mirror_overview_viewed` (surface, total_count, learned_count, watch_count, mode) and `mirror_insight_expanded` (kind,
confidence, surface). Counts and fixed labels only; both pass the privacy guard.

Existing events that now answer your Phase 4 and 5 questions: `intake_*` and `decision_started` (now carrying the real
`flow_version`), `decision_checkpointed` (has `session_id` and `flow_version`), `council_execution_started`, `decision_completed`,
`decision_locked`, `council_specificity_feedback` (`specific`: yes, partly, no), `intake_summary_feedback`.

### Comparing the two flows (unrun)

Per session, from the moment the decision was checkpointed:

```sql
with arm as (
  select session_id, props->>'flow_version' as flow_version
  from events
  where event = 'decision_checkpointed' and session_id is not null and props ? 'flow_version'
), seen as (
  select session_id, event, props from events where session_id is not null
)
select a.flow_version,
  count(*)                                                                                           as sessions,
  count(*) filter (where exists (select 1 from seen s where s.session_id = a.session_id and s.event = 'council_execution_started')) as council_started,
  count(*) filter (where exists (select 1 from seen s where s.session_id = a.session_id and s.event = 'decision_completed'))         as council_finished,
  count(*) filter (where exists (select 1 from seen s where s.session_id = a.session_id and s.event = 'decision_locked'))            as committed,
  count(*) filter (where exists (select 1 from seen s where s.session_id = a.session_id and s.event = 'council_specificity_feedback' and s.props->>'specific' = 'yes'))     as specific_yes,
  count(*) filter (where exists (select 1 from seen s where s.session_id = a.session_id and s.event = 'council_specificity_feedback' and s.props->>'specific' = 'no'))      as specific_no
from arm a
group by a.flow_version;
```

Exchanges per chat, by flow:

```sql
select flow_version, count(*) as chats, round(avg(steps), 2) as avg_exchanges
from (
  select props->>'chat_intake_id' as chat, max(props->>'flow_version') as flow_version, max((props->>'intake_step')::int) as steps
  from events
  where event = 'intake_step_shown' and props ? 'chat_intake_id' and props ? 'intake_step'
  group by 1
) t
group by flow_version;
```

**Guard metrics.** The fast path is working only if exchanges drop and completion rises **without** `specific_no` rising. If the
share answering "no" to "did this feel specific to you?" goes up in the fast arm, the Council is working from thinner briefs:
switch back to `off`.

## Identity and privacy

- The overview endpoint has two modes with deliberately different reach. Signed in (Bearer token): the owner gets the decisions
  behind each insight (first words of each decision, linking to its record). Anonymous (`?sid=`): identified by the session row, the
  same trust model as `/api/session/[id]/cross-decision`, and gets claims, confidence and **counts only**. A session id is a
  capability, so one id must not hand out the ids or text of other sessions.
- Anonymous people see "Sign in to see which ones." where the evidence list would be. That is the honest version of the
  identity pitch: the decisions behind a claim are what an account keeps.
- The light retrieval tier uses the same identity rules as before: it finds earlier decisions by account or email, not by device. An
  anonymous person with decisions on the Desk therefore does not get the early comparison in the Council until they sign in or
  give an email. That is another reason the reminder card at commitment (v15) matters.

## Check after deploy

1. Signed in with two or three decisions, open `/mirror`: the three-question overview appears above the existing view, with a
   confidence label on each insight and a "Based on N decisions" control that lists them. With fewer decisions, or nothing above
   a threshold, it says so rather than showing filler.
2. Signed out, `/` with decisions on the Desk: one "Quorum noticed" note (or none), with "Sign in to see the decisions behind it".
3. Signed in (or with an email on the session), make a second decision that resembles the first: the Council page may show an "Early comparison" banner saying one
   comparison, not a pattern. A dissimilar second decision should show nothing; that is correct.
4. Set `INTAKE_FAST_MODE=fast` in a test environment, start a chat: events carry `flow_version: v9_fast_path`, and a medium-stakes
   financial decision stops after fewer questions with the lower-weight slots handed over as "not asked". Tap "Let me add more"
   and it continues.
5. Set it to `off`: every new chat is `v9_progressive_cards`. Chats already started keep the flow they began with.
6. Phone width: expand an insight's decisions; rows are tappable and nothing overflows.

## Rollback

`INTAKE_FAST_MODE` unset or `off`; `STRUCTURAL_LIGHT_MIN_SESSIONS=0`. The Mirror overview has no switch: redeploy the v15 commit.
No data migration, nothing to undo in the database.

## Not in this release

- **"Add what I left out" after the Council** for fast-path sessions. The Council already receives deferred slots marked "not
  asked", but there is no new surface on the Council page prompting the person to add them. I did not find an existing one wired
  into the Council page to reuse, so I have not guessed.
- Regrouping the 11 detail sections of the paid Mirror under the three questions. The overview sits above them instead; the
  deeper sections are as they were.
- Calibration (pre- versus post-confidence) and contradictions as overview insights. They need their own evidence rules and
  belong in a later pass; showing them here without that would break the no-manufactured-insight rule.
- Parked decisions on the Desk for anonymous people (the Watchlist API needs an account), and email or push changes.
- Any readable experiment result. That needs volume you do not have yet.
