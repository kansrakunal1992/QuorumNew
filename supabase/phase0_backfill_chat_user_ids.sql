-- QUORUM -- Phase 0: backfill user_id on chat-flow rows created without it
--
-- Background: until the Phase 0 code fix, components/ChatIntake.tsx and
-- components/DecisionCheckpoint.tsx called /api/chat-intake and
-- /api/chat-intake/checkpoint WITHOUT an Authorization header, so chat_intakes
-- and sessions were created with user_id = NULL even for signed-in people.
-- /api/auth/link-sessions only repaired rows that existed at sign-in time.
--
-- This script links the leftover rows, but ONLY where a device_id maps to
-- exactly ONE user in sessions that were already linked. A device that has been
-- used by two different accounts (shared computer) is skipped on purpose.
--
-- RUN ORDER: (1) run the PREVIEW queries and eyeball the counts,
--            (2) run the UPDATEs inside a transaction, (3) COMMIT or ROLLBACK.
-- This is intentionally NOT automatic. Do not run it unreviewed.

-- ---------------------------------------------------------------- PREVIEW --
with device_owner as (
  select device_id, min(user_id::text)::uuid as user_id
  from sessions
  where user_id is not null and device_id is not null
  group by device_id
  having count(distinct user_id) = 1
)
select
  (select count(*) from sessions s
     join device_owner d on d.device_id = s.device_id
     where s.user_id is null)                         as sessions_to_link,
  (select count(*) from chat_intakes c
     join device_owner d on d.device_id = c.device_id
     where c.user_id is null)                         as chat_intakes_to_link,
  (select count(*) from (
     select device_id from sessions
     where user_id is not null and device_id is not null
     group by device_id having count(distinct user_id) > 1) x) as shared_devices_skipped;

-- ----------------------------------------------------------------- APPLY ---
begin;

with device_owner as (
  select device_id, min(user_id::text)::uuid as user_id
  from sessions
  where user_id is not null and device_id is not null
  group by device_id
  having count(distinct user_id) = 1
)
update sessions s
   set user_id = d.user_id
  from device_owner d
 where s.device_id = d.device_id
   and s.user_id is null;

with device_owner as (
  select device_id, min(user_id::text)::uuid as user_id
  from sessions
  where user_id is not null and device_id is not null
  group by device_id
  having count(distinct user_id) = 1
)
update chat_intakes c
   set user_id = d.user_id
  from device_owner d
 where c.device_id = d.device_id
   and c.user_id is null;

-- Look at the row counts reported above, then:
--   commit;      -- keep
--   rollback;    -- undo
