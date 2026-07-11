-- Sprint 6: Auth — identity columns + link_sessions_to_user RPC
-- Run this in Supabase SQL Editor
-- Safe to re-run — uses IF NOT EXISTS / OR REPLACE throughout

-- ── 1. Add identity columns to sessions ──────────────────────────
alter table sessions
  add column if not exists user_email text,
  add column if not exists device_id  text;

-- user_id already exists in base schema.sql — skip if already present
-- (schema.sql defined: user_id uuid references auth.users on delete cascade)

-- ── 2. Add user_id to bias_library ───────────────────────────────
alter table bias_library
  add column if not exists user_id uuid references auth.users on delete set null;

-- ── 3. Add user_id to structural_matches ─────────────────────────
alter table structural_matches
  add column if not exists user_id uuid;

-- ── 4. user_preferences table ────────────────────────────────────
create table if not exists user_preferences (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  user_email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint user_preferences_user_id_key unique (user_id)
);

-- ── 5. Indexes ────────────────────────────────────────────────────
create index if not exists idx_sessions_user_email on sessions(user_email);
create index if not exists idx_sessions_device_id  on sessions(device_id);
create index if not exists idx_bias_library_user_id on bias_library(user_id);

-- ── 6. link_sessions_to_user RPC ─────────────────────────────────
-- Called from /api/auth/link-sessions after magic link auth.
-- Updates sessions rows matching the given IDs with user_id + user_email.
-- Returns count of rows updated.
create or replace function link_sessions_to_user(
  p_session_ids uuid[],
  p_user_id     uuid,
  p_user_email  text default null
)
returns integer
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
  where id = any(p_session_ids)
    and (user_id is null or user_id = p_user_id);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
