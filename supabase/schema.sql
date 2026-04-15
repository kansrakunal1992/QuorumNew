-- ─────────────────────────────────────────────────────────────────
-- QUORUM COUNCIL — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ─────────────────────────────────────────────────────────────────

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ── Sessions ────────────────────────────────────────────────────
create table if not exists sessions (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid references auth.users on delete cascade,
  created_at    timestamptz default now() not null,
  decision_text text not null,
  context_text  text,
  status        text default 'active' check (status in ('active', 'completed'))
);

-- ── Messages ────────────────────────────────────────────────────
create table if not exists messages (
  id            uuid primary key default uuid_generate_v4(),
  session_id    uuid references sessions on delete cascade not null,
  created_at    timestamptz default now() not null,
  persona       text not null,
  role          text not null check (role in ('assistant', 'user')),
  content       text not null
);

-- Indexes for fast session lookups
create index if not exists idx_messages_session_id on messages(session_id);
create index if not exists idx_sessions_user_id on sessions(user_id);

-- ── Row Level Security ───────────────────────────────────────────
-- Users can only see their own sessions + messages

alter table sessions enable row level security;
alter table messages enable row level security;

-- Sessions: owner-only access
create policy "Users can manage their own sessions"
  on sessions for all
  using (auth.uid() = user_id);

-- Messages: accessible if the parent session belongs to the user
create policy "Users can manage their session messages"
  on messages for all
  using (
    exists (
      select 1 from sessions s
      where s.id = messages.session_id
      and s.user_id = auth.uid()
    )
  );

-- Service role bypass (used by API routes with service key)
-- The service role key bypasses RLS automatically — no extra policy needed.
