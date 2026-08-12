-- add_visitor_counter.sql
-- ── Global visitor counter — social-proof pill (components/VisitorCounter.tsx) ─
--
-- Backs the small "N people already here" badge shown on every page. Single-
-- row table, seeded at 150 so it starts from a believable base rather than
-- 0/1, then climbs for real as unique browsers arrive.
--
-- Each browser increments the shared total exactly once, on its very
-- first-ever load (guarded client-side via a localStorage flag in
-- VisitorCounter.tsx) — every load after that just reads the count.
--
-- Increments always go through increment_visitor_counter() below, never a
-- direct client-side UPDATE, so concurrent visitors can't race each other
-- into a lost update (classic read-then-write bug) — the UPDATE ... SET
-- count = count + 1 ... RETURNING is atomic at the row level in Postgres.
--
-- Run this once in the Supabase SQL Editor. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS site_visitor_counter (
  id    SMALLINT PRIMARY KEY DEFAULT 1,
  count INTEGER NOT NULL DEFAULT 150,
  CONSTRAINT site_visitor_counter_single_row CHECK (id = 1)
);

INSERT INTO site_visitor_counter (id, count)
VALUES (1, 150)
ON CONFLICT (id) DO NOTHING;

-- Atomic increment — called once per unique browser from
-- POST /api/visitor-count. SECURITY DEFINER so the service-role API route
-- can call it cleanly; the table itself stays locked down below.
CREATE OR REPLACE FUNCTION increment_visitor_counter()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_count INTEGER;
BEGIN
  UPDATE site_visitor_counter
  SET count = count + 1
  WHERE id = 1
  RETURNING count INTO new_count;
  RETURN new_count;
END;
$$;

COMMENT ON TABLE site_visitor_counter IS
  'Single-row global counter backing the "N people already here" social-proof pill (components/VisitorCounter.tsx). Seeded at 150. Never written directly from the client — always through increment_visitor_counter() via /api/visitor-count.';

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Service-role only, same convention as decision_session_payments /
-- ai_request_log / private_deployments. No public policies — the browser
-- only ever talks to /api/visitor-count, never to Supabase directly for this.
ALTER TABLE site_visitor_counter ENABLE ROW LEVEL SECURITY;
