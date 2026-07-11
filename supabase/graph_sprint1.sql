-- ─────────────────────────────────────────────────────────────────────────────
-- QUORUM — Decision Graph Sprint 1: graph_edges table
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- Run AFTER: sprint1_add_ledger_tables.sql (depends on sessions table)
--
-- Decision Graph architecture (4-sprint plan):
--   Sprint 1 (this file): schema + backfill engine — data layer, no UI
--   Sprint 2: query API + corpus gate + curation endpoints
--   Sprint 3: d3-force Mirror UI (visual distinction: computed vs user_asserted)
--   Sprint 4: synthesis integration (feed cluster/lineage into persona-relevance)
--
-- Edge types:
--   structural_similarity  — computed: cosine similarity across 14 ontology dims
--   contradiction          — computed: from contradiction_log (principle vs violation)
--   shared_bias_trigger    — computed: both sessions triggered the same bias parameter
--   shared_decision_type   — computed: same decision_type_primary from sessions_ontology
--   user_asserted          — user-authored one-sentence causal/narrative link
--
-- Encryption:
--   explanation_text is raw user input → AES-256-GCM encrypted (same as decision_text).
--   All other fields are derived/computed and excluded from encryption (same policy
--   as sessions_ontology, bias_library, structural_scores per lib/encryption.ts).
--
-- Pair canonicalisation:
--   Computed edges are undirected. session_id_a < session_id_b (UUID lexicographic
--   order) is enforced by lib/graph-engine.ts before every upsert so the unique
--   constraint on (session_id_a, session_id_b, edge_type) covers only one row per
--   pair per type. user_asserted edges may have direction (Sprint 2 will handle
--   this); for now the same canonicalisation applies.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists graph_edges (
  id                  uuid primary key default uuid_generate_v4(),

  -- Identity — always required, strictly per-user (graph is personal, not cross-user)
  user_id             uuid not null references auth.users on delete cascade,

  -- The two sessions connected by this edge (canonicalised: session_id_a < session_id_b)
  session_id_a        uuid not null references sessions on delete cascade,
  session_id_b        uuid not null references sessions on delete cascade,

  -- Edge classification
  edge_type           text not null check (
    edge_type in (
      'structural_similarity',
      'contradiction',
      'shared_bias_trigger',
      'shared_decision_type',
      'user_asserted'
    )
  ),

  -- Strength of computed edge (null for user_asserted):
  --   structural_similarity → raw cosine similarity (0.0–1.0)
  --   contradiction         → 1.0 (binary)
  --   shared_bias_trigger   → confidence_weight from bias_library (0.3–1.0)
  --   shared_decision_type  → 1.0 (categorical match, no gradient)
  strength            numeric(5, 3),

  -- Explainability payload for structural_similarity edges (Sprint 3 UI reads this):
  --   { vector_similarity: number, total: number,
  --     top_matching_dims: string[], scoring_mode: 'vector'|'categorical' }
  -- null for all other edge types.
  dimension_breakdown jsonb,

  -- User-authored annotation (user_asserted edges only). Raw user input →
  -- stored encrypted (enc:<iv>:<authTag>:<ciphertext>, same format as decision_text).
  -- null for all computed edge types.
  explanation_text    text,

  -- Edge-type-specific structured metadata:
  --   structural_similarity  → null (dimension_breakdown carries the signal)
  --   contradiction          → { "contradiction_id": "<uuid>" }
  --   shared_bias_trigger    → { "bias_parameters": ["fomo", "overconfidence", ...] }
  --   shared_decision_type   → { "decision_type": "commitment" }
  --   user_asserted          → null (free-text explanation_text carries the signal)
  metadata            jsonb,

  -- User dismissed this edge in the Mirror Graph UI (Sprint 3).
  -- Dismissed edges are excluded from graph traversal in Sprint 4 synthesis.
  dismissed_at        timestamptz,

  -- When this edge was computed or last updated.
  computed_at         timestamptz not null default now(),

  -- One row per pair per type. Combined with pair canonicalisation in
  -- lib/graph-engine.ts, this enforces a single undirected edge per
  -- (session_pair, edge_type) combination. Note: a pair can have multiple
  -- edge types simultaneously (e.g. structural_similarity + contradiction).
  constraint graph_edges_pair_type unique (session_id_a, session_id_b, edge_type)
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

-- Primary traversal: all edges for a user (Sprint 2 graph query API)
create index if not exists idx_graph_edges_user_id
  on graph_edges(user_id);

-- Session-centric lookups: all edges touching a given session
-- (Sprint 3 node click → related sessions)
create index if not exists idx_graph_edges_session_a
  on graph_edges(session_id_a);
create index if not exists idx_graph_edges_session_b
  on graph_edges(session_id_b);

-- Filter by type within a user's graph (Sprint 2 query API type filter)
create index if not exists idx_graph_edges_user_type
  on graph_edges(user_id, edge_type);

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Service role only (same policy as sessions_ontology, bias_library,
-- structural_scores, contradiction_log — all derived/enrichment tables).
-- All graph reads/writes go through API routes using createServiceClient().

alter table graph_edges enable row level security;

create policy "Graph edges accessible via service role"
  on graph_edges for all
  using (true);
