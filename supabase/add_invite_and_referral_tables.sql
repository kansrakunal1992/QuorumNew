-- Item #16 — individual HNI invite codes.
-- Reuses the same security pattern as institutions/redeem (SHA-256 hash,
-- lookup by hash, no shared global secret) but as a separate table/data
-- model — deliberately NOT merged with the institutional layer, per the
-- working decision on this item.
--
-- This is a tracking/attribution mechanism for the founder-led,
-- invite-only outreach motion, not a hard paywall — the Council remains
-- free and open as already positioned on the marketing site. Redeeming a
-- code records who came from which outreach effort; it does not gate
-- access to anything.

CREATE TABLE IF NOT EXISTS individual_invite_codes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash         text NOT NULL UNIQUE,
  label             text NULL,              -- admin-only note, e.g. "Founder outreach — batch 1"
  max_redemptions   int  NOT NULL DEFAULT 1,
  redemption_count  int  NOT NULL DEFAULT 0,
  expires_at        timestamptz NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS individual_invite_redemptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_code_id   uuid NOT NULL REFERENCES individual_invite_codes(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  redeemed_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invite_code_id, user_id)
);

-- Item #17 — plain referral link tracking. No rewards/incentive mechanics
-- yet (per the working decision on this item) — just attribution: who
-- referred whom. referrer_id is the existing user's own auth.users id used
-- directly as their referral code (?ref=<user_id>) — no separate
-- code-generation step needed.

CREATE TABLE IF NOT EXISTS referrals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (referred_user_id)   -- a user can only ever be attributed to one referrer
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals (referrer_id);
