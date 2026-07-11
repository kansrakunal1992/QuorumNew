-- supabase/sprint_ret5_cascade_cleanup.sql
-- ── Sprint RET-5: deleted-session "ghost memory" fix ──────────────────────────
--
-- Problem: DELETE /api/record deletes a session row and relies on
-- ON DELETE CASCADE foreign keys for cleanup. That cascade only ever covered
-- messages, examiner_responses, sessions_ontology, outcomes, structural_scores
-- — three derived/cross-session tables were never given the same treatment,
-- because their session_id columns were never declared as real foreign keys:
--   - contradictions          (principle_session_id, violation_session_id)
--   - independence_score_log  (session_id)
--   - structural_matches      (session_id)
--
-- Net effect: deleting a decision removed its raw content, but contradiction
-- findings, independence score snapshots, and structural-match caches derived
-- from it kept showing up indefinitely.
--
-- bias_library is NOT touched here — its session_ids column is a uuid[]
-- array, which Postgres cannot attach a foreign key to. That cleanup is
-- handled at the application layer instead (see cleanupBiasLibraryForSession
-- in app/api/record/route.ts).
--
-- Run this once in the Supabase SQL Editor.
-- ────────────────────────────────────────────────────────────────────────────

begin;

-- ── 1. One-time cleanup of rows already orphaned by past deletions ──────────
-- Required before the FK constraints below can be added — ADD CONSTRAINT
-- fails outright if any existing row would violate it. NULL columns are left
-- alone (NULL is a valid "no reference yet" state, not an orphan).

delete from contradictions c
where (c.principle_session_id is not null
       and not exists (select 1 from sessions s where s.id = c.principle_session_id))
   or (c.violation_session_id is not null
       and not exists (select 1 from sessions s where s.id = c.violation_session_id));

delete from independence_score_log isl
where isl.session_id is not null
  and not exists (select 1 from sessions s where s.id = isl.session_id);

delete from structural_matches sm
where sm.session_id is not null
  and not exists (select 1 from sessions s where s.id = sm.session_id);

-- ── 2. Add real FK constraints with ON DELETE CASCADE ────────────────────────
-- drop-if-exists first so this is safe to re-run.

alter table contradictions
  drop constraint if exists contradictions_principle_session_id_fkey;
alter table contradictions
  add constraint contradictions_principle_session_id_fkey
  foreign key (principle_session_id) references sessions(id) on delete cascade;

alter table contradictions
  drop constraint if exists contradictions_violation_session_id_fkey;
alter table contradictions
  add constraint contradictions_violation_session_id_fkey
  foreign key (violation_session_id) references sessions(id) on delete cascade;

alter table independence_score_log
  drop constraint if exists independence_score_log_session_id_fkey;
alter table independence_score_log
  add constraint independence_score_log_session_id_fkey
  foreign key (session_id) references sessions(id) on delete cascade;

alter table structural_matches
  drop constraint if exists structural_matches_session_id_fkey;
alter table structural_matches
  add constraint structural_matches_session_id_fkey
  foreign key (session_id) references sessions(id) on delete cascade;

commit;

-- ── Verify after running ──────────────────────────────────────────────────────
-- select conname, conrelid::regclass, confrelid::regclass, confdeltype
-- from pg_constraint
-- where conname in (
--   'contradictions_principle_session_id_fkey',
--   'contradictions_violation_session_id_fkey',
--   'independence_score_log_session_id_fkey',
--   'structural_matches_session_id_fkey'
-- );
-- confdeltype should be 'c' (cascade) for all four rows.
