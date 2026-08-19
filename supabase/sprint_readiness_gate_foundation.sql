-- ─────────────────────────────────────────────────────────────────
-- QUORUM — Readiness Gate Foundation (PR1)
--
-- Decision-architecture review (Nancy/Seejo feedback, code audit):
-- today, `sessions_ontology.examiner_status = 'submitted'` is written
-- identically whether the user actually answered the Examiner's
-- questions or hit Skip — the database has no way to tell "resolved"
-- from "waved off". That makes any real readiness gate (PR3/PR4)
-- impossible to build on top of the current schema.
--
-- This migration is additive-only and changes no behavior by itself
-- (see PR2/PR3/PR4 for the code that starts reading/writing these
-- columns). Safe to run ahead of a deploy.
--
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ─────────────────────────────────────────────────────────────────

-- 1. Per-question resolution + importance tier on examiner_responses.
--    criticality is populated at question-generation time in
--    app/api/examiner/route.ts, sourced from which rule (if any)
--    produced the question — R2/R3 → 'critical', R10/S0/C0/E0/L0 →
--    'important', v1.0 gap-fallback questions → 'optional'.
--    resolution_state is computed at submit time: 'answered' when
--    response_text is non-empty after trim, 'skipped' otherwise.
--    Both columns are nullable so existing rows (written before this
--    migration) don't need a backfill to stay valid.
alter table examiner_responses
  add column if not exists resolution_state text
    check (resolution_state in ('answered', 'skipped')),
  add column if not exists criticality text
    check (criticality in ('critical', 'important', 'optional'));

comment on column examiner_responses.resolution_state is
  'Whether the user actually answered this question or left it blank/skipped. NULL = row predates this migration.';
comment on column examiner_responses.criticality is
  'critical = readiness gate can block synthesis on this being unresolved (PR4). important = carried forward into synthesis as an open condition, never blocks. optional = enrichment only.';

-- 2. New optional "local & regulatory context" field (PR2) — separate
--    from the 3-question Examiner budget on purpose (see app/api/examiner/route.ts
--    doc comment on the fixed E0/S0-or-rule/C0 slot budget — this does
--    not compete for those slots). One row per session.
--
--    retrieved_summary / retrieved_citations are populated by the
--    background web-lookup call (lib/web-context-lookup.ts) — best
--    effort, fire-and-forget, may remain 'skipped'/'failed' forever
--    if the user left the field blank or the lookup errored.
create table if not exists examiner_local_context (
  id                   uuid primary key default uuid_generate_v4(),
  session_id           uuid references sessions on delete cascade not null unique,
  user_stated_text     text,        -- encrypted; what the user typed, if anything
  lookup_status        text not null default 'not_requested'
    check (lookup_status in ('not_requested', 'pending', 'complete', 'failed')),
  retrieved_summary    text,        -- encrypted; model's synthesized findings
  retrieved_citations  jsonb,       -- [{ "url": "...", "title": "..." }, ...] — not encrypted, URLs only
  created_at           timestamptz default now() not null,
  updated_at           timestamptz default now() not null
);

comment on table examiner_local_context is
  'Optional per-session field for local/regulatory/market/geopolitical context the ontology tagger cannot infer. user_stated_text is what the user typed; retrieved_summary + retrieved_citations are best-effort output of a web-search-enabled model call (see lib/web-context-lookup.ts). Provenance is always visible to the reader as "web-retrieved, verify independently" — never presented as a verified fact.';

create index if not exists idx_examiner_local_context_session on examiner_local_context(session_id);
