-- sprint7c_independence_constraint.sql
-- ── Fix: Add unique constraint on independence_score_log.session_id ───────────
-- The Sprint 7a schema created an index but not a UNIQUE constraint.
-- The upsert in /api/mirror/independence POST requires a proper constraint.
--
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- Safe to run even if the constraint already exists (IF NOT EXISTS guard).

alter table independence_score_log
  drop constraint if exists independence_score_log_session_id_key;

alter table independence_score_log
  add constraint independence_score_log_session_id_key
  unique (session_id);

-- Verify:
-- select constraint_name, constraint_type
-- from information_schema.table_constraints
-- where table_name = 'independence_score_log';
-- Expected: independence_score_log_session_id_key | UNIQUE
