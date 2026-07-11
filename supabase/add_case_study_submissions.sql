-- Item #11: real case-study capture, opt-in only from the first version
-- (per the working decision on item #12 — default consent must never be
-- opt-out, given the encryption/DPA/confidentiality posture the whole
-- product is built on).
--
-- One row per user's explicit opt-in to have a specific decision considered
-- as a case study. Nothing here is ever shown publicly automatically —
-- `status` starts at 'pending_review' and only a human (via the admin
-- dashboard) can move it to 'approved'. Even then, publishing to the
-- marketing site remains a manual step outside this table, same as the
-- illustrative scenario copy already there.

CREATE TABLE IF NOT EXISTS case_study_submissions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id        uuid NOT NULL REFERENCES sessions(id)   ON DELETE CASCADE,
  user_note         text NULL,               -- optional context the user adds when opting in
  anonymized_draft  text NULL,               -- AI-drafted starting point ONLY — a human must
                                              -- review/edit this before anything is published;
                                              -- this column is never rendered to end users.
  status            text NOT NULL DEFAULT 'pending_review'
                       CHECK (status IN ('pending_review', 'approved', 'rejected')),
  consent_given_at  timestamptz NOT NULL DEFAULT now(),
  reviewed_at       timestamptz NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id)   -- one opt-in ask per decision, no re-prompting
);

CREATE INDEX IF NOT EXISTS idx_case_study_submissions_status
  ON case_study_submissions (status, created_at);
