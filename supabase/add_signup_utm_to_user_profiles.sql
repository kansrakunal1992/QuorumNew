-- supabase/add_signup_utm_to_user_profiles.sql
-- ── GTM attribution: first-touch signup UTM ─────────────────────────────
-- Additive only — three new nullable columns on the existing user_profiles
-- table. Safe to re-run (IF NOT EXISTS throughout). Written by
-- app/api/auth/link-utm/route.ts, once per user, only on true first
-- registration (never overwritten by a later login).

alter table user_profiles add column if not exists signup_utm_source   text;
alter table user_profiles add column if not exists signup_utm_campaign text;
alter table user_profiles add column if not exists signup_utm_content  text;

create index if not exists idx_user_profiles_signup_utm_source
  on user_profiles (signup_utm_source)
  where signup_utm_source is not null;
