-- Quorum — Stakeholder Outreach + Chat Connectors (Phase 2 + Phase 3, v2)
-- Adds: a real stakeholder model (people + what they said), and OAuth
-- account storage for Slack and Microsoft Teams. Additive only — no
-- existing table, column, or check constraint is touched.

-- ── 1. Stakeholders ───────────────────────────────────────────────────────────
-- One row per person the user has ever referenced. Upserted by
-- (user_id, lower(name)) from app/api/stakeholder-input/manual/route.ts and
-- the chat-intake checkpoint — a name mentioned in three different sessions
-- is one stakeholder row, not three, so the future "consulted 8 times"
-- network-insight math (plan section 5, deferred past v2) has something
-- real to count.

create table if not exists stakeholders (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid references auth.users on delete cascade not null,
  name              text not null,             -- encrypted at rest, see lib/encryption.ts
  name_lookup       text not null,             -- lower(trim(name)), NOT encrypted — the only way to de-dupe/search without decrypting every row. Holds a name, not a secret; same tradeoff sessions.decision_text's absence of a lookup column doesn't need to make, because sessions are never de-duped by content.
  role              text,                      -- encrypted at rest, e.g. "co-founder", "CFO"
  consult_reason    text
                      check (consult_reason is null or consult_reason in ('expertise', 'challenge', 'approval', 'affected', 'trust')),
  created_at        timestamptz not null default now(),
  last_referenced_at timestamptz not null default now(),
  constraint stakeholders_user_name_unique unique (user_id, name_lookup)
);

create index if not exists idx_stakeholders_user on stakeholders(user_id);

alter table stakeholders enable row level security;
create policy "stakeholders accessible via service role"
  on stakeholders for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ── 2. Stakeholder inputs ─────────────────────────────────────────────────────
-- What a specific person actually said about a specific decision. Deliberately
-- keeps the person's own words (source_text) separate from the user's take on
-- them (user_interpretation) — plan section 15's "Sarah said X" vs "you
-- interpreted Sarah as meaning Y" distinction, enforced by having two columns
-- rather than one free-text field a UI convention could blur.

create table if not exists stakeholder_inputs (
  id                  uuid primary key default uuid_generate_v4(),
  session_id          uuid references sessions on delete cascade not null,
  stakeholder_id      uuid references stakeholders on delete set null,
  channel             text not null
                        check (channel in ('manual', 'whatsapp', 'slack', 'teams', 'email')),
  -- 'sent_via_quorum': Quorum drafted and sent the outreach that prompted this.
  -- 'user_pasted': the user brought in something said outside Quorum entirely
  -- (an existing WhatsApp thread, a Slack message from before this session).
  provenance          text not null
                        check (provenance in ('sent_via_quorum', 'user_pasted')),
  source_text          text not null,           -- encrypted — the person's own words, verbatim
  source_timestamp      timestamptz,             -- when THEY said it, if known — not when Quorum imported it
  source_link           text,                    -- deep link back to the Slack/Teams message, if the channel supports one
  -- AI-extracted, encrypted JSON: { claims: string[], concerns: string[],
  -- evidence: string[], recommendation: string|null, ambiguity: string|null }
  -- See lib/stakeholder-extract.ts. Never a re-statement in Quorum's voice —
  -- every string here should trace back to something in source_text.
  extracted_claims      text,
  user_interpretation   text,                    -- encrypted, optional — the user's OWN gloss on what this means, kept distinct from extracted_claims
  user_agreement         text
                          check (user_agreement is null or user_agreement in ('agree', 'disagree', 'mixed')),
  created_at             timestamptz not null default now()
);

create index if not exists idx_stakeholder_inputs_session     on stakeholder_inputs(session_id);
create index if not exists idx_stakeholder_inputs_stakeholder on stakeholder_inputs(stakeholder_id);

alter table stakeholder_inputs enable row level security;
create policy "stakeholder_inputs accessible via service role"
  on stakeholder_inputs for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ── 3. Connector accounts ─────────────────────────────────────────────────────
-- One row per (user, provider) — a user connects Slack once, Teams once.
-- Tokens are encrypted at rest exactly like everything else sensitive in
-- this schema (see lib/encryption.ts). Re-connecting the same provider
-- upserts this row rather than creating a second one.

create table if not exists connector_accounts (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid references auth.users on delete cascade not null,
  provider            text not null check (provider in ('slack', 'teams')),
  access_token        text not null,             -- encrypted
  refresh_token       text,                       -- encrypted, null if the provider didn't grant one
  token_expires_at    timestamptz,                -- null for a token type that doesn't expire (rare)
  external_account_id text,                       -- Slack: authed_user.id (Uxxxx). Teams: the AAD object id.
  external_team_id    text,                       -- Slack: team.id (Txxxx). Teams: the tenant id.
  workspace_name      text,                       -- display only — "Acme Corp", so the UI can show what's connected
  scopes              text,
  connected_at        timestamptz not null default now(),
  revoked_at          timestamptz,
  constraint connector_accounts_user_provider_unique unique (user_id, provider)
);

create index if not exists idx_connector_accounts_user on connector_accounts(user_id);

alter table connector_accounts enable row level security;
create policy "connector_accounts accessible via service role"
  on connector_accounts for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

comment on column connector_accounts.access_token is
  'Encrypted (lib/encryption.ts). Never sent to the client — every connector API call happens server-side in app/api/connectors/*.';
