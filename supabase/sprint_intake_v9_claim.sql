-- Natural Intake v9 / Sprint 2 — checkpoint claim (prevents two concurrent launches creating two sessions).
-- Safe to run before OR after deploying the code: the route skips the claim if this column is missing.
-- Idempotent. No data is changed; existing rows get NULL (= unclaimed).
alter table chat_intakes add column if not exists checkpoint_claimed_at timestamptz;

comment on column chat_intakes.checkpoint_claimed_at is
  'Set by POST /api/chat-intake/checkpoint just before it creates the session; cleared if creation fails. A claim older than ~90s is treated as abandoned. Not read by any report.';
