-- ─────────────────────────────────────────────────────────────────
-- QUORUM LEDGER — Sprint 4b: Anonymous Device Identity
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- Depends on: schema.sql, sprint1_add_ledger_tables.sql (bias_library)
-- ─────────────────────────────────────────────────────────────────
--
-- Adds device_id to sessions and bias_library.
-- device_id is a client-generated UUID stored in localStorage.
-- It acts as a third-tier identity key for bias accumulation:
--   user_id (post-auth) > user_email (pre-auth) > device_id (anonymous)
--
-- No unique constraint is added for device_id on bias_library because:
--   1. device_id is ephemeral (localStorage) — not a reliable uniqueness axis
--   2. The application layer already enforces one-row-per-(identity, bias)
--      via the explicit lookup-before-insert pattern in bias-score/route.ts
-- ─────────────────────────────────────────────────────────────────

-- Add device_id to sessions table
alter table sessions
  add column if not exists device_id text;

create index if not exists idx_sessions_device_id
  on sessions(device_id)
  where device_id is not null;

-- Add device_id to bias_library table
alter table bias_library
  add column if not exists device_id text;

-- Also add user_id to bias_library if Sprint 6 auth SQL hasn't been run yet.
-- This is a no-op if the column already exists.
alter table bias_library
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_bias_library_device_id
  on bias_library(device_id)
  where device_id is not null;

create index if not exists idx_bias_library_user_id
  on bias_library(user_id)
  where user_id is not null;

-- Comment on identity tier design for future reference
comment on column bias_library.device_id is
  'Anonymous device identity. Third-tier fallback behind user_id and user_email. '
  'Device-local; accumulation is scoped to one browser/device. '
  'Not shown to users as "memory" until they add an email (MemoryEngineStatus guard).';

comment on column sessions.device_id is
  'Anonymous device identity passed from localStorage on session creation. '
  'Allows bias accumulation for users who have not entered an email.';
