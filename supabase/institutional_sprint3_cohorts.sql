-- ─────────────────────────────────────────────────────────────────
-- QUORUM INSTITUTIONAL LAYER — Sprint 3: Cohorts (Source #1)
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- Run AFTER supabase/institutional_sprint2_consent_audit.sql
--
-- Master flag: NEXT_PUBLIC_INSTITUTIONAL_MODE_ENABLED (lib/feature-flags.ts),
-- default off — inert until the flag is on.
-- ─────────────────────────────────────────────────────────────────

-- ── Deviation from plan: dropping institution_memberships.cohort_id ─
-- Sprint 1 added a single `cohort_id uuid` column with a "FK added in
-- Sprint 3" comment, anticipating one-cohort-per-membership. The plan's own
-- Sprint 3 section recommends the many-to-many model instead ("a user might
-- reasonably be in more than one cohort — e.g. Leadership and Product"), and
-- that's what this migration implements via cohort_memberships below.
-- Dropping the unused column now rather than leaving a dead, never-written
-- field that could confuse a future reader into thinking it's live.

alter table institution_memberships drop column if exists cohort_id;

-- ── Cohorts ────────────────────────────────────────────────────────
-- A named small group within one institution (e.g. "Leadership", "Product").

create table if not exists cohorts (
  id             uuid primary key default uuid_generate_v4(),
  institution_id uuid references institutions(id) on delete cascade not null,
  name           text not null,
  created_at     timestamptz default now() not null
);

create index if not exists idx_cohorts_institution_id on cohorts(institution_id);

-- ── Cohort Memberships ───────────────────────────────────────────────
-- Many-to-many: a user can belong to more than one cohort within (or even
-- across) institutions.

create table if not exists cohort_memberships (
  id         uuid primary key default uuid_generate_v4(),
  cohort_id  uuid references cohorts(id) on delete cascade not null,
  user_id    uuid references auth.users(id) on delete cascade not null,
  joined_at  timestamptz default now() not null,

  constraint cohort_memberships_unique unique (cohort_id, user_id)
);

create index if not exists idx_cohort_memberships_cohort_id on cohort_memberships(cohort_id);
create index if not exists idx_cohort_memberships_user_id on cohort_memberships(user_id);

-- ── Row Level Security ────────────────────────────────────────────
alter table cohorts enable row level security;
alter table cohort_memberships enable row level security;

-- cohorts: readable by any user who is a member of that cohort, or an admin
-- of the parent institution (so the admin portal roster/cohort views work).
create policy "Cohort members and institution admins can view a cohort"
  on cohorts for select
  using (
    exists (
      select 1 from cohort_memberships cm
      where cm.cohort_id = cohorts.id
      and cm.user_id = auth.uid()
    )
    or exists (
      select 1 from institution_memberships im
      where im.institution_id = cohorts.institution_id
      and im.user_id = auth.uid()
      and im.role = 'admin'
    )
  );

-- cohort_memberships: a user can see their own rows, plus (per plan Section
-- 4 task 2's precedent of admin-visible-but-limited data) an institution
-- admin can see membership rows for cohorts under their institution — this
-- powers the admin roster view, and is membership metadata (who's in which
-- cohort), never the whitelisted insight data itself, which lives entirely
-- server-side in lib/cohort-insights.ts and is never queried directly by
-- the client.
create policy "Users can view their own cohort memberships"
  on cohort_memberships for select
  using (auth.uid() = user_id);

create policy "Institution admins can view cohort memberships in their institution"
  on cohort_memberships for select
  using (
    exists (
      select 1 from cohorts c
      join institution_memberships im on im.institution_id = c.institution_id
      where c.id = cohort_memberships.cohort_id
      and im.user_id = auth.uid()
      and im.role = 'admin'
    )
  );

-- No insert/update/delete policy for the authenticated role on either table
-- — cohort creation and roster management are service-role-only operations
-- (admin portal routes), not yet exposed as self-serve to end users.
