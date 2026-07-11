-- ─────────────────────────────────────────────────────────────────────────────
-- QUORUM — Sprint 6b: Cross-Browser Session Identity Recovery
-- Run AFTER sprint6_auth.sql
--
-- Problem: When a user clicks their magic link in a different browser
-- (email client, mobile WebView) than where they ran decisions, localStorage
-- is empty in that browser. The old link-sessions only accepted explicit
-- session IDs from localStorage — so cross-browser auth left all prior
-- anonymous sessions orphaned (user_id = NULL, user_email = NULL).
--
-- Fix: Three-layer sweep in link-sessions route:
--   1. Explicit session IDs (unchanged)
--   2. device_id sweep on sessions table  ← NEW
--   3. user_email sweep on sessions table ← NEW
--
-- This migration adds indexes to make those sweeps fast and provides:
--   a) The `link_sessions_by_device` helper function (called by route)
--   b) A `repair_orphaned_sessions` admin function for one-off fixes
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Indexes for the new sweep queries ────────────────────────────────────────
-- These make device_id and user_email sweeps fast even at 1000s of sessions.
create index if not exists idx_sessions_device_id  on sessions(device_id);
create index if not exists idx_sessions_user_email on sessions(user_email);

-- ── Sessions table: ensure device_id and user_email columns exist ─────────────
-- These were added in earlier sprints but included here as a safety guard.
alter table sessions
  add column if not exists device_id  text,
  add column if not exists user_email text;

-- ── link_sessions_by_device ───────────────────────────────────────────────────
-- Called server-side (service role) from link-sessions route when deviceIds array
-- is provided. Updates all sessions on a given device to the authenticated user.
-- Returns the count of sessions updated.
create or replace function link_sessions_by_device(
  p_device_id   text,
  p_user_id     uuid,
  p_user_email  text default null
) returns integer
language plpgsql
security definer
as $$
declare
  v_count integer;
begin
  update sessions
  set
    user_id    = p_user_id,
    user_email = coalesce(p_user_email, user_email)
  where
    device_id = p_device_id
    and user_id is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── link_sessions_by_email ────────────────────────────────────────────────────
-- Catches sessions where user had typed their email before auth but hadn't yet
-- clicked the magic link (user_email set, user_id null).
create or replace function link_sessions_by_email(
  p_user_email  text,
  p_user_id     uuid
) returns integer
language plpgsql
security definer
as $$
declare
  v_count integer;
begin
  update sessions
  set user_id = p_user_id
  where
    user_email = p_user_email
    and user_id is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── repair_orphaned_sessions ──────────────────────────────────────────────────
-- Admin utility: links all sessions on a device to a known user.
-- Use in Supabase SQL editor to manually fix sessions orphaned before Sprint 6b.
-- Example:
--   select repair_orphaned_sessions(
--     'dev_6b8ced36-556b-433f-9ad6-81a1dc7baaf2',  -- device_id from sessions table
--     'ccb67bac-e16a-...',                           -- user_id from auth.users
--     'kansrakunal@gmail.com'                        -- user email
--   );
create or replace function repair_orphaned_sessions(
  p_device_id   text,
  p_user_id     uuid,
  p_user_email  text default null
) returns text
language plpgsql
security definer
as $$
declare
  v_session_count integer;
  v_bias_count    integer;
begin
  -- Link sessions
  update sessions
  set
    user_id    = p_user_id,
    user_email = coalesce(p_user_email, user_email)
  where
    device_id = p_device_id
    and user_id is null;
  get diagnostics v_session_count = row_count;

  -- Retro-link bias rows
  update bias_library
  set
    user_id    = p_user_id,
    user_email = coalesce(p_user_email, user_email)
  where
    device_id = p_device_id
    and user_id is null;
  get diagnostics v_bias_count = row_count;

  return format('Linked %s sessions and %s bias rows for device %s → user %s',
    v_session_count, v_bias_count, p_device_id, p_user_id);
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- ONE-OFF REPAIR: Link the 10 orphaned sessions on dev_6b8ced36 to kansrakunal
-- Run this ONCE manually in Supabase SQL editor after deploying Sprint 6b.
-- Replace the user_id with the actual UUID from Supabase → Authentication → Users.
-- ─────────────────────────────────────────────────────────────────────────────
-- select repair_orphaned_sessions(
--   'dev_6b8ced36-556b-433f-9ad6-81a1dc7baaf2',
--   'ccb67bac-XXXX-XXXX-XXXX-XXXXXXXXXXXX',   -- ← paste your real user_id
--   'kansrakunal@gmail.com'
-- );
