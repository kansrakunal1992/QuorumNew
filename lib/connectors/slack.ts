import 'server-only'

// lib/connectors/slack.ts
// ── Slack connector (Phase 3, v2) ─────────────────────────────────────────────
//
// Scope surface deliberately kept to two user-token scopes:
//   search:read  — the classic search.messages method (Slack's own docs
//                  label it "legacy" and point to the newer Real-time
//                  Search API instead — but RTS is restricted to
//                  directory-published or internal apps only, which rules
//                  it out until/unless Quorum is Slack-Marketplace-listed;
//                  search.messages has no such restriction and remains
//                  fully functional for any distributed app today).
//   chat:write   — sending as the user (not a bot), required for
//                  "this will be sent from your own Slack account."
// Both are requested as `user_scope` — bot tokens can't call search.messages
// at all, and sending as a bot would break the "as you" promise anyway.
//
// No `channels:history`/`im:history`/etc. scopes are requested: "check for
// replies" reuses search.messages with an `after:` filter on the same
// channel a message was sent to, rather than a separate history read —
// one scope surface, not two, for the same underlying capability.

import { getValidAccessToken } from '@/lib/connectors/tokens'

const AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize'
const TOKEN_URL      = 'https://slack.com/api/oauth.v2.access'
const USER_SCOPES    = 'search:read,chat:write'

export function buildSlackAuthorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id:    process.env.SLACK_CLIENT_ID ?? '',
    user_scope:   USER_SCOPES,
    redirect_uri: redirectUri,
    state,
  })
  return `${AUTHORIZE_URL}?${params.toString()}`
}

interface SlackTokenResponse {
  ok: boolean
  error?: string
  authed_user?: {
    id:            string
    access_token:  string
    refresh_token?: string
    expires_in?:   number
    scope:         string
  }
  team?: { id: string; name: string }
}

export async function exchangeSlackCode(code: string, redirectUri: string) {
  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.SLACK_CLIENT_ID ?? '',
      client_secret: process.env.SLACK_CLIENT_SECRET ?? '',
      code,
      redirect_uri:  redirectUri,
      grant_type:    'authorization_code',
    }),
  })
  const data = (await res.json()) as SlackTokenResponse

  if (!data.ok || !data.authed_user?.access_token) {
    throw new Error(`Slack token exchange failed: ${data.error ?? 'unknown error'}`)
  }

  return {
    accessToken:       data.authed_user.access_token,
    refreshToken:      data.authed_user.refresh_token ?? null,
    expiresInSeconds:  data.authed_user.expires_in ?? null,   // absent unless the app has token rotation enabled — a normal, expected shape, not an error
    externalAccountId: data.authed_user.id,
    externalTeamId:    data.team?.id ?? null,
    workspaceName:     data.team?.name ?? null,
    scopes:            data.authed_user.scope,
  }
}

async function refreshSlackToken(refreshToken: string) {
  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.SLACK_CLIENT_ID ?? '',
      client_secret: process.env.SLACK_CLIENT_SECRET ?? '',
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }),
  })
  const data = (await res.json()) as SlackTokenResponse
  if (!data.ok || !data.authed_user?.access_token) {
    throw new Error(`Slack token refresh failed: ${data.error ?? 'unknown error'}`)
  }
  return {
    accessToken:  data.authed_user.access_token,
    refreshToken: data.authed_user.refresh_token,
    expiresIn:    data.authed_user.expires_in,
  }
}

async function getToken(userId: string): Promise<string | null> {
  return getValidAccessToken(userId, 'slack', refreshSlackToken)
}

export interface SlackMessageMatch {
  channelId:   string
  channelName: string
  userName:    string | null
  text:        string
  timestamp:   string   // Slack's raw "ts" — also the value to pass to sendReply's `threadTs` if replying in-thread is ever added
  permalink:   string | null
}

export async function searchSlackMessages(userId: string, query: string): Promise<SlackMessageMatch[] | null> {
  const token = await getToken(userId)
  if (!token) return null

  const res = await fetch(`https://slack.com/api/search.messages?${new URLSearchParams({ query, count: '10', sort: 'timestamp', sort_dir: 'desc' })}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  if (!data.ok) {
    console.error('[Slack] search.messages failed:', data.error)
    return null
  }

  return (data.messages?.matches ?? []).map((m: any) => ({
    channelId:   m.channel?.id ?? '',
    channelName: m.channel?.name ?? (m.channel?.is_im ? 'Direct message' : 'Slack'),
    userName:    m.username ?? null,
    text:        m.text ?? '',
    timestamp:   m.ts,
    permalink:   m.permalink ?? null,
  }))
}

/** "Check for replies": re-runs the same search scoped to after the send
 *  timestamp, rather than a separate conversations.history read (keeps the
 *  scope surface to search:read alone — see file header). */
export async function checkSlackReplies(userId: string, channelName: string, sentAfterTs: string): Promise<SlackMessageMatch[] | null> {
  const afterDate = new Date(Number(sentAfterTs) * 1000).toISOString().slice(0, 10)
  return searchSlackMessages(userId, `in:${channelName} after:${afterDate}`)
}

export async function sendSlackMessage(userId: string, channelId: string, text: string): Promise<{ ok: boolean; ts?: string; error?: string }> {
  const token = await getToken(userId)
  if (!token) return { ok: false, error: 'Not connected' }

  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ channel: channelId, text }),
  })
  const data = await res.json()
  if (!data.ok) {
    console.error('[Slack] chat.postMessage failed:', data.error)
    return { ok: false, error: data.error }
  }
  return { ok: true, ts: data.ts }
}
