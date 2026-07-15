-- P1: "What Changed" drawer support — one row per synthesis re-run within a
-- session, capturing the exact verdict/weights/leans at that moment so later
-- synthesis versions can be diffed against the immediately preceding one
-- (doc: "Since the previous synthesis..." reconciliation, weight-delta
-- arrows, advisor lean-flip list, and the version chip history).
--
-- Written by SynthesisCard (via a new lightweight POST endpoint) right after
-- each synthesis stream completes. Read back by app/session/[id]/page.tsx on
-- reload so the drawer survives a page refresh instead of losing history —
-- same reload-resilience pattern already applied to the Examiner context fix.
--
-- weights/leans are NOT sensitive (advisor labels + numeric scores / a
-- proceed|wait|mixed classification) — no encryption needed, unlike
-- verdict_text which is a sentence drawn from the user's actual decision.

create table if not exists synthesis_versions (
  id           uuid primary key default uuid_generate_v4(),
  session_id   uuid references sessions on delete cascade not null,
  version      int not null,             -- matches SynthesisCard's `version` prop (0, 1, 2, ...)
  verdict_text text,                     -- encrypted — the parsed <verdict> sentence
  weights      jsonb,                    -- { persona_key: score } snapshot at this version
  leans        jsonb,                    -- { persona_key: 'proceed'|'wait'|'mixed' } snapshot at this version
  created_at   timestamptz default now() not null,

  constraint synthesis_versions_session_version unique (session_id, version)
);

create index if not exists idx_synthesis_versions_session_id on synthesis_versions(session_id);

alter table synthesis_versions enable row level security;
create policy "Synthesis versions accessible via service role"
  on synthesis_versions for all using (true);
