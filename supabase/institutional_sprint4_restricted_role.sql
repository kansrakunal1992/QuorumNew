-- ─────────────────────────────────────────────────────────────────
-- QUORUM INSTITUTIONAL LAYER — Sprint 4 task 7: restricted aggregate-reader role
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- Run AFTER supabase/institutional_sprint4_aggregate_views.sql
--
-- Why: today, every institutional route (Sprints 1-4) uses the same
-- service_role key — full table access, RLS bypass, everything. A bug in
-- any one aggregate-serving route could, in principle, be leveraged for
-- broader access, because the credential itself has no narrower scope.
-- This role can SELECT from the three benchmark views only — nothing else,
-- not even the raw tables those views are built from.
-- ─────────────────────────────────────────────────────────────────

create role aggregate_reader nologin;

grant usage on schema public to aggregate_reader;

grant select on institutional_platform_benchmark_segments to aggregate_reader;
grant select on institutional_benchmark_segments           to aggregate_reader;
grant select on institutional_rollup_benchmark_segments     to aggregate_reader;

-- Explicit, not just an absence: confirms this role has nothing beyond the
-- three views above, even if some future migration grants schema-wide
-- SELECT to a broader role this one might inherit from by accident.
revoke all on institutions              from aggregate_reader;
revoke all on institution_memberships   from aggregate_reader;
revoke all on cohorts                   from aggregate_reader;
revoke all on cohort_memberships        from aggregate_reader;
revoke all on consent_audit_log         from aggregate_reader;
revoke all on sessions                  from aggregate_reader;
revoke all on outcomes                  from aggregate_reader;
revoke all on sessions_ontology         from aggregate_reader;

-- ── How to actually use this role — read before assuming it's wired in ──
--
-- Creating the role is only half of task 7. Supabase's standard client
-- pattern (createServiceClient() in lib/supabase.ts, used by every route
-- so far) authenticates via the service_role JWT, which always connects as
-- `service_role` regardless of what Postgres roles exist — a Postgres
-- `create role` alone does not give you a new Supabase API key to use from
-- Next.js. Actually routing the aggregate-serving path through this
-- narrower role needs ONE of:
--
--   (a) Supabase's Custom Roles / Postgres Roles dashboard feature
--       (Database → Roles), which can mint a JWT-based API key scoped to a
--       specific Postgres role — the closest match to how service_role/anon
--       already work, if your Supabase plan supports it.
--   (b) A direct Postgres connection (not through PostgREST/supabase-js)
--       for just the aggregate-serving routes, using a connection string
--       authenticated as aggregate_reader, via `pg` or a similar client.
--   (c) A SECURITY DEFINER Postgres function wrapping each view, owned by
--       a role with exactly this same restricted grant set, called via
--       supabase.rpc() — keeps the existing supabase-js client pattern,
--       at the cost of one more layer to maintain per view.
--
-- None of these is a pure-SQL decision — each has real tradeoffs for this
-- specific app's deploy setup (Railway + Supabase), and picking one is a
-- Sprint 5 task (that's when the aggregate-serving routes that would
-- actually use this role get built — Sprint 4 is explicitly scoped to "no
-- UI rendering of any of this"). This file gets the DB-side role and
-- grants in place now so that decision isn't blocked on a migration later.
