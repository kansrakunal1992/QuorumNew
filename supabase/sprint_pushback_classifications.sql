-- ─────────────────────────────────────────────────────────────────────────────
-- Sprint — Pushback Classification Capture
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Every persona already classifies each pushback internally (Step 1 of the
-- pushback protocol, lib/personas.ts) as weak | partially_valid |
-- materially_valid | recommendation_changing — but that classification has
-- never been persisted anywhere; it only ever shaped the model's prose for
-- that single reply, then was discarded. This table captures it, enabling
-- the cross-session "which advisors most often change your mind" aggregate
-- (lib/mind-change-patterns.ts) and its corresponding weighting boost.
--
-- No decision content is stored here — persona_key + a four-value enum only.
-- Nothing sensitive, nothing encrypted-at-rest needed.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists pushback_classifications (
  id             uuid primary key default uuid_generate_v4(),
  session_id     uuid references sessions on delete cascade not null,
  persona_key    text not null
    check (persona_key in ('contrarian', 'risk_architect', 'pattern_analyst',
                            'stakeholder_mirror', 'elder', 'competitor')),
  classification text not null
    check (classification in ('weak', 'partially_valid', 'materially_valid',
                               'recommendation_changing')),
  user_id        uuid,
  user_email     text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_pushback_classifications_session
  on pushback_classifications(session_id);

-- The aggregation query (lib/mind-change-patterns.ts) groups by user across
-- ALL of that user's sessions, not per-session — this is the index that
-- query actually needs.
create index if not exists idx_pushback_classifications_user
  on pushback_classifications(user_id, user_email);

alter table pushback_classifications enable row level security;

create policy "Pushback classifications accessible via service role"
  on pushback_classifications for all using (auth.role() = 'service_role');

comment on table pushback_classifications is
  'Persists each pushback classification (previously computed internally and
   discarded every time). Powers cross-session "which advisors change your
   mind" pattern detection. No decision content — persona + enum only.';
