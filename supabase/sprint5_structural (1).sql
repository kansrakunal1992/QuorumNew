-- Sprint 5: Structural Retrieval Tables
-- Run AFTER sprint4_bias_score.sql
-- Safe to re-run — uses IF NOT EXISTS throughout.

-- structural_matches: one row per session, stores the retrieval result
CREATE TABLE IF NOT EXISTS structural_matches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_email          text,
  user_id             uuid,
  context_block       text,
  matches_json        jsonb DEFAULT '[]'::jsonb,
  session_count_used  integer DEFAULT 0,
  threshold_met       boolean DEFAULT false,
  computed_at         timestamptz DEFAULT now(),
  UNIQUE (session_id)
);

-- structural_scores: pairwise scores for every session-pair evaluated
CREATE TABLE IF NOT EXISTS structural_scores (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id_a        uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  session_id_b        uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  score_total         integer NOT NULL DEFAULT 0,
  score_type          integer DEFAULT 0,
  score_register      integer DEFAULT 0,
  score_stakes        integer DEFAULT 0,
  score_counterparty  integer DEFAULT 0,
  score_time          integer DEFAULT 0,
  threshold_met       boolean DEFAULT false,
  computed_at         timestamptz DEFAULT now(),
  UNIQUE (session_id_a, session_id_b)
);

-- session_outcomes: user-logged outcomes for decisions
CREATE TABLE IF NOT EXISTS session_outcomes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  what_decided     text,
  council_helped   text CHECK (council_helped IN ('yes', 'partially', 'no')),
  additional_notes text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  UNIQUE (session_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_structural_matches_session    ON structural_matches(session_id);
CREATE INDEX IF NOT EXISTS idx_structural_matches_user_email ON structural_matches(user_email);
CREATE INDEX IF NOT EXISTS idx_structural_matches_user_id    ON structural_matches(user_id);
CREATE INDEX IF NOT EXISTS idx_structural_scores_session_a   ON structural_scores(session_id_a);
CREATE INDEX IF NOT EXISTS idx_structural_scores_session_b   ON structural_scores(session_id_b);
CREATE INDEX IF NOT EXISTS idx_session_outcomes_session      ON session_outcomes(session_id);

-- RLS
ALTER TABLE structural_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE structural_scores  ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_outcomes   ENABLE ROW LEVEL SECURITY;

-- Policies — drop first so re-runs don't error
DO $$ BEGIN
  DROP POLICY IF EXISTS "service_role_structural_matches" ON structural_matches;
  DROP POLICY IF EXISTS "service_role_structural_scores"  ON structural_scores;
  DROP POLICY IF EXISTS "service_role_session_outcomes"   ON session_outcomes;
END $$;

CREATE POLICY "service_role_structural_matches" ON structural_matches USING (true) WITH CHECK (true);
CREATE POLICY "service_role_structural_scores"  ON structural_scores  USING (true) WITH CHECK (true);
CREATE POLICY "service_role_session_outcomes"   ON session_outcomes   USING (true) WITH CHECK (true);
