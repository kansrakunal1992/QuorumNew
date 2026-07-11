-- ─────────────────────────────────────────────────────────────────
-- QUORUM — Sprint CX2: Home-Screen Bias Alert Sharpening
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ─────────────────────────────────────────────────────────────────

-- ── Bias Alert Log Table ──────────────────────────────────────────
-- One row per home-screen alert surfaced to a user (BehaviorAlerts.tsx).
-- Covers all three detection sources: layer1 (personal keyword match),
-- layer2 (static phrase library match), fallback (DeepSeek classification
-- against the user's own confirmed bias set).
--
-- Also doubles as the source-of-truth for the per-user daily cap on
-- fallback calls (Sprint CX2 #5) — count rows where source='fallback'
-- and created_at >= start of today for that user_id.
--
-- decision_snippet and matched_detail contain raw user decision text —
-- both are application-level encrypted (lib/encryption.ts), consistent
-- with how sessions.decision_text is handled. Never store these plaintext.

create table if not exists bias_alert_log (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null,
  created_at        timestamptz default now() not null,

  bias_key          text not null,             -- one of BIAS_PARAMETERS keys
  source            text not null check (source in ('layer1', 'layer2', 'fallback')),
  access_tier       text not null check (access_tier in ('teaser', 'unlocked')),

  decision_snippet  text,                       -- encrypted — first ~200 chars of decision text at time of match
  matched_detail    text,                       -- encrypted — matched phrase (layer1/2) or model evidence string (fallback)

  dismissed_at      timestamptz                 -- null until user dismisses the alert card
);

create index if not exists idx_bias_alert_log_user_id        on bias_alert_log(user_id);
create index if not exists idx_bias_alert_log_user_source_day on bias_alert_log(user_id, source, created_at);

alter table bias_alert_log enable row level security;

create policy "Bias alert log accessible via service role"
  on bias_alert_log for all using (true);
