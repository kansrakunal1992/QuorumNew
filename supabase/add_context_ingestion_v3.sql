-- supabase/add_context_ingestion_v3.sql
-- ── Context Ingestion — opt-in specific details ──────────────────────────────
--
-- v1/v2 extraction is abstraction-only by design (see lib/context-extractor.ts's
-- EXTRACTION_SYSTEM): no names, dates, employers, dollar figures. That keeps
-- Foundational Context durable and safe to inject verbatim-adjacent, but it
-- also means the Council never sees the concrete specifics (a named employer,
-- a family milestone, an actual financial target) that make one particular
-- decision's context sharp instead of generic.
--
-- This migration adds an explicit, per-import, off-by-default opt-in: when
-- set, the SAME extraction pass is allowed to retain concrete specifics on a
-- per-fact basis (the model still chooses which facts warrant it — most
-- won't). Two columns:
--
--   context_ingestion.allow_specific_details — the consent choice the user
--   made for their most recent import. Asked again on every fresh import
--   (see ASYNC note in app/api/context-ingestion/route.ts) — deliberately
--   NOT sticky, so specificity is never granted by default or by inertia.
--
--   user_memory_facts.is_specific — per-fact, set at insertion time from the
--   model's own output (parseCandidates forces this false whenever consent
--   wasn't granted for that import, regardless of what the model returns —
--   defense in depth). Drives two downstream behaviors:
--     1. lib/foundational-context.ts injects specific facts in a separate,
--        differently-instructed block (direct reference allowed, unlike the
--        "don't quote verbatim" rule for abstracted facts).
--     2. app/api/context-ingestion/route.ts's freshness check uses a shorter
--        window for specific facts (SPECIFIC_FRESHNESS_DAYS) — a named
--        employer or a live financial target goes stale far faster than a
--        durable value or decision pattern.
-- ─────────────────────────────────────────────────────────────────────────────

alter table context_ingestion
  add column if not exists allow_specific_details boolean not null default false;

alter table user_memory_facts
  add column if not exists is_specific boolean not null default false;

comment on column context_ingestion.allow_specific_details is
  'Consent choice for the most recent import: whether extraction was allowed to retain concrete specifics (names, dates, employers, amounts) on a per-fact basis. Re-asked every import — not a sticky account-level setting.';

comment on column user_memory_facts.is_specific is
  'Set at extraction time. True only when the enclosing import had allow_specific_details=true AND the model judged this particular fact to warrant a concrete detail. Changes injection wording and freshness window — see lib/foundational-context.ts and app/api/context-ingestion/route.ts.';
