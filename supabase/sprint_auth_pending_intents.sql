-- ─────────────────────────────────────────────────────────────────────────────
-- QUORUM — Cross-browser sign-in: server-side "pending intent"
-- Run once in the Supabase SQL Editor. Safe to re-run.
--
-- Problem: a magic link opened in a different browser than the one that asked for it
-- (incognito -> normal browser, mail app -> Safari) has no localStorage, and the query
-- string that was supposed to carry the return path + session ids is dropped whenever
-- Supabase does not honour emailRedirectTo (allow-list mismatch -> Site URL fallback).
-- The person then lands on Home and loses their place in the Council gate.
--
-- Fix: POST /api/auth records WHERE the person was and WHICH sessions to link, keyed by
-- email. After Supabase verifies the link, /auth/callback asks POST /api/auth/resume
-- (Bearer-authenticated, so only the inbox owner can read it) and sends them back.
--
-- Rows are short-lived: honoured for 1 hour (the magic-link lifetime) and deleted
-- opportunistically after 24 hours by POST /api/auth. Holds no decision text.
-- Service-role only: RLS is on with NO policies, so the anon/authenticated keys cannot read it.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists auth_pending_intents (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,                         -- lower-cased
  return_to     text,                                  -- same-origin path, validated by lib/return-to.ts
  session_ids   text[] not null default '{}',          -- uuids, validated by lib/auth-intent.ts
  device_id     text,
  utm_source    text,
  utm_campaign  text,
  utm_content   text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_auth_pending_intents_email_created
  on auth_pending_intents (email, created_at desc);

create index if not exists idx_auth_pending_intents_created
  on auth_pending_intents (created_at);

alter table auth_pending_intents enable row level security;
-- (deliberately no policies — service role bypasses RLS, nothing else may touch this table)
