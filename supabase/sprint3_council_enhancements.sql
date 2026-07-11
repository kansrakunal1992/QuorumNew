-- QUORUM — Sprint 3: Council page enhancements
-- Safe additive migration — no existing columns or data touched.
-- Run after sprint2b_council_enhancements.sql.

-- O3: cached Decision-Maker Observation line, surfaced below synthesis for Mirror
-- subscribers only. Generated once per session (first request), then served from
-- this column on every subsequent read — avoids re-billing the LLM call per page view.
alter table sessions
  add column if not exists decision_observation text;

comment on column sessions.decision_observation is
  'O3 (Sprint 3): cached one-sentence Decision-Maker Observation, extracted from the
   DECISION_BRIEF prompt''s OBSERVATION section as its own lightweight call. Shown as an
   italic line below the SynthesisCard for Mirror subscribers only (getMirrorAccessState
   === unlocked). Generated on first request via POST /api/session/[id]/observation,
   then served from this cache on every subsequent read.';
