-- ─────────────────────────────────────────────────────────────────────────────
-- QUORUM — Sprint 5 (S5-04): Add user_id to bias_library
-- Run in: Supabase Dashboard → SQL Editor → New Query
--
-- WHY: bias_library currently uses user_email as its only identity key.
-- This means:
--   1. RLS can only scope rows via email, not UUID — less reliable
--   2. Rows created before auth (email-only) are permanently email-scoped
--   3. Sprint 4's RLS policy (S4-01) uses auth.jwt() ->> 'email' which works
--      but is weaker than a direct FK to auth.users
--
-- This migration adds user_id uuid FK so future writes stamp both email + UUID.
-- The bias-score route will be updated to write user_id alongside user_email.
-- Existing rows keep their user_email and get user_id = NULL (backfilled later).
--
-- SAFE TO RUN REPEATEDLY: uses IF NOT EXISTS / DO NOTHING patterns.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add nullable user_id column (FK to auth.users, cascade on delete)
alter table bias_library
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- 2. Index for efficient per-user queries
create index if not exists idx_bias_library_user_id
  on bias_library(user_id)
  where user_id is not null;

-- 3. Update the unique constraint to also cover (user_id, bias_parameter)
--    so authenticated users with the same email on multiple accounts don't collide.
--    Add a partial unique index on (user_id, bias_parameter) for non-null user_ids.
create unique index if not exists idx_bias_library_user_id_param
  on bias_library(user_id, bias_parameter)
  where user_id is not null;

-- 4. Drop old using(true) policy and add updated user-scoped policy
--    (replaces the S4-01 email-only policy with a combined email OR uuid check)
drop policy if exists "Users can access their own bias library" on bias_library;

create policy "Users can access their own bias library"
  on bias_library for all
  using (
    user_id = auth.uid()
    or user_email = (auth.jwt() ->> 'email')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION QUERIES
-- ─────────────────────────────────────────────────────────────────────────────
-- -- Confirm column added:
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_name = 'bias_library' and column_name = 'user_id';
--
-- -- Confirm new RLS policy:
-- select policyname, qual from pg_policies
-- where tablename = 'bias_library';
-- ─────────────────────────────────────────────────────────────────────────────
