-- supabase/add_context_ingestion_mistral_embed.sql
-- ── Context Ingestion — switch embeddings to Mistral ─────────────────────────
--
-- mistral-embed produces 1024-dim vectors, not OpenAI's 1536 — pgvector
-- enforces the column's declared dimension exactly, so the column has to be
-- resized, not just the application code swapped.
--
-- USING NULL clears any existing embeddings as part of the type change —
-- unavoidable, since a stored 1536-dim vector can't be reinterpreted as
-- 1024-dim. This is a one-time reset of the numeric vectors only: every
-- accepted fact's actual insight_text/category/confidence/importance is
-- untouched, nothing is deleted, and lib/embeddings.ts already treats a null
-- embedding as "skip dedup / semantic retrieval for this fact" rather than
-- an error — the app keeps working through this, just without those two
-- features for existing facts until they're naturally re-embedded (a fresh
-- import, or a reanalyze that touches embeddings — note the current
-- reanalyze/apply route does NOT recompute embeddings on update, so an
-- existing fact's embedding stays null until its next full reimport).
-- ─────────────────────────────────────────────────────────────────────────────

alter table user_memory_facts
  alter column embedding type vector(1024) using null;
