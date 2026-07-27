-- add_model_route_overrides_and_request_log.sql
-- ── Per-user routing override + persisted request log (TD-LD-10/TD-LD-11) ────
--
-- Context: the initial tiered-routing build (TIERED_ROUTING_ENABLED) used a
-- single GLOBAL switch plus the legacy global ROUTING_MODE=deepseek_only for
-- testing. That only covers testing while tiered routing is off for
-- everyone. TD-LD-11 explicitly wants more: the founder's own account able
-- to force a specific model while real Elite/Private customers route
-- normally, at the same time — "a supported, intended use of the schema...
-- first-class capability, not patched in later." This migration adds that.
--
-- model_route_fast / model_route_premium — per-user override, checked BEFORE
-- the tier's default model mapping (see lib/ai-client.ts's resolveProvider).
-- NULL (the default for every existing/new row) means "no override, use the
-- tier default" — so this ships fully inert until someone is explicitly
-- granted an override via /api/admin/grant-mirror-access.
--
-- Values are the same target-kind vocabulary lib/ai-client.ts's
-- ResolvedTarget already uses internally, so there's exactly one taxonomy of
-- "what can handle a request" across the whole system:
--   deepseek            — force DeepSeek regardless of tier
--   mistral_cloud        — force cloud Mistral Small
--   anthropic_elite       — force Claude Sonnet (ELITE_PREMIUM_MODEL)
--   qwen_selfhosted       — force the self-hosted Qwen endpoint
--   mistral_selfhosted    — force the self-hosted Mistral endpoint
--
-- ai_request_log — persisted record of which model actually handled each
-- request, so a future privacy audit (TD-LD-12) can verify what's claimed
-- rather than trusting console logs. Written fire-and-forget (best-effort,
-- never blocks or fails the actual AI call) only while
-- TIERED_ROUTING_ENABLED=true — the legacy path is unaffected, no new
-- writes, matching the master-switch's "zero behavior change when off"
-- guarantee.
--
-- Run this once in the Supabase SQL Editor. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE mirror_access
  ADD COLUMN IF NOT EXISTS model_route_fast TEXT
    CHECK (model_route_fast IN ('deepseek', 'mistral_cloud', 'anthropic_elite', 'qwen_selfhosted', 'mistral_selfhosted'));

ALTER TABLE mirror_access
  ADD COLUMN IF NOT EXISTS model_route_premium TEXT
    CHECK (model_route_premium IN ('deepseek', 'mistral_cloud', 'anthropic_elite', 'qwen_selfhosted', 'mistral_selfhosted'));

COMMENT ON COLUMN mirror_access.model_route_fast IS
  'Per-user override for the fast-role model, checked before the tier default. NULL = no override. TD-LD-11 founder/test-user workflow.';
COMMENT ON COLUMN mirror_access.model_route_premium IS
  'Per-user override for the premium-role model, checked before the tier default. NULL = no override. TD-LD-11 founder/test-user workflow.';

CREATE TABLE IF NOT EXISTS ai_request_log (
  id               BIGSERIAL PRIMARY KEY,
  user_id          UUID,                 -- nullable: some calls may not resolve to a user (e.g. an un-wired call site)
  tier             TEXT NOT NULL,        -- 'free' | 'elite' | 'private' at time of the call
  role             TEXT NOT NULL,        -- 'fast' | 'premium'
  resolved_target  TEXT NOT NULL,        -- ResolvedTarget.kind — the actual provider/config used
  resolved_model   TEXT,                 -- literal model string used, where known
  was_override     BOOLEAN NOT NULL DEFAULT FALSE,  -- true if model_route_fast/premium was the reason, not the tier default
  call_label       TEXT,                 -- ai-client.ts's internal call label (e.g. 'streamMistral', 'createCompletion/deepseek') — which function made the call
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_request_log_user_id    ON ai_request_log(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_request_log_created_at ON ai_request_log(created_at);

COMMENT ON TABLE ai_request_log IS
  'Persisted record of which model actually handled each AI call, written only while TIERED_ROUTING_ENABLED=true. Backs the TD-LD-12 privacy audit''s ability to verify what''s claimed, rather than relying on ephemeral console logs.';

-- No RLS policies added — service-role only (written from lib/ai-client.ts
-- via createServiceClient(), never from a browser-exposed client). Enable
-- RLS with no public policies as a defensive default, matching how other
-- service-role-only tables in this schema are configured.
ALTER TABLE ai_request_log ENABLE ROW LEVEL SECURITY;
