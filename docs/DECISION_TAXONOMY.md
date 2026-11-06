# Decision types: how the intake adapts, and how to grow it

## How it works today
```
person's words
   │
   ├─ planner (LLM) picks decisionKind each turn           ← lib/chat-intake-planner.ts (catalog is built from KIND_SLOTS)
   │     └─ if it gives none → decision-taxonomy keyword fallback   ← lib/decision-taxonomy.ts (never overrides the planner)
   │
   ├─ kind → required/optional SLOTS ("what must we know")  ← lib/chat-intake-brief.ts  KIND_SLOTS
   │
   └─ slot → approved card template (stable ids, rules)      ← lib/chat-intake-cards.ts CARD_PRESETS
         planner may reword/extend ≤2 options; validated; falls back to approved list → slot chips → plain text
```
Anything the kinds do not cover resolves to `other` (4 generic slots). That path is safe, but it is the weakest experience.

## Kinds (14)
career_exit, job_offer, relocation, money, business, relationship, education, purchase, **housing, health, family, team, product**, other.
The bold five were added Nov 2026; before that a home purchase was force-fit into `purchase` (budget chips, no loan / horizon questions).

## Why not "a library of 500+ decisions"?
A decision is not what needs a template, a *shape* of decision is. "Buy a flat", "sell a plot", "renovate the kitchen" and
"rent vs buy" all need the same questions (price & funding, monthly fit, how long you will stay, a cheaper route), so they are ONE kind.
500 bespoke templates would be 500 things to write, keep consistent and test, and the long tail never ends. Aim for ~25–30 kinds,
each with its own slots and cards, and let phrasing variety be handled by the planner + the keyword rules.
The 500-row list is still worth having, as **test corpus** (`tests/fixtures/decision-corpus.ts`), not as templates.

## Growing it from data (privacy-safe)
Events carry only the kind, never decision text. First: how big is the `other` bucket?
```sql
select props->>'decision_category' as kind,
       count(*)                                                    as n,
       round(100.0 * count(*) / sum(count(*)) over (), 1)          as pct
from events
where event = 'intake_council_ready' and created_at > now() - interval '60 days'
group by 1 order by n desc;
```
If `other` is under ~10% the taxonomy is covering what people bring; if it is 25%+, add kinds. To learn WHAT is in it without
reading private text, add rows to the corpus from decisions you yourself (or consenting testers) typed, and check which fall through.

## Adding a kind (all five steps; tests fail loudly if you skip one)
1. `lib/types.ts` → add to `DecisionKind`.
2. `lib/chat-intake-brief.ts` → `DECISION_KINDS`, `KIND_LABELS`, `KIND_SLOTS` (3–6 required slots incl. `alternatives`; no "feel / success" questions).
3. `lib/chat-intake-cards.ts` → `CARD_PRESETS[kind]` for slots that have a fixed answer set.
4. `lib/decision-taxonomy.ts` → a rule (strong = 3 pts, weak = 1, threshold 3). Prefer precision: silence is better than the wrong kind.
5. `tests/fixtures/decision-corpus.ts` → at least 5 rows for the kind (enforced), plus a few near-misses that must stay silent.
