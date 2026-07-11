-- Item #3 fix: server-side onboarding tour completion tracking.
--
-- The home onboarding tour was gated only by localStorage
-- ('quorum_tour.home'), which is device-local. A signed-in user returning
-- on a different device/browser had no server record to check, so the
-- tour reappeared even though they'd already seen it once. This column
-- gives the app a durable, cross-device source of truth to check
-- alongside the existing localStorage flag (kept as the fast client-side
-- check; this is the authoritative one for signed-in users).
--
-- Run this once, manually, via the Supabase SQL editor (this repo does not
-- track user_profiles' original creation as a migration file, so this
-- follows that same manual-apply convention).

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS onboarding_tour_completed_at timestamptz NULL;
