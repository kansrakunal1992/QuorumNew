-- QUORUM — Sprint 2b: Council page enhancements
-- Safe additive migration — no existing columns or data touched.
-- Run after sprint2_add_register_to_sessions.sql.

-- S2-05: carry prior session's validation correction into the new session
-- so the council context injection happens at persona-call time (not after validation).
alter table sessions
  add column if not exists validation_correction_carry text;

comment on column sessions.validation_correction_carry is
  'Prior session validation_correction, copied at session creation when parent_session_id is present.
   Used by the persona route to inject the correction into council context at call time,
   since the current session has no validation_correction of its own yet.';

-- S2-01: capture post-council confidence re-rate (1–10)
alter table sessions
  add column if not exists post_decision_confidence smallint
    check (post_decision_confidence between 1 and 10);

comment on column sessions.post_decision_confidence is
  'Confidence re-rating the user gives after reading synthesis (3-tap widget in SynthesisCard).
   Compared with pre_decision_confidence to measure decision clarity delta.';
