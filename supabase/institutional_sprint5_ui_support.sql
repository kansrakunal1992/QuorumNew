-- ─────────────────────────────────────────────────────────────────
-- QUORUM INSTITUTIONAL LAYER — Sprint 5: UI-support tables
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- Run AFTER supabase/institutional_sprint4_restricted_role.sql
-- ─────────────────────────────────────────────────────────────────

-- ── Active institution preference (Task 1/2) ────────────────────────
-- Not settled by the plan doc — resolved here: a small dedicated table
-- rather than client-only state (localStorage) or auth.users metadata.
-- Reasoning: switching institution context in global nav should carry
-- across devices/sessions the same way any other account-level setting
-- would, and a separate table keeps this out of Supabase auth internals.
-- One row per user; null active_institution_id is valid (e.g. a user who
-- left their only institution, or explicitly chose "Individual" while
-- still holding a membership elsewhere).
create table if not exists user_institution_preference (
  user_id               uuid primary key references auth.users(id) on delete cascade,
  active_institution_id uuid references institutions(id) on delete set null,
  updated_at            timestamptz default now() not null
);

alter table user_institution_preference enable row level security;

create policy "Users can view their own active-institution preference"
  on user_institution_preference for select
  using (auth.uid() = user_id);

create policy "Users can set their own active-institution preference"
  on user_institution_preference for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own active-institution preference"
  on user_institution_preference for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── Seen unlock notices (Task 5) ─────────────────────────────────────
-- One row per (user, dim, scope_type) the first time that benchmark panel
-- became visible to them — fires the one-time toast once, never again,
-- even across devices/sessions. scope_type distinguishes "this cleared at
-- the institution level" from "this cleared at the platform level" as
-- separate unlock moments, since they're genuinely different events (an
-- institution clearing its own floor for a dimension is more notable than
-- the always-available platform fallback quietly existing).
create table if not exists seen_unlock_notices (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  dim         text not null,
  scope_type  text not null check (scope_type in ('institution', 'platform', 'rollup')),
  seen_at     timestamptz default now() not null,

  constraint seen_unlock_notices_unique unique (user_id, dim, scope_type)
);

create index if not exists idx_seen_unlock_notices_user_id on seen_unlock_notices(user_id);

alter table seen_unlock_notices enable row level security;

create policy "Users can view their own seen-notice records"
  on seen_unlock_notices for select
  using (auth.uid() = user_id);

create policy "Users can mark their own notices as seen"
  on seen_unlock_notices for insert
  with check (auth.uid() = user_id);

-- Both tables are plain user data (an account-level preference, and a UI
-- state flag) — deliberately NOT following the "service-role-only writes"
-- pattern used for institution_memberships/consent_audit_log, since there's
-- no privacy-sensitive consent semantics here worth gating behind a route.
-- Direct client writes via RLS are fine and simpler for both.
