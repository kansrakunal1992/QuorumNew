-- add_private_deployments.sql
-- ── Per-customer Private tier deployments ─────────────────────────────────────
--
-- Context: the original Private tier routing (QWEN_SELFHOSTED_BASE_URL,
-- MISTRAL_SELFHOSTED_BASE_URL, etc.) used ONE global env var per model
-- family — fine with zero or one Private customer, broken the moment there
-- are two, since "buyer's own cloud account" means each customer has their
-- own separate instance with its own URL and key. This table replaces those
-- global env vars with a per-customer row. See lib/ai-client.ts for how it's
-- read (ProductTierInfo.privateEndpoint, resolved in lib/product-tier.ts).
--
-- One row per Private customer for V1 — one deployment serves both the fast
-- and premium roles for that customer's chosen model family (two model
-- processes on one GPU VM, or a VM sized for both — see the Terraform
-- modules under infra/). If a customer ever needs fast/premium split across
-- two separate deployments, that's a schema extension (drop the UNIQUE
-- constraint, add a `role` column), not something this migration assumes.
--
-- endpoint_api_key is stored in plaintext here, same as every other
-- credential-shaped column in this schema (RAZORPAY keys, service role key,
-- etc. all live in env vars/plaintext columns elsewhere in this project) —
-- flagging rather than silently deviating from that existing pattern. If you
-- want this one encrypted at rest specifically (it's a credential to a
-- customer's own infrastructure, arguably more sensitive than most), that's
-- a deliberate call to make, not a default I should assume.
--
-- Run this once in the Supabase SQL Editor. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS private_deployments (
  id                BIGSERIAL PRIMARY KEY,
  user_id           UUID NOT NULL UNIQUE,   -- one deployment per customer for V1, see doc comment above
  cloud_provider    TEXT NOT NULL CHECK (cloud_provider IN ('aws', 'gcp', 'azure')),
  model_family      TEXT NOT NULL CHECK (model_family IN ('qwen', 'mistral')),  -- kept in sync with mirror_access.private_model_family at deploy time
  endpoint_url      TEXT NOT NULL,          -- e.g. https://quorum-private-<customer>.example.com
  endpoint_api_key  TEXT NOT NULL,          -- generated at deploy time, unique per customer — see infra/*/terraform
  fast_model        TEXT NOT NULL,          -- literal model name served for the 'fast' role
  premium_model     TEXT NOT NULL,          -- literal model name served for the 'premium' role
  image_version     TEXT,                   -- current deployed container image tag/digest — auto-updater (infra/updater/) reports this back so you can see deployment drift across customers
  deployed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_healthy_at   TIMESTAMPTZ,            -- updated by the health-check ping — see infra/updater/README.md
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_private_deployments_user_id ON private_deployments(user_id);

COMMENT ON TABLE private_deployments IS
  'One row per Private-tier customer''s self-hosted deployment — replaces the old global QWEN_SELFHOSTED_*/MISTRAL_SELFHOSTED_* env vars, which only supported a single shared customer. Read by lib/product-tier.ts, consumed in lib/ai-client.ts.';

ALTER TABLE private_deployments ENABLE ROW LEVEL SECURITY;
-- No public policies — service-role only, same as ai_request_log and
-- mirror_access. Never queried from a browser-exposed client.
