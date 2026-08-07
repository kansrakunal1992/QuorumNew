-- add_decision_session_payments.sql
-- ── Live Quorum Decision Session — one-time guest payment tracking ───────────
--
-- Context: this backs the ₹299 "Live Decision Session" funnel entered from
-- /kunal on the marketing website. Unlike every other payment in this app
-- (Elite / Founding Elite, both Razorpay SUBSCRIPTIONS tied to a signed-in
-- Supabase user via mirror_access), this is a Razorpay ONE-TIME ORDER paid
-- by an anonymous ad visitor with no account. There is no user_id to key
-- off, so this is deliberately its own small, disconnected table — same
-- reasoning as watchlist_items being kept structurally distant from
-- sessions_ontology: this has nothing to do with Mirror access, product
-- tiers, or the subscription webhook's upsert-by-user_id logic, and should
-- never be confused for or merged into mirror_access.
--
-- Row lifecycle:
--   created → order created via /api/decision-session/create-order,
--             razorpay_order_id stored before checkout even opens.
--   paid    → signature verified server-side in
--             /api/decision-session/verify-order (or, as a fallback if the
--             browser never completes that call — tab closed, network
--             drop — by the payment.captured branch added to the existing
--             Razorpay webhook). booking_token is issued only on this
--             transition; the website only opens its booking modal once it
--             has a token.
--   failed  → Razorpay checkout was dismissed/failed client-side. Best-
--             effort only (no webhook event to confirm this one), used
--             solely for admin visibility — never gates anything.
--
-- booking_token is a bearer token, not a secret credential: it just proves
-- "this browser completed a real ₹299 payment" so /kunal can skip straight
-- to the Google Calendar modal on a refresh without charging twice. It is
-- never displayed or logged anywhere sensitive-adjacent.
--
-- Run this once in the Supabase SQL Editor. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS decision_session_payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  razorpay_order_id     TEXT NOT NULL UNIQUE,
  razorpay_payment_id   TEXT,

  status                TEXT NOT NULL DEFAULT 'created'
                          CHECK (status IN ('created', 'paid', 'failed')),

  amount_inr            INT NOT NULL DEFAULT 299,

  -- Bearer token handed back to the browser once paid — see doc comment
  -- above. NULL until status = 'paid'.
  booking_token         TEXT UNIQUE,

  -- Best-effort attribution only, passed through from the ad link
  -- (?session=1&utm_source=...) at order-creation time. Never required,
  -- never validated against a fixed list.
  utm_source            TEXT,
  utm_campaign          TEXT,
  utm_content            TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at               TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_decision_session_payments_order
  ON decision_session_payments (razorpay_order_id);

CREATE INDEX IF NOT EXISTS idx_decision_session_payments_token
  ON decision_session_payments (booking_token);

COMMENT ON TABLE decision_session_payments IS
  'Guest (no-login) one-time ₹299 Razorpay Order payments for the Live Quorum Decision Session funnel entered from /kunal. Deliberately separate from mirror_access — no user_id, not a subscription, not Mirror-related. See app/api/decision-session/create-order and /verify-order.';

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Service-role only, same convention as ai_request_log / private_deployments.
-- Never queried from a browser-exposed client — the website only ever gets
-- back an opaque booking_token in an API response, never direct DB access.
ALTER TABLE decision_session_payments ENABLE ROW LEVEL SECURITY;
-- No public policies.
