# Stakeholder Outreach + Chat Connectors — v2 (Phase 2 + Phase 3, with Teams)

Built on top of the QuorumZip.zip you shared (natural-intake "hero" build-out
included). 27 files, all new except three small edits to existing ones:
`lib/feature-flags.ts` (+1 flag), `lib/encryption.ts` (+3 doc lines),
`components/DecisionCheckpoint.tsx` (+1 import, +5 lines rendering the new
panel — nothing else in that file touched), `env.example` (+1 new section).
Inert until you register the Slack/Teams apps below and flip the flags —
no existing behavior changes if you don't.

## Setup

1. **Run the migration:** `supabase/sprint_stakeholder_connectors_v2.sql` —
   additive only, three new tables, no existing table touched.
2. **Register a Slack app** at api.slack.com/apps → From scratch. Under
   *OAuth & Permissions → User Token Scopes*, add exactly `search:read` and
   `chat:write`. Redirect URL: `https://<your-domain>/api/connectors/slack/callback`.
   Copy the Client ID/Secret into `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET`.
3. **Register an Azure AD app** at portal.azure.com → Microsoft Entra ID →
   App registrations → New registration, account type "Accounts in any
   organizational directory." Add a Web redirect URI:
   `https://<your-domain>/api/connectors/teams/callback`. Under *API
   permissions*, add delegated: `offline_access`, `Chat.Read`,
   `ChatMessage.Send`, `User.Read`. Copy the values into `TEAMS_CLIENT_ID` /
   `TEAMS_CLIENT_SECRET`.
4. **Generate a state-signing secret:** `openssl rand -hex 32` →
   `CONNECTOR_OAUTH_STATE_SECRET`.
5. **Flip the flags** (only after 2-4 are done): `NEXT_PUBLIC_SLACK_CONNECTOR_ENABLED=true`,
   `NEXT_PUBLIC_TEAMS_CONNECTOR_ENABLED=true`. WhatsApp and manual paste-in
   need no setup at all — they work the moment `NEXT_PUBLIC_NATURAL_INTAKE_ENABLED`
   is on, with no separate flag of their own required beyond that.
6. **Redeploy** — `NEXT_PUBLIC_` vars are baked in at build time.

## What's in this drop

**Stakeholder model:** `stakeholders` (one row per person, de-duplicated by
name) and `stakeholder_inputs` (what they said, kept separate from your own
interpretation of it — plan section 15).

**Universal capture, one path:** `POST /api/stakeholder-input/manual` is the
only thing that ever writes a `stakeholder_inputs` row — whether it's a
WhatsApp reply you paste in, a Slack/Teams reply the panel found for you, or
something you're typing in from memory with no connector involved at all.

**Drafting:** `lib/outreach-draft.ts` — one function, aware of which channel
it's headed to (an email gets a greeting; Slack/Teams doesn't) and of *why*
you're consulting this person if you said so in the chat (expertise →
asks the thing only they'd know; challenge → invites disagreement outright;
etc.).

**Slack:** OAuth connect/callback, search (the classic `search.messages`
method — Slack's own docs call it "legacy" and point at a newer Real-time
Search API, but that one requires your app to be Marketplace-listed or
workspace-internal, neither of which fits yet — see `lib/connectors/slack.ts`),
send as the user, and "check for a reply" (re-runs the same search scoped
to after the send time, rather than a second scope for reading channel
history).

**Microsoft Teams:** the same three operations via Microsoft Graph —
`Chat.Read` to list/search the user's own chats, `ChatMessage.Send` to
reply. Pinned to work/school accounts only (`tenant=organizations`) —
Graph doesn't support sending or reading chat messages for a personal
Microsoft account at all, confirmed in Graph's own docs, so this isn't a
scope choice, it's a hard platform limit.

**WhatsApp:** no OAuth, no send API — exactly the locked design. Drafts the
message, opens `wa.me` with it pre-filled, the person sends it from their
own WhatsApp. Reply comes back via the same paste-in flow as everything
else.

**UI:** `components/StakeholderOutreach.tsx` (the whole draft → search →
send → check/paste-reply flow) and `components/ConnectorSettings.tsx`
(connect/disconnect, embedded inside the outreach panel and reusable on a
future settings page). Surfaces only inside the checkpoint screen, only
when the chat actually named someone — never a standing "Integrations"
entry point.

## Deliberately scoped out of v2 (so it's a choice, not a gap)

- **Gmail send.** Was bundled into "Phase 2" in the original plan table
  alongside stakeholder inputs; cut from this drop to keep three genuinely
  different OAuth integrations (Slack, Teams, Gmail) from each getting a
  shallower pass in one turn. Slack + Teams + the full stakeholder model at
  real depth beat three connectors done thinner. Same shape as the existing
  connectors once it's next: OAuth connect/callback, a `gmail.send`-scope
  send call (MIME-encoded), no reading.
- **Real-time reply capture.** "Check for a reply" is polling — the person
  taps a button. A live webhook (Slack Events API, Graph change
  notifications) needs a public subscription endpoint with signature
  verification on each provider's own terms; a good next piece, not a
  same-turn one.
- **Persisting outreach attempts across reloads.** Right now `sentMarker`
  and which channel/chat a message went to live in the component's own
  state — reload the page mid-flow and "check for reply" needs the search
  redone. Small, well-defined fix (store it against the stakeholder record
  itself) — not done here.
- **Wiring stakeholder inputs into the Council or Decision Brief.**
  `GET /api/stakeholder-input/list` exists and returns everything a session
  has gathered, but nothing in `app/api/persona/route.ts` or the brief
  generator reads it yet. The data is being captured correctly; it just
  isn't feeding the six-persona synthesis yet — that's the natural next
  connection point once you've seen this working end to end.
- **Tier-aware AI routing for the new routes.** `middleware.ts` stamps
  product-tier headers only for the routes listed in its matcher — the new
  connector/stakeholder routes aren't in that list, so their AI calls
  (drafting, extraction) always route on the default tier rather than
  respecting an Elite/Private account's usual model. Didn't touch
  `middleware.ts` itself to add them — it's a shared, tier-critical file,
  and a one-line addition there deserves its own deliberate look rather
  than riding in on this drop.

## A note on verification
Same as v1: no network access in this container, so nothing here has run
through `next build`. The Slack and Microsoft API shapes (OAuth token
exchange, `search.messages`, `chat.postMessage`, Graph's `/me/chats` and
`/chats/{id}/messages`) were checked against each provider's current
documentation before writing this, not assumed from memory — but a real
end-to-end test against your own registered apps is still the actual
verification step.

## Reminders you asked to hold, not acted on here
1. Remove the 2-card cap on the natural-intake landing page (`lib/hero-cards.ts`).
2. Magic link route — you flagged a possible bug, not yet investigated.

## Version
This is **v2**. The next zip in this thread will be **v3**.
