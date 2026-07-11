-- QUORUM — Sprint QW-3: Graph nudge state for 6+ session users
-- Run this against your database before deploying the graph-nudge endpoint.
--
-- Two columns on user_preferences:
--   last_graph_nudge_shown_at — timestamp of the last time either the
--     "new connection" (Option A) or "milestone" (Option C) graph nudge was
--     shown to this user. Powers two things at once: the cooldown (don't
--     show again within COOLDOWN_HOURS) and, for Option A, the "since when"
--     cursor for detecting a genuinely NEW edge rather than any edge.
--   last_graph_milestone_shown — the highest edge-count milestone already
--     celebrated for this user (Option C, veteran users only). Prevents
--     re-showing the same milestone on every session once crossed.
--
-- Both nullable, both default null — a user who has never seen either nudge
-- has null in both, which the application code treats as "show if eligible"
-- (no prior nudge to cool down against, no milestone yet celebrated).

alter table user_preferences
  add column if not exists last_graph_nudge_shown_at timestamp with time zone;

alter table user_preferences
  add column if not exists last_graph_milestone_shown integer;

comment on column user_preferences.last_graph_nudge_shown_at is
  'Sprint QW-3: last time the SessionView graph nudge (new-connection or milestone variant) was shown. Drives cooldown + new-edge-since cursor.';

comment on column user_preferences.last_graph_milestone_shown is
  'Sprint QW-3: highest total-edge-count milestone already celebrated for this user (veteran/Option C nudge only).';
