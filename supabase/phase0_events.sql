-- QUORUM -- Phase 0: first-party product events
-- Run before deploying the build that calls POST /api/events. Safe to re-run.
-- The route answers 204 even if this table is missing, so deploying first is
-- harmless -- you just lose events until it exists.

create table if not exists events (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  event           text        not null,
  device_id       text,
  user_id         uuid,
  session_id      uuid,
  decision_index  int,
  identity_state  text        not null default 'anonymous'
                  check (identity_state in ('anonymous', 'google', 'magic_link')),
  props           jsonb       not null default '{}'::jsonb
);

create index if not exists events_event_created_idx  on events (event, created_at desc);
create index if not exists events_device_created_idx on events (device_id, created_at desc);
create index if not exists events_user_created_idx   on events (user_id, created_at desc);

-- Written only by the service role from /api/events; no client access.
alter table events enable row level security;
