-- Natural Intake v13 — "pre-tag": classify the decision while the person is still on the confirm screen.
--
-- WHY: after "Convene the Council" the person waited for the ontology tagger (one model call, several seconds) before
-- the Examiner's questions could be known. The tagger only needs the decision text and context, both of which exist
-- before the session does. So the confirm screen asks the server to run it early and park the result on the CHAT
-- (chat_intakes), and when the session is created the ontology route uses that result instead of calling the model.
--
-- WHY NOT A DRAFT SESSION: a session row created "early" would be visible to every query that reads `sessions`
-- (counts, history, Mirror, the graph, crons, exports...) — dozens of places — for everyone who looks at the confirm
-- screen and leaves. This design adds NOTHING to `sessions`; the only table touched is chat_intakes, and only
-- the code in this change reads these columns.
--
-- Safe to run before OR after deploying the code: every read/write of these columns is guarded and the whole feature is
-- off unless NEXT_PUBLIC_PRETAG_ENABLED=true. Idempotent. Existing rows get NULL (= nothing pre-computed).

alter table chat_intakes add column if not exists pre_tag        jsonb;        -- the tagger's result (same JSON shape as sessions_ontology.raw_ontology_json)
alter table chat_intakes add column if not exists pre_tag_hash   text;         -- sha-256 of the exact tagger input; a result is only used for identical input
alter table chat_intakes add column if not exists pre_tag_status text;         -- 'pending' | 'ready' | 'failed' | 'used'
alter table chat_intakes add column if not exists pre_tag_at     timestamptz;  -- when the status last changed (freshness / abandoned-run detection)

comment on column chat_intakes.pre_tag is
  'Ontology-tagger result computed while the person was on the confirm screen (POST /api/chat-intake/pretag). Consumed once by POST /api/ontology when the session is created, then cleared. Contains model rationale text about the decision, like sessions_ontology.raw_ontology_json (also unencrypted). Not read by any report.';
comment on column chat_intakes.pre_tag_hash is
  'sha-256 of {decisionText, contextText} exactly as the tagger would receive them. A pre-tag is used only when the session''s own tagger input hashes to the same value.';
comment on column chat_intakes.pre_tag_status is
  'pending = a run is in flight (stale after ~90s); ready = result stored; failed = the model call or validation failed (the session then tags normally); used = already consumed.';

-- Rollback (if ever needed): the feature is off with NEXT_PUBLIC_PRETAG_ENABLED unset. To also drop the data:
--   alter table chat_intakes drop column if exists pre_tag, drop column if exists pre_tag_hash,
--                            drop column if exists pre_tag_status, drop column if exists pre_tag_at;
