-- supabase/sprint_pwa_push.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- PWA Push Subscriptions
-- Stores per-user Web Push subscription objects (endpoint + ECDH keys).
-- One user can have multiple subscriptions (different devices/browsers).
-- Unique constraint on endpoint prevents duplicates from repeated subscribe calls.
-- 410-expired subscriptions are pruned automatically by lib/push.ts on send failure.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists push_subscriptions (
  id           uuid        primary key default uuid_generate_v4(),
  user_id      uuid        not null references auth.users on delete cascade,
  endpoint     text        not null,
  p256dh       text        not null,  -- client ECDH public key
  auth_key     text        not null,  -- client auth secret
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  constraint push_subscriptions_endpoint_unique unique (endpoint)
);

create index if not exists idx_push_subscriptions_user
  on push_subscriptions(user_id);

-- RLS: users can only manage their own subscriptions
alter table push_subscriptions enable row level security;

create policy "Users manage own push subscriptions"
  on push_subscriptions
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
