-- ─────────────────────────────────────────────────────────────────
-- QUORUM INSTITUTIONAL LAYER — Sprint 1: Schema, Hierarchy, Master Flag, Unlock Codes
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- Run AFTER sprint2_add_register_to_sessions.sql
--
-- Touches NOTHING on sessions / messages / sessions_ontology /
-- examiner_responses / bias_library / contradiction_log. Additive only.
-- Master flag: NEXT_PUBLIC_INSTITUTIONAL_MODE_ENABLED (lib/feature-flags.ts),
-- default off — this schema can ship to prod with the flag off and be inert.
-- ─────────────────────────────────────────────────────────────────

-- ── Institutions ──────────────────────────────────────────────────
-- One row per company/org. Self-referencing parent enables the conglomerate
-- rollup (plan Section 1.3).

create table if not exists institutions (
  id                    uuid primary key default uuid_generate_v4(),
  name                  text not null,
  parent_institution_id uuid references institutions(id),
  unlock_code_hash      text not null unique,
  admin_seat_claimed    boolean default false not null,  -- flips true on first redemption
  k_floor_override      int,               -- null = use global K_FLOOR default (Sprint 4)
  allowed_email_domains text[],            -- optional redemption lock, see note below
  created_at            timestamptz default now() not null
);

create index if not exists idx_institutions_parent on institutions(parent_institution_id);

-- ── Institution Memberships ───────────────────────────────────────
-- One row per (user, institution). A user can hold many rows across
-- different institutions (plan Section 1.5).

create table if not exists institution_memberships (
  id                         uuid primary key default uuid_generate_v4(),
  institution_id             uuid references institutions on delete cascade not null,
  user_id                    uuid references auth.users on delete cascade not null,
  role                       text default 'member' check (role in ('admin', 'member')) not null,
  consent_aggregate          boolean default false not null,
  consent_aggregate_backfill boolean default false not null,
  consent_shared_cohort      boolean default false not null,
  cohort_id                  uuid,          -- FK added in Sprint 3 once `cohorts` exists
  joined_at                  timestamptz default now() not null,

  constraint institution_memberships_unique unique (institution_id, user_id)
);

create index if not exists idx_institution_memberships_institution_id on institution_memberships(institution_id);

-- ── Row Level Security ────────────────────────────────────────────
-- Enabled here, after both tables exist — the institutions policy below
-- subqueries institution_memberships, so that table must already exist
-- (Postgres resolves policy bodies at CREATE POLICY time, not lazily).

alter table institutions enable row level security;
alter table institution_memberships enable row level security;

-- institutions: readable by any user with a membership row in that
-- institution (for displaying the name/badge). No insert/update/delete
-- policy for the authenticated role at all — writes only happen via the
-- service role (app/api/admin/create-institution, app/api/institutions/redeem).
create policy "Members can view their institution"
  on institutions for select
  using (
    exists (
      select 1 from institution_memberships m
      where m.institution_id = institutions.id
      and m.user_id = auth.uid()
    )
  );

-- institution_memberships: a user can see/update only their own row. No
-- insert policy for the authenticated role — membership rows are created
-- only by the redemption route (service role), never directly by the client.
create policy "Users can view their own memberships"
  on institution_memberships for select
  using (auth.uid() = user_id);

create policy "Users can update their own memberships"
  on institution_memberships for update
  using (auth.uid() = user_id);

-- ── Note on two columns beyond the plan doc's literal task list ────
-- Both needed by app/api/institutions/redeem/route.ts — flag as a
-- "Deviations from plan" entry for this sprint:
--   - admin_seat_claimed: makes "first redemption = admin" an atomic DB flag
--     flipped with a conditional UPDATE, instead of counting existing rows,
--     so two simultaneous first-redemptions can't both win admin.
--   - allowed_email_domains: optional allowlist checked at redemption time.
--     Addresses the leaked-code case from chat — a leaked code already only
--     works for its own institution (per-institution hash, not a shared
--     secret), but this blunts the narrower case of that one leaked code
--     being used by people outside the org it belongs to.
