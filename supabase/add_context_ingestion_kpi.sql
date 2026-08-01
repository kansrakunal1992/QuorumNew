-- supabase/add_context_ingestion_kpi.sql
-- ── Context Ingestion — KPI column ───────────────────────────────────────────
--
-- Cheap by design: sessions.register_mode ('analytical'|'clarification') and
-- pre_decision_confidence / post_decision_confidence already exist. Adding
-- this one boolean lets the cold-start-reduction KPI run as a single
-- group-by against data already being captured — no new event-logging
-- infrastructure needed.
--
--   select had_context_ingestion,
--          avg((register_mode = 'clarification')::int) as clarification_rate,
--          avg(post_decision_confidence)                as avg_confidence
--   from sessions
--   group by had_context_ingestion;
-- ─────────────────────────────────────────────────────────────────────────────

alter table sessions
  add column if not exists had_context_ingestion boolean not null default false;

comment on column sessions.had_context_ingestion is
  'Set at session-creation time when the user has at least one accepted/edited user_memory_facts row. Used to compare clarification-question rate and Council confidence against cold-start users.';
