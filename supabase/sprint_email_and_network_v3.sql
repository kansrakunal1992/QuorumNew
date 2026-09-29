-- Quorum — Outlook + Gmail + WhatsApp Share-In + Network Insights (Phase 4 + 5, v3)
-- Additive only. Widens one existing check constraint (documented below,
-- not a data-breaking change) and adds one nullable column.

-- ── 1. Widen connector_accounts to the two email providers ──────────────────
-- Postgres has no "alter check constraint" — drop and recreate by the same
-- name. Every existing row (slack/teams) already satisfies the new,
-- broader list, so this is safe to run against live data.
alter table connector_accounts drop constraint if exists connector_accounts_provider_check;
alter table connector_accounts add constraint connector_accounts_provider_check
  check (provider in ('slack', 'teams', 'gmail', 'outlook'));

-- ── 2. Stakeholder network insights ──────────────────────────────────────────
-- Set once, retroactively, when the session this input belongs to gets a
-- locked decision (app/api/session/[id]/decide and
-- app/api/chat-intake/done both now do this — see lib/stakeholder-network.ts).
-- null until then: "not yet known," never "no."
alter table stakeholder_inputs
  add column if not exists reflected_in_decision boolean;

comment on column stakeholder_inputs.reflected_in_decision is
  'Whether this input''s claims/recommendation appear to match the session''s eventual decision. Computed once, at decision-lock time (see lib/stakeholder-network.ts) — never re-evaluated, so a later correction to the decision does not retroactively rewrite history.';

create index if not exists idx_stakeholder_inputs_reflected on stakeholder_inputs(stakeholder_id, reflected_in_decision);
