-- ─────────────────────────────────────────────────────────────────
-- QUORUM INSTITUTIONAL LAYER — Sprint 2: Consent Audit Log
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- Run AFTER supabase/institutional_sprint1_schema.sql (references institutions,
-- institution_memberships, auth.users).
--
-- Master flag: NEXT_PUBLIC_INSTITUTIONAL_MODE_ENABLED (lib/feature-flags.ts),
-- default off — inert until the flag is on.
-- ─────────────────────────────────────────────────────────────────

-- ── Consent Audit Log ─────────────────────────────────────────────
-- One row per consent-toggle write. Never updated or deleted — an audit
-- trail of who changed what, when. Written by app/api/institutions/consent
-- (service role) in the same request that updates institution_memberships,
-- so the two are always in sync.

create table if not exists consent_audit_log (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid references auth.users(id) on delete cascade not null,
  institution_id uuid references institutions(id) on delete cascade not null,
  field_changed  text not null check (
    field_changed in ('consent_aggregate', 'consent_aggregate_backfill', 'consent_shared_cohort')
  ),
  old_value      boolean not null,
  new_value      boolean not null,
  changed_at     timestamptz default now() not null
);

create index if not exists idx_consent_audit_log_user_id on consent_audit_log(user_id);
create index if not exists idx_consent_audit_log_institution_id on consent_audit_log(institution_id);
create index if not exists idx_consent_audit_log_institution_changed_at on consent_audit_log(institution_id, changed_at);

alter table consent_audit_log enable row level security;

-- A user can see their own audit rows (their own change history).
create policy "Users can view their own consent audit log"
  on consent_audit_log for select
  using (auth.uid() = user_id);

-- No policy grants an institution admin row-level SELECT here on purpose —
-- per plan Section 4 task 2, admins see aggregate COUNTS of changes, never
-- whose. That aggregate query is served by
-- app/api/institutions/[institutionId]/consent-changes (service role,
-- returns counts only, never selects user_id in its response). If a future
-- sprint needs admins to query this table directly, that is a deliberate,
-- separate decision — not a default this migration grants.
--
-- No insert/update/delete policy for the authenticated role — rows are
-- written only by the consent-toggle route (service role). This table is
-- intentionally append-only from the client's perspective.
