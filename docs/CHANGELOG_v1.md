# Natural Intake — v1 (Phase 0 + Phase 1, first drop)

Everything in this zip is **inert until you flip the flag**. Nothing here
touches the classic form, HomeClient.tsx, or SessionView.tsx.

## Setup (do this before testing)
1. **Run the migration:** `supabase/sprint_natural_intake_v1.sql` — additive
   only, safe to run against production directly (no locking rewrite of any
   existing large table — every change is `add column if not exists` or a
   new table).
2. **Add env vars in Railway**, all default OFF:
   - `NEXT_PUBLIC_NATURAL_INTAKE_ENABLED` — the master switch. Set to `true`
     on a staging/preview environment first.
   - `NEXT_PUBLIC_SLACK_CONNECTOR_ENABLED`, `NEXT_PUBLIC_GMAIL_CONNECTOR_ENABLED`,
     `NEXT_PUBLIC_OUTLOOK_CONNECTOR_ENABLED`, `NEXT_PUBLIC_WHATSAPP_SHARE_ENABLED`
     — leave unset for now; nothing in this drop reads them yet (Phases 2–4).
3. **Redeploy** — `NEXT_PUBLIC_` vars are baked in at build time.

## What's actually in this drop

**New tables:** `chat_intakes`, `chat_intake_messages` (both RLS-locked to
service-role, same pattern as every other table this codebase already uses).

**New columns (all nullable/defaulted):** `sessions.intake_mode`,
`sessions.chat_intake_id`, `sessions.session_depth`,
`examiner_responses.derived_from_chat`.

**New screens:** the chat (`components/ChatIntake.tsx`), the checkpoint
(`components/DecisionCheckpoint.tsx`), wired together by
`app/NaturalIntakeClient.tsx`, swapped in by a 6-line addition to
`app/page.tsx`. HomeClient.tsx is untouched.

**New backend:** `app/api/chat-intake/route.ts` (turn-by-turn chat + the
running decision-state extraction, `lib/chat-intake-state.ts`),
`app/api/chat-intake/checkpoint/route.ts` (creates the real session through
the **existing, unmodified** session-creation pipeline),
`app/api/chat-intake/done/route.ts` (the light-path exit + optional
commitment capture).

**The Examiner-fidelity fix (plan section 8):** `lib/examiner-derive.ts` is
new; `app/api/examiner/route.ts` gained ~25 lines wiring it in, gated so it
only ever runs for `intake_mode === 'chat'` sessions. A classic-flow
session's Examiner behaviour is byte-for-byte unchanged. Per your call,
derived-and-confirmed answers count identically to typed ones everywhere —
no exclusion logic anywhere, which is why `lib/independence-score.ts` isn't
in this diff at all.

**The Mirror fix (6 of the 9 real touchpoints found):** see
`docs/MIRROR_TOUCHPOINTS_v1.md` for the full list and the 2 explicitly
deferred ones, with reasons.

**Small supporting edits:** `lib/feature-flags.ts` (5 new flags),
`lib/types.ts` (additive types + 3 new optional `Session` fields),
`lib/rate-limit.ts` (one new limit config), `app/api/session/route.ts`
(accepts 2 new optional fields, both ignored by every existing caller),
`lib/encryption.ts` (one line — a documentation-only addition to the
encrypted-columns comment, no functional change).

## Deliberately scoped OUT of v1 (so you know it's a choice, not an oversight)

- **Structural Read visualization on the checkpoint screen.** The checkpoint
  screen shows the reflection and the Examiner's derive-and-confirm flow,
  but not a rendered version of the 14-dimension structural read itself —
  building that well means either reading `lib/quorum-read.ts` and whatever
  renders it in `SessionView.tsx` closely enough to reuse it safely, or
  building a second renderer, and I'd rather scope that properly next than
  guess at a remembered response shape now. The data is being generated
  correctly (same ontology tagger, unchanged) — it's just not surfaced on
  this particular screen yet.
- **"Keep thinking" as a third post-checkpoint exit button.** v1 offers
  "Let me add more" *before* a session is created (cheap — no AI structural
  pass spent yet) and just two exits *after* one exists: Convene the Council
  or I'm done. Adding a true post-session "keep talking, then re-run the
  structural read on the same session" is a well-defined but separate piece
  of work (updating an existing session's decision_text/context_text and
  re-firing the ontology tagger in place) — small, but worth its own pass
  rather than folding in now.
- **The "two decisions tangled together" split UI.** The chat can *notice*
  and *say* this (it's one of the five follow-up priorities in
  `lib/chat-intake-reply.ts`), but there's no structured "treat separately
  or together?" action yet — it's just conversation for now.
- **`session_depth = 'council'`** is never actually set by any code in this
  drop (only `'checkpoint'` is). Harmless — nothing reads `session_depth` yet
  (see `docs/MIRROR_TOUCHPOINTS_v1.md`) — but worth closing before the
  deferred Mirror fast-follow ships.
- **Real token streaming.** `ChatIntake.tsx`'s "typewriter" effect is a
  client-side reveal of an already-complete response, not true incremental
  streaming from the model. Visually close enough for v1; a real streaming
  endpoint is a backend change, not just a UI one.
- **Slack / Gmail / Outlook / WhatsApp** — Phase 2 onward, per the locked
  phase plan. Sub-flags are defined and wired for the future check, but no
  connector code exists in this drop.

## A note on verification
This container has no network access, so nothing here has been run through
`npm install` / `next build` / `tsc`. Every new and edited file was checked
by hand for brace/paren balance and against the actual current file
contents (edits were applied as surgical patches to your real files, not
retyped from memory), but a real `next build` on your end before deploying
is the actual verification step — treat this as reviewed-by-hand, not
compiler-verified.

## Version
This is **v1**. Any further zip in this thread will be **v2**, and so on —
filenames will never repeat.
