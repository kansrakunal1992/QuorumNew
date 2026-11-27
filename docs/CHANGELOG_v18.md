# v18 (25 Nov 2026): founder-first first-visit screen

Applies on top of v17 (`docs/CHANGELOG_v17.md`). **App only.** The website is a separate deliverable and is not finished; see the handoff.

Verified: 904 tests pass (880 before, 24 added), typecheck introduces no new errors (the 35 existing `TS2802` target errors are unchanged), and
`next build` completes. Not verified: nothing was clicked through in a browser, and nothing was run against live Supabase or Anthropic.

## Deploy

- **SQL:** none.
- **Railway variables:** none required. One optional off switch, `NEXT_PUBLIC_FOUNDER_FRONT_DOOR=off` (build time, needs a fresh build).
- Still outstanding from v15: remove `NEXT_PUBLIC_AUTH_GATE_MODE` (it is `d3`).

## The principle

Narrow the commercial message and the examples. Do not narrow the product: the box still takes anything, every category and every decision
capability remains, and personal decisions are supported. Nothing was removed; things were reordered and one label was renamed.

## What changed

1. **Six founder starters, one tap each**, under the box and above the existing pills, first visit only (a returning visitor's home is the Desk).
   In your order and your wording: raise or bootstrap; hire a senior leader or manage it myself; new market or existing; co-founder or independent;
   pricing or packaging; sell or keep scaling. A quieter seventh line is the feeder: "Thinking of leaving a job to start something of your own?".
   `lib/founder-starters.ts`, `components/FounderStarters.tsx`, `components/ChatIntake.tsx`.
2. **Each starter carries its playbook.** On 25 Nov the keyword classifier matched only four of the six sentences: "hire a senior leader" and
   "bring on a co-founder" matched nothing, so those two would have been asked generic questions although `team.hire` and `business.cofounder`
   exist. The playbook id is now sent with the first message and the server uses it for a **new chat only**, after checking it is a real playbook.
   The planner also can no longer downgrade a specific playbook to its own parent type. `app/api/chat-intake/route.ts`, `lib/chat-intake-turn.ts`.
3. **Existing pills reordered, none removed.** Business leads; "Smaller calls" is now "Something smaller" with the same text; a heading reads
   "Something else? Pick the kind of decision:". `lib/intake-examples.ts`, `components/IntakeQuickStarts.tsx`.
4. **Headline and sub-line** sell a review, not advisors: "Review a hard business decision before you commit." / "Quorum structures the decision,
   exposes the assumptions you are relying on, has independent perspectives challenge it, and gives you a documented brief. Then it tracks what
   happened. Anything you are weighing works too." The earlier copy is behind the flag.
5. **Sample decision and result reflect the target customer:** "Should I hire a senior leader or continue managing this function myself?",
   with the Examiner's first question, the advisors, where they split, the Council's read and a 90-day check-back. Still labelled as invented.
   The "how it works" steps become structured, challenged, documented, tracked. `components/FrontDoorExplainer.tsx`.
6. **Campaign links for the six** lead the scenario list (`?scenario=raise_or_bootstrap`, `hire_senior_leader`, `new_market`, `add_cofounder`,
   `change_pricing`, `sell_or_scale`). Each has one concrete, editable fact and one worry so the chat asks fewer follow-ups. The four personal
   scenarios are unchanged. `lib/post-scenarios.ts`.
7. **Measurement:** `decision_checkpointed` now carries `decision_kind` (a base kind such as `business`) and `segment` (`founder_business`,
   `feeder_leave_job`, `money_unclear`, `personal_other`, `unclassified`), the same grouping the repeat-analysis SQL uses. Founder-versus-personal
   repeat can therefore be measured going forward from the events themselves. `starter_picked` carries `placement: 'founder_starter'`.
   `lib/segment.ts`, `components/DecisionCheckpoint.tsx`, `lib/event-props.ts`.

## Tests changed, and why

Three earlier tests locked exact old wiring and now assert the intended new behaviour: the pill order and label, the explainer's render
condition, and the pill render pattern. No assertion was weakened; each was updated to the new literal.

## Check after deploy

1. Private window, `/`: the new headline, the box, then six founder questions and a quieter seventh line, then "Something else?" and six pills.
2. Tap "Should I hire a senior leader or continue managing this function myself?": the first questions are about the hire (the `team.hire` playbook),
   not generic ones. Same for "Should I bring on a co-founder or continue independently?".
3. Open "See an example result": the founder sample, labelled as invented.
4. With decisions on the device, `/` shows the Desk, not the starters.
5. Phone width: each founder row is tappable and nothing overflows.
6. `/?scenario=sell_or_scale` pre-fills the box with an editable sentence.
7. `NEXT_PUBLIC_FOUNDER_FRONT_DOOR=off` plus a fresh build restores the v15 first-visit screen.

## Not in this release

Company-context capture, a shared workspace, and anything for the pilot beyond measurement. See the handoff for the gap list and the reasons they are deferred.
