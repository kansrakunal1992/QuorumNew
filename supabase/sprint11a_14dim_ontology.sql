-- ============================================================
-- QUORUM — Sprint 11a Migration
-- 14-Dimensional Ontology Vector + Calibration Infrastructure
-- Run in Supabase SQL Editor (Production)
-- Safe to run on existing data — all ADD COLUMN IF NOT EXISTS
-- ============================================================

-- ── 1. sessions_ontology: add scored vector + rule engine result ──────────────

ALTER TABLE public.sessions_ontology
  ADD COLUMN IF NOT EXISTS ontology_vector     JSONB NULL,
  ADD COLUMN IF NOT EXISTS rule_engine_result  JSONB NULL;

-- ontology_vector structure (stored per session):
-- {
--   "reversibility":               { "score": 1-5, "confidence": 0.0-1.0, "rationale": "..." },
--   "time_horizon":                { "score": 1-5, "confidence": 0.0-1.0, "rationale": "..." },
--   "stakes_magnitude":            { "score": 1-5, "confidence": 0.0-1.0, "rationale": "..." },
--   "outcome_uncertainty":         { "score": 1-5, "confidence": 0.0-1.0, "rationale": "..." },
--   "value_conflict":              { "score": 1-5, "confidence": 0.0-1.0, "rationale": "..." },
--   "identity_alignment":          { "score": 1-5, "confidence": 0.0-1.0, "rationale": "..." },
--   "regret_asymmetry":            { "score": 1-5, "confidence": 0.0-1.0, "rationale": "..." },
--   "upstream_dependency":         { "score": 1-5, "confidence": 0.0-1.0, "rationale": "..." },
--   "ambiguity":                   { "score": 1-5, "confidence": 0.0-1.0, "rationale": "..." },
--   "task_complexity":             { "score": 1-5, "confidence": 0.0-1.0, "rationale": "..." },
--   "decision_discriminating_info":{ "score": 1-5, "confidence": 0.0-1.0, "rationale": "..." },
--   "time_pressure":               { "score": 1-5, "confidence": 0.0-1.0, "rationale": "..." },
--   "decision_unit":               { "score": 1-5, "confidence": 0.0-1.0, "rationale": "..." },
--   "emotional_intensity":         { "score": 1-5, "confidence": 0.0-1.0, "rationale": "..." },
--   "vector_version": "v2.0"
-- }

-- rule_engine_result structure:
-- {
--   "mode": "REDIRECT" | "GATE" | "OPEN",
--   "triggered_rules": [
--     { "rule_id": "R1", "mode": "REDIRECT", "question": "...", "dimension": "upstream_dependency", "score": 5 }
--   ],
--   "evaluated_at": "ISO timestamp"
-- }

-- GIN index for vector queries (future pattern detection)
CREATE INDEX IF NOT EXISTS idx_sessions_ontology_vector
  ON public.sessions_ontology USING GIN (ontology_vector)
  WHERE ontology_vector IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_ontology_rule_engine
  ON public.sessions_ontology USING GIN (rule_engine_result)
  WHERE rule_engine_result IS NOT NULL;

-- ── 2. sessions: add pre-decision confidence ──────────────────────────────────

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS pre_decision_confidence INTEGER NULL;

ALTER TABLE public.sessions
  DROP CONSTRAINT IF EXISTS sessions_pre_decision_confidence_check;

ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_pre_decision_confidence_check
    CHECK (pre_decision_confidence IS NULL OR (pre_decision_confidence >= 1 AND pre_decision_confidence <= 10));

CREATE INDEX IF NOT EXISTS idx_sessions_pre_decision_confidence
  ON public.sessions (pre_decision_confidence)
  WHERE pre_decision_confidence IS NOT NULL;

-- ── 3. outcomes: add calibration fields ──────────────────────────────────────

ALTER TABLE public.outcomes
  ADD COLUMN IF NOT EXISTS outcome_quality          TEXT    NULL,
  ADD COLUMN IF NOT EXISTS retrospective_confidence INTEGER NULL,
  ADD COLUMN IF NOT EXISTS calibration_delta        NUMERIC NULL;

ALTER TABLE public.outcomes
  DROP CONSTRAINT IF EXISTS outcomes_outcome_quality_check;

ALTER TABLE public.outcomes
  ADD CONSTRAINT outcomes_outcome_quality_check
    CHECK (
      outcome_quality IS NULL OR
      outcome_quality = ANY (ARRAY[
        'better_than_expected',
        'as_expected',
        'worse_than_expected',
        'too_early'
      ])
    );

ALTER TABLE public.outcomes
  DROP CONSTRAINT IF EXISTS outcomes_retrospective_confidence_check;

ALTER TABLE public.outcomes
  ADD CONSTRAINT outcomes_retrospective_confidence_check
    CHECK (
      retrospective_confidence IS NULL OR
      (retrospective_confidence >= 1 AND retrospective_confidence <= 10)
    );

-- calibration_delta = pre_decision_confidence - retrospective_confidence
-- Positive = overconfident. Negative = underconfident. Near 0 = well-calibrated.
-- Computed and written by the outcome submission API.

CREATE INDEX IF NOT EXISTS idx_outcomes_outcome_quality
  ON public.outcomes (outcome_quality)
  WHERE outcome_quality IS NOT NULL;

-- ── 4. examiner_responses: add rule_id ───────────────────────────────────────

ALTER TABLE public.examiner_responses
  ADD COLUMN IF NOT EXISTS rule_id TEXT NULL;
  -- Values: 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8' | 'R9' | 'R10' | 'R11' | 'R12'
  -- NULL for gap-based questions from v1.0 tagger (backward compat)
  -- Set for rule-engine-derived questions from v2.0 tagger

-- ── 5. Verification queries (run after migration to confirm) ──────────────────

-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'sessions_ontology'
--   AND column_name IN ('ontology_vector', 'rule_engine_result')
-- ORDER BY column_name;

-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'sessions'
--   AND column_name = 'pre_decision_confidence';

-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'outcomes'
--   AND column_name IN ('outcome_quality', 'retrospective_confidence', 'calibration_delta')
-- ORDER BY column_name;

-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'examiner_responses'
--   AND column_name = 'rule_id';
