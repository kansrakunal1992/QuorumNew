# Decision types and situations: how the intake adapts, and how to grow it

## The model: types contain situations
```
person's words
   │
   ├─ 1. planner (LLM) names a SITUATION ("housing.buy") or a broad TYPE ("housing")   ← lib/chat-intake-planner.ts
   ├─ 2. else the phrase library reads the words: instant, free, deterministic          ← lib/decision-playbooks.ts
   │      (also sharpens a broad type into its situation, but only before any answer exists)
   ├─ 3. else the type's generic questions                                              ← lib/chat-intake-brief.ts KIND_SLOTS
   └─ 4. else the generic `other` questions. Nothing is ever a dead end.

situation → its own questions (slots) + tap-answers → cards          ← lib/playbook-data/*.ts
            inherits "other routes" / "what set this off" and card templates from its type
```
* **16 types** (career_exit, job_offer, career_move, relocation, money, business, relationship, education, purchase,
  housing, health, family, team, product, lifestyle, other): the broad shapes, each with required questions.
* **80 situations** inside them, **900+ everyday phrasings** (`housing.buy`, `relationship.breakup`, `lifestyle.pet`,
  `career_move.ask_raise`...). Situation ids are namespaced under their type, so everything that already carries a
  decision kind (state, analytics, the planner) carries a situation for free. Analytics get stable ids, never model wording.
* Serious situations ask 3-5 required questions; **everyday ("light") situations ask 2**, and "other routes" is optional, so
  a weekend or a pet doesn't get the weight of a career change.

## Why 80 situations cover "500+ decisions"
Decisions share shapes. "Buy a flat", "buy a plot", "buy my first home", "ready-to-move vs under construction" all need
the same questions, so they are ONE situation with many phrasings. The matcher is forgiving (tense, plurals, filler words,
word-order slack), so one phrasing like "sell my flat" also catches "we're thinking of selling our flat".
Cost of a new situation: ~8 lines of data. Cost of 500 bespoke templates: 500 things to write, keep consistent and test.

## Adding a situation
Add an entry to the right file in `lib/playbook-data/` (work, money-home, people, everyday):
```ts
{ id: 'lifestyle.pet', label: 'Getting a pet', light: true,
  slots: [
    ['time', 'Time at home', 'How much time could you give a pet each day?', ['Little', 'A few hours', 'Most of the day'], 'r'],
    ['costs', 'Costs', 'Have you thought through vet and daily costs?', ['Yes', 'Partly', 'No']],     // no flag = optional
  ],
  aliases: ['get a dog', 'adopt a cat', '=puppy', ...] }
```
slot = `[key, label, question, tap-answers | null, flags]`; flags: `r` required, `m` pick several, `s` sensitive ("Prefer not to say").
A leading `=` marks a single distinctive word that is safe on its own. `npm test` then enforces: question wording (no
feelings / "success" questions), 2-5 tap-answers none imitating "Not sure", no phrase claimed by two situations, **every
phrase resolves to its own situation**, every question builds a valid card, analytics ids are safe.

## Growing it at scale
```
# decisions.txt: one decision per line, in real people's words
ANTHROPIC_API_KEY=... npm run playbooks:draft -- decisions.txt
```
It skips what is already recognised (and tells you the coverage %), has Claude group the rest into situations, runs every
draft through the same validator as the tests, and writes `playbook-drafts/<time>.ts` (accepted) plus a `.rejected.json` with
reasons. It never edits the library: a human reads the drafts, fixes the wording, pastes them in, and the tests check them.
Where to get the lines: your own testing, tester feedback, support questions. For production, events carry only the
type (never decision text, by design):
```sql
select props->>'decision_category' as kind, count(*) as n,
       round(100.0 * count(*) / sum(count(*)) over (), 1) as pct
from events where event = 'intake_council_ready' and created_at > now() - interval '60 days'
group by 1 order by n desc;
```
Ids look like `housing.buy` (a situation was recognised) or `housing` (only the type). A large bare-type or `other` share
shows where situations are missing.

## Known gaps (the backlog)
`KNOWN_SILENT_MISSES` (tests/fixtures/decision-corpus.ts) and `BACKLOG` (tests/decision-playbooks.test.ts) list real
decisions the phrase library does not catch yet ("where should we go for our honeymoon", "should I forgive my sister").
They fall back to the planner or the type's questions, never to a wrong situation (the tests insist on that). Fix them by adding
phrasings: data only.
