# v13 — "Convene the Council" no longer waits for the ontology tagger (pre-tag)

Builds on v10–v12. **Off by default.** One additive database migration. No new environment secrets.

## The problem, and the design choice

After "Convene the Council" the person waited for the ontology tagger — one model call, several seconds — before the
Examiner's questions could be known. The tagger only needs the decision text and context, and both exist *before* the
session does. So the confirm screen now asks the server to run it early.

**Why this is not a "draft session".** The obvious way to prepare early is to create the session row early and flag it as a
draft. That leaves a real row in `sessions` for everyone who looks at the confirm screen and leaves, and `sessions` is read
by roughly 80 files (counts that decide what first-time users see, history, Mirror, the graph, prediction tally, ~10 cron
jobs, exports, account deletion, share links, structural matching…). Every one would need a draft filter, and any one missed
would show phantom decisions. This design adds **nothing to `sessions`**: the result is parked on the *chat*
(`chat_intakes`), and when the person later taps Convene the normal session is created exactly as before, with the
ontology route using the parked result instead of calling the model. The only code that reads the new columns is
`lib/chat-intake-pretag.ts` (a test fails if any other file does).

## How it works

1. Confirm screen appears → `POST /api/chat-intake/pretag` (fire-and-forget). The server assembles the same text the
   checkpoint will, tags it, and stores `{pre_tag, pre_tag_hash, status}` on the chat. An atomic conditional write means two
   requests never cause two model calls.
2. Convene → the session is created as always → `POST /api/ontology` (already fired by `/api/session`, which now also
   passes the chat id). It hashes its own tagger input; if it equals the stored hash and the result is fresh (< 2 h) and
   valid, it **uses it instead of calling the model**, then runs the unchanged steps: rule engine, `sessions_ontology`
   write, structural match. A result still being computed is waited for (≤ 9 s — never longer than tagging from scratch).
   The result is used once, then cleared.
3. Every other case is the previous behaviour: the person edited the decision, went back to the chat, the model failed,
   the result is stale or invalid, the columns aren't migrated, or the feature is off → the tagger runs normally.

**One deliberate behaviour change (only when the feature is on):** every session is tagged from the same canonical input —
the context *without* the person's "where they're leaning" and "what matters most" lines, which are not known yet at
pre-tag time. Doing it for hits and misses alike keeps a result from depending on timing. The tagger prompt never refers to
lean or priority, and those lines are still saved in the session's context for everything else (examiner, prediction,
Council). With the feature off, the tagger sees the full context exactly as before.

## Rollout (in this order)

1. Deploy the code — nothing changes (flag off).
2. Run `supabase/sprint_intake_v13_pretag.sql` in the Supabase SQL editor (4 nullable columns on `chat_intakes`; idempotent;
   safe before or after step 1).
3. Set `NEXT_PUBLIC_PRETAG_ENABLED=true` (and `NEXT_PUBLIC_NATURAL_INTAKE_ENABLED=true`, already on) and **redeploy** —
   `NEXT_PUBLIC_*` values are baked in at build time.
4. Verify: in the server logs, `[Ontology] Session … used the pre-computed tag (no model call)` should appear for most
   launches; and "Convene → first advisor" should drop by roughly the tagger's latency when the person spent at least that long on the
   confirm screen. (If they tap faster than the tagger finishes they wait only for the remainder.)
5. Rollback: unset the flag and redeploy. Optionally drop the columns (commented at the bottom of the SQL file).

## Cost and privacy

* One extra tagger (Claude) call for each decision whose confirm screen is opened and then abandoned. Decisions that are
  launched cost the same as before (the call just happens earlier). Edited decisions cost one extra (the pre-tag is wasted).
* The parked result contains the tagger's rationale text about the decision, like `sessions_ontology.raw_ontology_json`
  (also stored unencrypted). It is cleared when used; unused ones stay on the chat row like the chat's own state.
* The pre-tag route is rate-limited with the existing chat-intake limiter and needs only the chat id (same capability model
  as the other chat-intake routes). Passing someone else's chat id to the ontology route gains nothing: a result is used only
  for byte-identical tagger input.

## Files

Changed: app/api/{ontology,session}/route.ts, components/DecisionCheckpoint.tsx, lib/feature-flags.ts, env.example.
New: app/api/chat-intake/pretag/route.ts, lib/chat-intake-pretag.ts, lib/ontology-validate.ts (the tag validation, moved out
of the ontology route unchanged), supabase/sprint_intake_v13_pretag.sql, tests/pretag-v13.test.ts, tests/helpers/fake-supabase.ts,
this file.

## Verified

* `vitest`: 544 passing (515 + 29 new). `tsc`: no new errors. `next build`: compiles, lints, type-checks, route registered.
* New tests run the real routes against an in-memory database: pre-tag → session → ontology reuse with **no second model
  call** and the rule engine + structural match still running; edited decision misses; a different decision under someone
  else's chat id misses; invalid stored tag falls back; model failure marks the session failed exactly as before;
  feature OFF is byte-for-byte the old call (lean lines included); columns not migrated → harmless; no write or read of
  `sessions` / `sessions_ontology` by the pre-tag path; a clean launch hashes identically to the pre-tag run
  (checked against the real context builder); atomic claim, staleness, use-once, waiting for an in-flight run.
* Browser-style harness (not shipped), 40 scenarios incl. 5 new: pre-tag fired once when the flag is on, never when off,
  failing/hanging pre-tag cannot affect the launch, re-fired when returning from the chat, Convene asks the examiner once.

## Not verified

* Real latency saving and real Anthropic behaviour — I could not call the model. Measure with the log line above.
* Applying the SQL to your Supabase project (additive `add column if not exists`; standard).
