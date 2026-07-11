-- QUORUM — Sprint W1: Watchlist
-- Run this against your database before deploying, and before setting
-- NEXT_PUBLIC_WATCHLIST_ENABLED=true.
--
-- Deliberately a plain, disconnected table — no ontology_vector, no
-- decision_type_primary, nothing shaped like sessions_ontology, no foreign
-- key into graph_edges. This is intentional, not an oversight: Watchlist is
-- explicitly NOT part of the judgment-intelligence layer (see
-- item3-4plus-sessions-pov-plan.md and the Watchlist design discussion) —
-- keeping its schema structurally distant from sessions_ontology/graph_edges
-- makes it hard for a future change to accidentally wire it into the graph,
-- the same way an earlier audit pass found several places where two
-- similarly-shaped tables got confused for each other (matches_json /
-- structural_matches, contradiction_log / contradictions). A table that
-- looks nothing alike can't be confused for one.
--
-- text_encrypted follows the same encrypt-at-rest pattern as
-- sessions.decision_text (see lib/encryption.ts) — Watchlist entries are
-- often exactly the kind of sensitive personal/financial/family content this
-- app already treats carefully everywhere else.

create table if not exists watchlist_items (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  text_encrypted        text not null,
  tag                   text check (tag in (
                          'business', 'wealth', 'career',
                          'family', 'relationship', 'other'
                        )),
  status                text not null default 'open'
                          check (status in ('open', 'graduated', 'archived')),
  created_at            timestamp with time zone not null default now(),
  graduated_at          timestamp with time zone,
  archived_at           timestamp with time zone
);

create index if not exists idx_watchlist_items_user_status
  on watchlist_items (user_id, status);

comment on table watchlist_items is
  'Sprint W1 — lightweight, low-friction notes. Explicitly NOT analyzed by the Council, NOT part of the Decision Graph or any bias/pattern engine. The only bridge into the judgment record is graduating an item into a full, ordinary session (see app/api/watchlist/[id]/graduate) — never a partial or automatic promotion.';
