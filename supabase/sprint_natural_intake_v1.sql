-- Quorum — Natural Intake (Phase 0/1, v1)
-- Adds the chat-first intake path behind NEXT_PUBLIC_NATURAL_INTAKE_ENABLED.
--
-- Purely additive: no existing column is renamed, retyped, or dropped, and
-- no existing check constraint is altered. Every new column on `sessions`
-- and `examiner_responses` is nullable or defaulted, so the classic flow
-- (flag off) writes and reads exactly as it does today — a session created
-- by the classic form never touches any column added here.

-- ── 1. Pre-session chat storage ──────────────────────────────────────────────
-- A chat_intake exists BEFORE a `sessions` row does — decision_text doesn't
-- exist yet while the user is still talking. Once the checkpoint fires, the
-- assembled decision_text/context_text goes through the EXISTING
-- POST /api/session exactly as the classic form does today, and the
-- resulting session is linked back here (chat_intakes.session_id). The
-- session row is the system of record from that point on; chat_intakes is
-- kept afterward only for the transcript and debugging/audit.

create table if not exists chat_intakes (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid references auth.users on delete cascade,
  user_email        text,
  device_id         text,
  status            text not null default 'active'
                      check (status in ('active', 'checkpointed', 'abandoned')),
  exchange_count    int not null default 0,
  -- Running notes state (lib/chat-intake-state.ts) — decision, options,
  -- lean, stakeholders, deadline, reversibility, assumptions, unknowns,
  -- evidence, source of each fact. Freeform JSON by design: this is the one
  -- place in the schema meant to change shape as the extractor improves
  -- without a migration each time.
  decision_state    jsonb,
  -- First-turn gut reaction (missing piece #1 in Kunal's natural-process
  -- note). Deliberately separate from sessions.initial_instinct
  -- (accept/reject/unsure) — that field belongs to the classic flow's
  -- 3-value UI and is untouched by this migration. This is the wider
  -- vocabulary: see DecisionOptionType in lib/types.ts.
  initial_reaction  text,
  session_id        uuid references sessions on delete set null,
  created_at        timestamptz not null default now(),
  last_turn_at      timestamptz not null default now()
);

create index if not exists idx_chat_intakes_user    on chat_intakes(user_id);
create index if not exists idx_chat_intakes_session on chat_intakes(session_id);

alter table chat_intakes enable row level security;
create policy "chat_intakes accessible via service role"
  on chat_intakes for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ── 2. Turn-by-turn transcript ───────────────────────────────────────────────
-- Encrypted at rest like `messages.content` (see lib/encryption.ts's column
-- list — its header comment should be updated alongside this migration to
-- add chat_intake_messages.content to the ENCRYPTED COLUMNS list).

create table if not exists chat_intake_messages (
  id              uuid primary key default uuid_generate_v4(),
  chat_intake_id  uuid references chat_intakes on delete cascade not null,
  role            text not null check (role in ('user', 'quorum')),
  content         text not null,   -- encrypted at rest, see lib/encryption.ts
  turn_order      int not null,
  created_at      timestamptz not null default now(),
  constraint chat_intake_messages_order unique (chat_intake_id, turn_order)
);

create index if not exists idx_chat_intake_messages_intake on chat_intake_messages(chat_intake_id);

alter table chat_intake_messages enable row level security;
create policy "chat_intake_messages accessible via service role"
  on chat_intake_messages for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ── 3. sessions: link back + provenance + depth ──────────────────────────────
-- All nullable / defaulted — a classic-flow session never sets any of these.

alter table sessions
  add column if not exists intake_mode text not null default 'classic'
    check (intake_mode in ('classic', 'chat')),
  add column if not exists chat_intake_id uuid references chat_intakes on delete set null,
  -- session_depth is NOT read by any v1 code path shipped in this drop — v1
  -- keys outcome-tracking off commitment_captured_at instead (see
  -- docs/MIRROR_TOUCHPOINTS_v1.md). Added now, and set correctly at the two
  -- v1 write points that naturally know it (checkpoint → 'checkpoint',
  -- Convene Council → 'council'), so the deferred fast-follow
  -- (avoidance-detector.ts, bias-trigger-engine.ts, calibration-engine.ts's
  -- dimensional buckets, cohort-insights.ts's cohort buckets — all of which
  -- want "did the structural read run" rather than "was a decision
  -- committed to") doesn't need a second migration when it ships.
  add column if not exists session_depth text
    check (session_depth is null or session_depth in ('checkpoint', 'council'));

create index if not exists idx_sessions_chat_intake on sessions(chat_intake_id);

-- ── 4. Widened decision-option vocabulary (missing piece #3) ─────────────────
-- act | dont_act | wait | gather_info | experiment — stored inside the
-- existing chat_intakes.decision_state JSON (per-option "type" field) rather
-- than as a new column. See DecisionOptionType in lib/types.ts. No schema
-- change needed for this piece beyond decision_state existing above.

-- ── 5. Examiner provenance (the Examiner-fidelity fix, plan section 8) ───────
-- Additive boolean — does NOT touch the existing resolution_state check
-- constraint ('answered' | 'skipped'), so every existing reader of that
-- column (lib/readiness.ts, and the bias/independence/contradiction
-- engines) needs zero changes. A derived-and-confirmed answer is still
-- saved with resolution_state = 'answered' — it really was answered, just
-- surfaced via the chat rather than asked directly — with this flag as the
-- audit trail of *how*, and counts identically everywhere resolution_state
-- = 'answered' is read today (Kunal's call: include it at full weight).

alter table examiner_responses
  add column if not exists derived_from_chat boolean not null default false;

comment on column examiner_responses.derived_from_chat is
  'true when this answer was extracted from the natural-intake chat and confirmed with one tap, rather than typed in response to the question directly. Counts identically to a directly-typed answer everywhere — bias scoring, independence score, contradiction detection — per product decision, Sept 2026.';
