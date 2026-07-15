-- P0 fix: server-side completion tracking for the Council (Session View) and
-- Record page tours — the same fix add_onboarding_completed_to_user_profiles.sql
-- already applied to the Home tour.
--
-- Both tours were previously gated on localStorage alone ('quorum_tour.council'
-- / 'quorum_tour.record'), which is device-local. An established user (real
-- decisions already on record) opening the app on a fresh device/browser —
-- e.g. a freshly installed mobile PWA — would see a "first decision" tour
-- again on Session View and/or the Record page, even though Home correctly
-- stayed hidden because it already had this cross-device check.
--
-- Run this once, manually, via the Supabase SQL editor (same manual-apply
-- convention as add_onboarding_completed_to_user_profiles.sql).

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS council_tour_completed_at timestamptz NULL;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS record_tour_completed_at timestamptz NULL;
