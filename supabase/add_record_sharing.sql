-- Record sharing — public read-only link ("Share my decision")
-- Adds an opt-in, revocable public link per session. Nothing is public by
-- default: is_shared must be explicitly flipped true by the owner via
-- POST /api/record/[id]/share, and the public route only ever reads
-- decision_text, context_text, and the latest synthesis verdict — never
-- persona debate, bias/mirror data, or any other user's info.

alter table sessions add column if not exists share_token uuid;
alter table sessions add column if not exists is_shared boolean not null default false;
alter table sessions add column if not exists shared_at timestamptz;

-- Partial unique index — only enforced once a token exists, so nulls
-- (the overwhelming majority of rows) never collide.
create unique index if not exists idx_sessions_share_token
  on sessions(share_token) where share_token is not null;

-- No RLS policy needed for the public read path: the public share route
-- uses the service-role client (bypasses RLS) and filters explicitly on
-- is_shared = true, so an unshared session's token (if ever guessed) still
-- returns nothing.
