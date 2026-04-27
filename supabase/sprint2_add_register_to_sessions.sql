-- QUORUM LEDGER — Sprint 2: Examiner Phase 0 register choice
-- Run AFTER sprint1_add_ledger_tables.sql

alter table sessions
  add column if not exists register_mode text
  check (register_mode in ('analytical', 'clarification'));

comment on column sessions.register_mode is
  'analytical = Challenge my thinking. clarification = Help me understand what I want.';
