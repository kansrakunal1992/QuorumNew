-- supabase/add_context_ingestion.sql
-- ── Context Ingestion (Elite) ────────────────────────────────────────────────
--
-- Optional, Elite-gated onboarding accelerant: user imports a ChatGPT/Claude
-- export or types a self-description, we extract a small set of distilled,
-- structured "memory facts", and the raw text is never persisted anywhere —
-- it lives only in the request's memory for the duration of the extraction
-- call. raw_purged_at is written the instant extraction returns, atomically
-- with insights_extracted, and is the UI's proof-of-deletion timestamp.
--
-- Named `context_ingestion` (not `context_imports`) because future sources
-- (LinkedIn, resume, journal) are expected — the table shouldn't need a
-- rename when they arrive.
--
-- One row per user for the lifetime of the account (unique(user_id)) — the
-- row is never hard-deleted, even on "Forget imported context", because
-- last_ingested_at + reimport_count drive the 30-day reimport cooldown and
-- must survive a forget. Only user_memory_facts rows (the actual retained
-- content) are hard-deleted on forget.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists vector;

create table if not exists context_ingestion (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null unique references auth.users(id) on delete cascade,

  source_type             text not null
                          check (source_type in ('chatgpt','claude','manual','pasted_summary')),

  -- uploaded            → raw text received, not yet processed
  -- analyzing           → extraction call in flight
  -- insights_extracted  → extraction returned; raw_purged_at set atomically
  -- review_pending      → candidate facts inserted, awaiting user accept/edit/reject
  -- saved               → user confirmed; user_memory_facts rows finalized
  -- failed              → extraction or embedding call errored; see error_message
  -- forgotten           → user hit "Forget imported context"; facts hard-deleted
  status                  text not null default 'uploaded'
                          check (status in ('uploaded','analyzing','insights_extracted',
                                             'review_pending','saved','failed','forgotten')),

  char_count              int,               -- metadata only — never the content itself
  error_message           text,
  extraction_model        text,
  retry_count             int not null default 0,

  product_tier_at_import  text,              -- snapshot for billing/audit trail
  reimport_count          int not null default 0,

  processed_at            timestamptz,
  raw_purged_at            timestamptz,       -- proof-of-deletion; drives the 4th progress-bar tick
  last_ingested_at        timestamptz,       -- start of most recent fresh ingestion — 30-day cooldown clock

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create table if not exists user_memory_facts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  ingestion_id      uuid references context_ingestion(id) on delete set null,

  category          text not null
                    check (category in ('goal','value','constraint','decision_pattern',
                                         'communication_style','relationship',
                                         'long_term_context','other')),

  insight_text      text not null,   -- ENCRYPTED at the application layer (lib/encryption.ts)
  confidence        numeric not null check (confidence >= 0 and confidence <= 1),
  importance        numeric not null check (importance >= 0 and importance <= 1),
  embedding         vector(1536),    -- text-embedding-3-small; null if embedding call failed (degrades gracefully)

  source            text not null
                    check (source in ('chatgpt','claude','manual','pasted_summary')),

  -- proposed → candidate shown in review screen, not yet acted on
  -- accepted → kept as extracted
  -- edited   → kept with user-modified text
  -- rejected → dropped, never enters Council context
  status            text not null default 'proposed'
                    check (status in ('proposed','accepted','edited','rejected')),

  last_confirmed_at timestamptz not null default now(),  -- freshness clock — age computed at read time

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_user_memory_facts_user_status
  on user_memory_facts (user_id, status);

create index if not exists idx_user_memory_facts_ingestion
  on user_memory_facts (ingestion_id);

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Same convention as sessions/user_profiles: users read/write only their own
-- rows; the extraction pipeline runs server-side via createServiceClient()
-- (bypasses RLS), same as every other write-heavy background job in this codebase.

alter table context_ingestion   enable row level security;
alter table user_memory_facts   enable row level security;

create policy "context_ingestion_select_own" on context_ingestion
  for select using (auth.uid() = user_id);

create policy "user_memory_facts_select_own" on user_memory_facts
  for select using (auth.uid() = user_id);

-- No insert/update/delete policies for authenticated users — all writes go
-- through API routes using the service-role client, which enforces the
-- Elite gate, cooldown, and review-state transitions server-side. This
-- mirrors context_ingestion's own sensitivity: a client-side write path
-- here would let a user bypass the accept/edit/reject review step.

comment on table context_ingestion is
  'One row per user. Tracks the lifecycle of an optional Elite context-import (never the raw content itself). See lib/context-extractor.ts, app/api/context-ingestion/route.ts.';
comment on table user_memory_facts is
  'Distilled, user-reviewed insights extracted from an optional context import. insight_text is encrypted at the application layer. Injected into Council prompts via lib/foundational-context.ts as a distinct layer from Decision History and Mirror.';
