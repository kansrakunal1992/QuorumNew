-- add_product_tier_to_mirror_access.sql
-- ── Product tier columns on mirror_access ────────────────────────────────────
--
-- Context: mirror_access already tracks who has paid access (access_type:
-- 'monthly' | 'annual' | 'advisory' | legacy 'lifetime'), automated via the
-- Razorpay webhook, with a manual admin-grant fallback. This migration
-- extends the SAME table with two new columns so it can also answer "which
-- product tier is this user on" — the input the tiered AI-routing system
-- (lib/ai-client.ts, gated by TIERED_ROUTING_ENABLED) needs to pick a model.
--
-- Design:
--   product_tier          — 'elite' | 'private'. No mirror_access row at all
--                            still means Free (same convention getMirrorAccessState
--                            already uses for locked/teaser — absence = free tier).
--                            NOT NULL with a default, because every row that
--                            currently exists represents paid access, which
--                            under the new naming is 'elite' by definition.
--   private_model_family  — 'qwen' | 'mistral'. Only meaningful when
--                            product_tier = 'private' (the buyer's Option A/B
--                            choice, TD-LD-7). NULL for 'elite' rows.
--
-- Zero paying users today (per founder, July 2026) — no backfill/grandfathering
-- concerns. The DEFAULT + backfill UPDATE below are defensive no-ops for now,
-- kept because this table's own history shows fields get added without
-- migrations ever being deleted (see schema.sql's incremental sprint files).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE mirror_access
  ADD COLUMN IF NOT EXISTS product_tier TEXT NOT NULL DEFAULT 'elite'
    CHECK (product_tier IN ('elite', 'private'));

ALTER TABLE mirror_access
  ADD COLUMN IF NOT EXISTS private_model_family TEXT
    CHECK (private_model_family IN ('qwen', 'mistral'));

-- A private_model_family value only makes sense alongside product_tier='private'.
ALTER TABLE mirror_access
  ADD CONSTRAINT mirror_access_private_family_requires_private_tier
    CHECK (private_model_family IS NULL OR product_tier = 'private');

-- Defensive backfill — no-op if the table is empty (expected, zero paying users).
UPDATE mirror_access SET product_tier = 'elite' WHERE product_tier IS NULL;

COMMENT ON COLUMN mirror_access.product_tier IS
  'Free/Elite/Private product tier (Locked v1 pricing doc). No row = free. Drives lib/ai-client.ts tiered routing when TIERED_ROUTING_ENABLED=true.';
COMMENT ON COLUMN mirror_access.private_model_family IS
  'Only set when product_tier=private — the buyer''s self-hosted Option A (qwen) vs Option B (mistral) choice, TD-LD-7.';
