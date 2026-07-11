-- supabase/sprint9_contradictions.sql
-- ── Sprint 9: Contradiction Detector ────────────────────────────────────────
-- Run after sprint7c_independence_constraint.sql

CREATE TABLE IF NOT EXISTS contradictions (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- The stated principle (what the user said they believe / how they decide)
  principle_text       text        NOT NULL,
  principle_session_id uuid        REFERENCES sessions(id) ON DELETE SET NULL,
  principle_source     text,       -- 'examiner' | 'pushback' — where it was extracted from

  -- The contradicting action/framing (what they actually did in a later decision)
  violation_text       text        NOT NULL,
  violation_session_id uuid        REFERENCES sessions(id) ON DELETE SET NULL,
  violation_source     text,       -- 'examiner' | 'pushback' | 'decision_text'

  -- Metadata
  severity             text        NOT NULL DEFAULT 'notable',
  -- 'sharp'   — direct logical contradiction between stated and done
  -- 'notable' — meaningful tension, not absolute contradiction
  -- 'forming' — early signal, only 2 sessions, treat as tentative

  category             text,
  -- e.g. 'risk_tolerance' | 'urgency' | 'stakeholder' | 'reversibility' | 'process'

  generated_at         timestamptz NOT NULL DEFAULT now(),
  dismissed_at         timestamptz,          -- user can dismiss; NULL = active

  -- Prevent duplicate pairs for same user
  UNIQUE(user_id, principle_session_id, violation_session_id)
);

-- Index for fast user lookups (Mirror page load)
CREATE INDEX IF NOT EXISTS idx_contradictions_user_active
  ON contradictions(user_id, dismissed_at)
  WHERE dismissed_at IS NULL;

-- Track last detection run per user (avoids rerunning every session)
CREATE TABLE IF NOT EXISTS contradiction_runs (
  user_id    uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ran_at     timestamptz NOT NULL DEFAULT now(),
  session_count_at_run int
);

-- RLS: users can only read/update their own rows
ALTER TABLE contradictions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE contradiction_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contradictions_own" ON contradictions
  USING (user_id = auth.uid());

CREATE POLICY "contradiction_runs_own" ON contradiction_runs
  USING (user_id = auth.uid());
