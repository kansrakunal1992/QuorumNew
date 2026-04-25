-- ─────────────────────────────────────────────────────────────────
-- QUORUM LEDGER — Sprint 1: Ontology Tagger Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ─────────────────────────────────────────────────────────────────

-- ── Decision Ontology Table ──────────────────────────────────────
-- One row per session. Populated async after session creation.
-- All fields are nullable — tagger may fail gracefully.

create table if not exists sessions_ontology (
  id                    uuid primary key default uuid_generate_v4(),
  session_id            uuid references sessions on delete cascade not null unique,
  created_at            timestamptz default now() not null,
  tagger_version        text default 'v1.0',    -- for future schema migrations

  -- Dimension 1: Decision Type
  decision_type_primary text,   -- commitment|allocation|transition|acquisition|renunciation|governance|delegation
  decision_type_secondary text[], -- array of secondary types

  -- Dimension 2: Stakes Architecture
  stakes_reversibility  text,   -- full|partial|irreversible
  stakes_bearer         text,   -- self|family|organisation|third-parties
  stakes_timeline       text,   -- immediate|1-3yr|5yr+|generational

  -- Dimension 3: Time Pressure
  has_stated_deadline   boolean,
  deadline_source       text,   -- self|counterparty|external|none
  deadline_credibility  text,   -- high|medium|low|none

  -- Dimension 4: Information Completeness
  known_unknowns_surfaced boolean,
  unknown_unknown_categories text[], -- counterparty_health|regulatory|market|family|execution|succession

  -- Dimension 5: Counterparty
  counterparty_present  boolean,
  counterparty_alignment text,  -- aligned|partial|misaligned|unknown
  info_asymmetry        text,   -- favor_dm|equal|favor_counterparty|unknown
  relationship_type     text,   -- transactional|relational|fiduciary|adversarial

  -- Dimension 6: Emotional Signature
  dominant_emotion      text,   -- anxiety|excitement|obligation|ambivalence|urgency|resignation
  emotion_source        text,   -- self|external
  emotion_analysis_aligned boolean,

  -- Dimension 7: Stakeholder Complexity
  stakeholder_count     text,   -- 1|2-3|4+
  hidden_stakeholder_probability text, -- low|medium|high

  -- Dimension 8: Decision Register (0.0–1.0 weights summing to 1.0)
  instrumental_weight   numeric(3,2),  -- 0.0 to 1.0
  constitutive_weight   numeric(3,2),  -- 0.0 to 1.0

  -- Dimension 9: Examiner Priority Gaps
  -- The 3 most critical unknown unknowns — Examiner Phase 1 will ask about these
  examiner_gap_1        text,
  examiner_gap_2        text,
  examiner_gap_3        text,

  -- Raw JSON from tagger (for debugging and future schema evolution)
  raw_ontology_json     jsonb,

  -- Tagger status
  tagger_status         text default 'pending' check (tagger_status in ('pending', 'complete', 'failed'))
);

create index if not exists idx_sessions_ontology_session_id on sessions_ontology(session_id);
create index if not exists idx_sessions_ontology_decision_type on sessions_ontology(decision_type_primary);
create index if not exists idx_sessions_ontology_register on sessions_ontology(instrumental_weight, constitutive_weight);

alter table sessions_ontology enable row level security;

-- Service role bypasses RLS — accessible via service key in API routes
create policy "Ontology accessible via service role"
  on sessions_ontology for all
  using (true);

-- ── Examiner Responses Table ─────────────────────────────────────
-- Stores user answers to Examiner Phase 1 diagnostic questions.
-- Three questions per session max.

create table if not exists examiner_responses (
  id                    uuid primary key default uuid_generate_v4(),
  session_id            uuid references sessions on delete cascade not null,
  created_at            timestamptz default now() not null,

  question_text         text not null,
  response_text         text,             -- null if user skipped
  bias_parameter_probed text,             -- which bias this question targets
  unknown_unknown_gap   text,             -- which ontology gap triggered this question
  question_order        int not null,     -- 1, 2, or 3

  constraint examiner_responses_session_order unique (session_id, question_order)
);

create index if not exists idx_examiner_session_id on examiner_responses(session_id);

alter table examiner_responses enable row level security;
create policy "Examiner responses accessible via service role"
  on examiner_responses for all using (true);

-- ── Bias Library Table ───────────────────────────────────────────
-- One row per (user_id, bias_parameter) combination.
-- Populated by background scoring job (Sprint 4).
-- user_id is nullable — keyed to email if no auth.

create table if not exists bias_library (
  id                    uuid primary key default uuid_generate_v4(),
  session_ids           uuid[],           -- sessions that contributed to this entry
  user_email            text,             -- identifier until auth is added
  bias_parameter        text not null,    -- fomo|overconfidence|attribution_asymmetry|etc
  created_at            timestamptz default now() not null,
  updated_at            timestamptz default now() not null,

  -- Scoring
  detection_count       int default 0,    -- how many times detected
  confidence_weight     numeric(3,2) default 0.30, -- 0.3 per detection, max 1.0
  asymmetry_score_avg   numeric(4,2),     -- average prosecutor-defense asymmetry

  -- Conditional fingerprint — when does this bias activate?
  activation_contexts   jsonb,            -- {decision_type: [...], pressure: [...], etc}

  -- Outcome calibration
  outcome_confirmed_count int default 0,
  outcome_disconfirmed_count int default 0,

  constraint bias_library_user_param unique (user_email, bias_parameter)
);

alter table bias_library enable row level security;
create policy "Bias library accessible via service role"
  on bias_library for all using (true);

-- ── Contradiction Log Table ──────────────────────────────────────
-- Populated by weekly background contradiction detector (Sprint 5+).

create table if not exists contradiction_log (
  id                    uuid primary key default uuid_generate_v4(),
  user_email            text,
  detected_at           timestamptz default now() not null,
  session_id_principle  uuid references sessions on delete cascade, -- where principle was stated
  session_id_violation  uuid references sessions on delete cascade, -- where it was violated
  principle_text        text,             -- the extracted principle
  violation_description text,            -- how the later decision violated it
  surfaced_to_user      boolean default false, -- has the user been shown this?
  dismissed_by_user     boolean default false
);

alter table contradiction_log enable row level security;
create policy "Contradiction log accessible via service role"
  on contradiction_log for all using (true);
