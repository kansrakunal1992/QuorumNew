-- Sprint 12: Provider lock — prevent silent account forking between
-- magic link and Google sign-in when the same email is used for both.
--
-- Design: each account is locked to whichever auth method it signed up
-- with first (recorded in user_preferences.signup_method). If the same
-- email later comes through the OTHER method:
--   • /api/auth (magic link send) pre-checks and blocks before sending
--   • /api/auth/link-sessions (runs after every successful auth, both
--     flows) is the real backstop — it catches the mismatch even if
--     the pre-check was skipped, cleans up the just-created duplicate
--     auth.users row, and tells the client which method to use instead.
--
-- Run this once in the Supabase SQL Editor. Safe to re-run.

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS signup_method text
    CHECK (signup_method IN ('magic_link', 'google'));

-- Indexed lookup by email — both the magic-link pre-check and the
-- Google post-check query by user_email, not user_id.
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_email
  ON user_preferences(user_email);

-- ── Backfill for emails already there ────────────────────────────────
-- Every existing account signed up before Google was an option, so
-- every existing row is a magic_link account. Without this, those
-- users would look "unset" and a later Google attempt with the same
-- email wouldn't be recognised as a mismatch — it would fork silently,
-- which is exactly the failure mode this migration exists to prevent.
UPDATE user_preferences
SET signup_method = 'magic_link'
WHERE signup_method IS NULL;
