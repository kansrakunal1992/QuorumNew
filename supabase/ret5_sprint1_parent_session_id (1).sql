-- ── RET-5 Sprint 1: Linked Revisit — Foundation ──────────────────────────────
--
-- Adds parent_session_id so a "reanalyze" can be linked back to the session
-- it originated from, instead of creating a fully orphaned session.
--
-- ON DELETE SET NULL (not CASCADE): deleting a session must never cascade-
-- delete its whole revisit chain. A child session is independent — it has
-- its own messages, outcome, and ontology snapshot — and should survive its
-- parent's deletion, just losing the backward link.
--
-- Multi-revisit chains (decision graph) are resolved at query time via a
-- walk on parent_session_id — no separate thread_id table needed for v1.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS parent_session_id uuid REFERENCES sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_parent_session_id
  ON sessions(parent_session_id);
