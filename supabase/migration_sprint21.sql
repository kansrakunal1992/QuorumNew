-- Sprint 21 migration: add style_cue column to user_preferences
-- Run once in Supabase SQL editor before deploying Sprint 21.
--
-- style_cue stores the result of the 3-question style calibration.
-- Values: 'direct' | 'challenge' | 'pattern' | 'risk' | 'stakeholder' | 'long'
-- NULL = calibration not yet completed.

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS style_cue TEXT
    CHECK (style_cue IN ('direct','challenge','pattern','risk','stakeholder','long'));
