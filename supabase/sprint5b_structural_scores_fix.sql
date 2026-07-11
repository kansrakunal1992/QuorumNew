-- ─────────────────────────────────────────────────────────────────
-- QUORUM — Sprint 5b: Structural Scores Table Fix
-- Run ONCE in Supabase SQL Editor BEFORE re-testing.
-- Safe to re-run (all statements use IF NOT EXISTS / IF EXISTS).
--
-- Fixes:
--   1. Creates structural_scores table with correct unique constraint
--      required for upsert onConflict: 'session_id_a,session_id_b'
--   2. Ensures structural_matches has user_id column (may be missing
--      if sprint5 ran before sprint6 added user_id infra)
-- ─────────────────────────────────────────────────────────────────

-- ── structural_scores ────────────────────────────────────────────
-- One row per (session_a, session_b) pair.
-- Written by /api/structural-match for every past session scored.
-- Gives full traceability of why matches were or were not selected.

create table if not exists structural_scores (
  id                   uuid primary key default uuid_generate_v4(),
  session_id_a         uuid not null references sessions on delete cascade,
  session_id_b         uuid not null references sessions on delete cascade,
  total_score          int not null,
  decision_type_score  int,
  register_score       int,
  stakes_score         int,
  counterparty_score   int,
  time_pressure_score  int,
  threshold_met        boolean default false,
  computed_at          timestamptz default now(),

  -- CRITICAL: this unique constraint is required for upsert onConflict to work
  constraint structural_scores_pair_unique unique (session_id_a, session_id_b)
);

create index if not exists idx_structural_scores_session_a on structural_scores(session_id_a);
create index if not exists idx_structural_scores_session_b on structural_scores(session_id_b);

alter table structural_scores enable row level security;

-- Drop and recreate to avoid "already exists" errors
drop policy if exists "Structural scores accessible via service role" on structural_scores;
create policy "Structural scores accessible via service role"
  on structural_scores for all using (true);

-- ── structural_matches: backfill user_id column if missing ───────
-- sprint5 may have created this table before sprint6 added user_id infra.
alter table structural_matches add column if not exists user_id uuid references auth.users on delete set null;
create index if not exists idx_structural_matches_user_id on structural_matches(user_id);

-- ── Confirm ──────────────────────────────────────────────────────
-- After running this, verify with:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'structural_scores';
-- You should see: id, session_id_a, session_id_b, total_score,
--   decision_type_score, register_score, stakes_score,
--   counterparty_score, time_pressure_score, threshold_met, computed_at
