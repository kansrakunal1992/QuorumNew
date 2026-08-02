-- supabase/add_context_ingestion_v2.sql
-- ── Context Ingestion — v2 schema additions ──────────────────────────────────
--
-- Two enum extensions only — v2's other features (async pipeline, semantic
-- retrieval, freshness nudges, reanalyze diff view, KPI dashboard) all reuse
-- columns already created in add_context_ingestion.sql. Run after that
-- migration (and after add_context_ingestion_kpi.sql).
--
--   'discarded' (context_ingestion.status) — user rejected every proposed
--   fact on the review screen before saving anything ("Reject all & start
--   over"). Distinct from 'failed' (something broke) and 'forgotten' (facts
--   existed and were then removed) so the status accurately describes what
--   happened. Bypasses the 30-day reimport cooldown, same as 'failed'.
--
--   'file_upload' (context_ingestion.source_type, user_memory_facts.source)
--   — covers .md/.html/.docx/generic-JSON uploads that aren't confidently a
--   native ChatGPT or Claude export shape. Provenance only; extraction
--   quality doesn't depend on this label.
-- ─────────────────────────────────────────────────────────────────────────────

alter table context_ingestion drop constraint if exists context_ingestion_status_check;
alter table context_ingestion add constraint context_ingestion_status_check
  check (status in ('uploaded','analyzing','insights_extracted','review_pending',
                     'saved','discarded','failed','forgotten'));

alter table context_ingestion drop constraint if exists context_ingestion_source_type_check;
alter table context_ingestion add constraint context_ingestion_source_type_check
  check (source_type in ('chatgpt','claude','file_upload','manual','pasted_summary'));

alter table user_memory_facts drop constraint if exists user_memory_facts_source_check;
alter table user_memory_facts add constraint user_memory_facts_source_check
  check (source in ('chatgpt','claude','file_upload','manual','pasted_summary'));
