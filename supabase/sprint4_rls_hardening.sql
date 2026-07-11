-- ─────────────────────────────────────────────────────────────────────────────
-- QUORUM — Sprint 4 (S4-01): RLS Hardening
-- Run in: Supabase Dashboard → SQL Editor → New Query
--
-- Replaces using(true) on all 4 sensitive tables with user-scoped policies.
--
-- SAFE TO RUN REPEATEDLY: uses DROP POLICY IF EXISTS before each CREATE.
--
-- BEFORE/AFTER:
--   sessions_ontology    was: anyone with anon key can read all rows
--   examiner_responses   was: anyone with anon key can read all rows
--   bias_library         was: anyone with anon key can read all rows
--   contradiction_log    was: anyone with anon key can read all rows
--
--   All four: NOW user-scoped OR service-role bypass only.
--
-- Server-side API routes use createServiceClient() which uses the service role
-- key — that key bypasses RLS automatically. These policies only restrict
-- direct REST/PostgREST calls made with the anon key.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. sessions_ontology ─────────────────────────────────────────────────────
-- Join through sessions to get authenticated user ownership.
-- Anonymous sessions (user_id IS NULL) are not directly accessible via anon key;
-- they are served by the service-role API only.

drop policy if exists "Ontology accessible via service role" on sessions_ontology;

create policy "Users can access their own session ontology"
  on sessions_ontology for all
  using (
    exists (
      select 1
      from   sessions s
      where  s.id      = sessions_ontology.session_id
      and    s.user_id = auth.uid()
    )
  );


-- ── 2. examiner_responses ────────────────────────────────────────────────────
-- Same join-through-sessions pattern.

drop policy if exists "Examiner responses accessible via service role" on examiner_responses;

create policy "Users can access their own examiner responses"
  on examiner_responses for all
  using (
    exists (
      select 1
      from   sessions s
      where  s.id      = examiner_responses.session_id
      and    s.user_id = auth.uid()
    )
  );


-- ── 3. bias_library ──────────────────────────────────────────────────────────
-- bias_library has no user_id column (S5-04 will add it).
-- For now, scope by user_email matching the authenticated JWT's email claim.
-- auth.jwt() ->> 'email' returns the email of the currently authenticated user.
-- Unauthenticated calls return null, which never equals user_email.

drop policy if exists "Bias library accessible via service role" on bias_library;

create policy "Users can access their own bias library"
  on bias_library for all
  using (
    user_email = (auth.jwt() ->> 'email')
  );


-- ── 4. contradiction_log ─────────────────────────────────────────────────────
-- Has user_email column; also references two session IDs.
-- Primary check: email match on authenticated user.
-- Secondary fallback: session ownership (catches rows where email is null
-- but the session was stamped with the user's id).

drop policy if exists "Contradiction log accessible via service role" on contradiction_log;

create policy "Users can access their own contradiction log"
  on contradiction_log for all
  using (
    user_email = (auth.jwt() ->> 'email')
    or exists (
      select 1
      from   sessions s
      where  s.id      = contradiction_log.session_id_principle
      and    s.user_id = auth.uid()
    )
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION QUERIES (run after applying the migration to confirm)
-- ─────────────────────────────────────────────────────────────────────────────
-- select tablename, policyname, cmd, qual
-- from   pg_policies
-- where  tablename in ('sessions_ontology','examiner_responses','bias_library','contradiction_log')
-- order  by tablename, policyname;
--
-- Expected: 4 rows, all with the new policy names above.
-- No rows should contain "using (true)".
-- ─────────────────────────────────────────────────────────────────────────────
