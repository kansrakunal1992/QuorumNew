-- ─────────────────────────────────────────────────────────────────
-- QUORUM — Sprint 5: Structural Retrieval Schema
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- Run AFTER: schema.sql, sprint1_add_ledger_tables.sql, sprint6_auth.sql
-- ─────────────────────────────────────────────────────────────────

-- ── 1. structural_matches cache table ────────────────────────────
-- Caches computed structural matches per session so we don't re-score
-- on every page load. Invalidated automatically if the session's
-- ontology tag is updated (tagger re-run).

create table if not exists structural_matches (
  id                  uuid primary key default uuid_generate_v4(),
  session_id          uuid references sessions on delete cascade not null unique,
  user_email          text,
  user_id             uuid references auth.users on delete set null,
  computed_at         timestamptz default now() not null,

  -- Cached retrieval results
  context_block       text,           -- ready-to-inject prompt block
  matches_json        jsonb,          -- array of StructuralMatch objects
  session_count_used  int default 0,  -- how many past sessions were scored
  threshold_met       boolean default false,

  -- Match quality metadata
  top_match_score     int,            -- highest structural score found (0–100)
  top_match_session_id uuid references sessions on delete set null
);

create index if not exists idx_structural_matches_session_id on structural_matches(session_id);
create index if not exists idx_structural_matches_user_email  on structural_matches(user_email);
create index if not exists idx_structural_matches_user_id     on structural_matches(user_id);

alter table structural_matches enable row level security;
create policy "Structural matches accessible via service role"
  on structural_matches for all using (auth.role() = 'service_role');

-- ── 2. Add user_email column to sessions_ontology ────────────────
-- Denormalized for faster query without always joining sessions.
-- Populated by the structural match route.

alter table sessions_ontology
  add column if not exists user_email text;

-- ── 3. Index for fast "past sessions by user" queries ────────────
-- Core query in structural match endpoint:
-- WHERE tagger_status = 'complete' AND user_email = $1 AND session_id != $2

create index if not exists idx_sessions_user_email_status
  on sessions(user_email, id)
  where user_email is not null;

-- ── 4. session_outcomes table ─────────────────────────────────────
-- Stores post-decision outcome logging per session.
-- Separating from sessions table keeps the core table lean.
-- Referenced in structural retrieval to show what was decided in past matches.

create table if not exists session_outcomes (
  id                uuid primary key default uuid_generate_v4(),
  session_id        uuid references sessions on delete cascade not null unique,
  logged_at         timestamptz default now() not null,

  -- What was decided
  what_decided      text not null,       -- free text: "Decided to proceed with the PE deal"
  council_helped    text not null        -- yes | partially | no
    check (council_helped in ('yes', 'partially', 'no')),

  -- Optional reflection
  outcome_notes     text,                -- what happened after (populated later)
  outcome_logged_at timestamptz          -- when the actual outcome was logged

  -- Note: outcome quality tracking (was the council right?) is Sprint 7 Mirror territory
);

create index if not exists idx_session_outcomes_session_id on session_outcomes(session_id);

alter table session_outcomes enable row level security;
create policy "Session outcomes accessible via service role"
  on session_outcomes for all using (auth.role() = 'service_role');

-- ── 5. Structural similarity scores table ─────────────────────────
-- Stores pairwise structural scores for analytics and Mirror module.
-- Populated as a side effect of the structural match computation.
-- Allows Mirror to show "your most structurally recurring decision type"
-- without re-scoring every time.

create table if not exists structural_scores (
  id                    uuid primary key default uuid_generate_v4(),
  computed_at           timestamptz default now() not null,

  session_id_a          uuid references sessions on delete cascade not null,
  session_id_b          uuid references sessions on delete cascade not null,
  user_email            text,

  -- Scores
  total_score           int not null,   -- 0–100
  decision_type_score   int,            -- 0–30
  register_score        int,            -- 0–25
  stakes_score          int,            -- 0–20
  counterparty_score    int,            -- 0–15
  time_pressure_score   int,            -- 0–10

  -- Annotation (from Haiku call)
  annotation            text,

  constraint structural_scores_pair unique (session_id_a, session_id_b)
);

create index if not exists idx_structural_scores_session_a on structural_scores(session_id_a);
create index if not exists idx_structural_scores_session_b on structural_scores(session_id_b);
create index if not exists idx_structural_scores_user_email on structural_scores(user_email);
create index if not exists idx_structural_scores_total on structural_scores(total_score desc);

alter table structural_scores enable row level security;
create policy "Structural scores accessible via service role"
  on structural_scores for all using (auth.role() = 'service_role');
