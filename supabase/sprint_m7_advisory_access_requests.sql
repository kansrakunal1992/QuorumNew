-- QUORUM MIRROR — Advisory Access Requests (Sprint M7)
-- Run after schema.sql
--
-- Backs the "Request access" CTA added to AdvisoryUpsellCard. Advisory is a
-- capped-cohort, manually-granted tier (see ADVISORY_BYPASSES_THRESHOLDS in
-- lib/mirror-tier-config.ts and app/api/admin/grant-mirror-access) — this
-- table doesn't grant anything itself, it just gives a 'mirror' tier user a
-- real next step instead of a dead-end upsell card, and gives you a queue to
-- work from instead of nothing.

create table if not exists advisory_access_requests (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid references auth.users on delete cascade not null,
  created_at   timestamptz default now() not null,
  -- Which upsell touch point triggered the request — lets you tell if
  -- Benchmark, the SRI next-move layer, or full contradiction detail is
  -- driving the most interest, without needing to ask.
  source       text check (source in ('benchmark', 'sriNextMove', 'contradictionDetail')),
  status       text default 'pending' not null
                 check (status in ('pending', 'contacted', 'granted', 'declined')),
  -- One request per user — resubmitting just surfaces the existing row
  -- (upsert on conflict), rather than creating a queue of duplicates from
  -- someone clicking the card more than once.
  unique (user_id)
);

create index if not exists idx_advisory_requests_status on advisory_access_requests(status);

alter table advisory_access_requests enable row level security;

-- Users can see their own request (so the UI can show "Request sent" on
-- return visits without a new API round trip). All writes go through the
-- service-role API route (app/api/mirror/advisory-request/route.ts), not
-- directly from the client, same pattern as the rest of the Mirror routes.
create policy "Users can view their own advisory access request"
  on advisory_access_requests for select
  using (auth.uid() = user_id);
