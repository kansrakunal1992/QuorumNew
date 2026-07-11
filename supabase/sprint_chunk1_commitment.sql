-- ─────────────────────────────────────────────────────────────────────────────
-- Sprint Chunk 1 — Commitment Capture + Rule Recall
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Adds 6 columns to sessions.
--
-- commitment_leaning:      Clubs "current leaning" + "next action" — one encrypted
--                          text field. Captures decision direction + first move.
-- commitment_switch:       Clubs "switch conditions" + "main unresolved risk" — one
--                          encrypted text field. What would change course.
-- commitment_review_date:  The primary retention hook. Date user intends to revisit.
--                          Drives Monthly Judgment Review open-loops list (Chunk 2).
-- commitment_captured_at:  Timestamp. Distinguishes sessions with commitment from
--                          those pre-dating the feature.
-- rule_recall_choice:      'applied' | 'exception' | 'ignored'. Null = no rule was
--                          surfaced (threshold not met, no rules exist, or anonymous).
-- rule_recall_rule_text:   Encrypted. The specific rule text shown to the user.
-- ─────────────────────────────────────────────────────────────────────────────

alter table sessions
  add column if not exists commitment_leaning      text,
  add column if not exists commitment_switch       text,
  add column if not exists commitment_review_date  date,
  add column if not exists commitment_captured_at  timestamptz,
  add column if not exists rule_recall_choice      text
    check (rule_recall_choice in ('applied', 'exception', 'ignored')),
  add column if not exists rule_recall_rule_text   text;

comment on column sessions.commitment_leaning is
  'Encrypted. "Where are you leaning and what is your first move?" — clubs current_leaning + next_action. Sprint Chunk 1.';

comment on column sessions.commitment_switch is
  'Encrypted. "What would change your course?" — clubs switch_conditions + main_unresolved_risk. Sprint Chunk 1.';

comment on column sessions.commitment_review_date is
  'Date the user intends to revisit this decision. Primary retention hook for Monthly Judgment Review open-loops. Sprint Chunk 1.';

comment on column sessions.commitment_captured_at is
  'Timestamp of DecisionStateCard submission. Null = user skipped or pre-dates feature. Sprint Chunk 1.';

comment on column sessions.rule_recall_choice is
  'User action when a prior rule was surfaced: applied | exception | ignored. Null = no rule surfaced. Sprint Chunk 1.';

comment on column sessions.rule_recall_rule_text is
  'Encrypted. The rule text surfaced to the user via RuleRecallBanner. Sprint Chunk 1.';
