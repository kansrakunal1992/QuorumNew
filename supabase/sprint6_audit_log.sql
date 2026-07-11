-- ─────────────────────────────────────────────────────────────────────────────
-- QUORUM — Sprint 6 (S6-01): Audit Log Table
-- Run in: Supabase Dashboard → SQL Editor → New Query
--
-- Creates a write-once audit trail for all sensitive operations.
-- No user can read this table (service-role only via API routes).
-- Required foundation for SOC 2 CC7 and enterprise DPA execution.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists audit_log (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz default now() not null,

  -- Who performed the action (nullable — anonymous events still logged)
  actor_id    uuid,         -- auth.users.id when authenticated
  actor_email text,         -- user email for readability

  -- What happened
  action      text not null,
  -- Known action strings:
  --   'session.create'         — new decision session opened
  --   'session.delete'         — session deleted (future)
  --   'auth.magic_link_sent'   — sign-in link dispatched to email
  --   'account.export'         — user requested GDPR data export
  --   'account.delete'         — account and all data permanently erased
  --   'admin.access'           — admin dashboard accessed
  --   'admin.auth_failed'      — wrong ADMIN_CODE submitted
  --   'admin.locked_out'       — IP locked after 5 consecutive failures

  -- What it affected
  resource_id uuid,         -- session id, user id, etc.

  -- Request context
  ip_address  text,
  user_agent  text,

  -- Arbitrary extra context (e.g. plan type, affected row counts)
  metadata    jsonb
);

-- No user can read audit_log — service role only
alter table audit_log enable row level security;
-- Deliberately no SELECT policy: only service role bypasses RLS.

-- Index for time-ordered admin reads (last N entries)
create index if not exists idx_audit_log_created_at
  on audit_log(created_at desc);

-- Index for per-actor history
create index if not exists idx_audit_log_actor_id
  on audit_log(actor_id)
  where actor_id is not null;

-- Index for action-type filtering
create index if not exists idx_audit_log_action
  on audit_log(action);

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION
-- ─────────────────────────────────────────────────────────────────────────────
-- select tablename, rowsecurity from pg_tables where tablename = 'audit_log';
-- -- Expected: rowsecurity = true
--
-- select count(*) from pg_policies where tablename = 'audit_log';
-- -- Expected: 0  (no user-facing policy — service role only)
-- ─────────────────────────────────────────────────────────────────────────────
