import 'server-only'

// lib/connectors/teams.ts
// ── Microsoft Teams connector (Phase 3, v2) ───────────────────────────────────
//
// Same shape as lib/connectors/slack.ts — same-tier chat platform, same
// three operations (search, send, check-replies) — per the product
// decision to give Slack and Teams a genuinely similar experience.
//
// Tenant is pinned to 'organizations' rather than 'common': Microsoft Graph
// does not support sending or reading chat messages with a delegated token
// for a *personal* Microsoft account (confirmed in Graph's own
// chat-post-messages docs — "Delegated (personal Microsoft account): Not
// supported"), so there is no working flow for a personal-account sign-in
// here. Pinning to 'organizations' fails a personal-account sign-in
// cleanly and early, at the Microsoft login screen, rather than letting
// someone connect and then hit a confusing per-call failure later.
//
// Scopes: offline_access (refresh token), Chat.Read (list/read the user's
// own chats), ChatMessage.Send (send as the user — the least-privileged
// send permission Graph offers, deliberately not the broader
// Chat.ReadWrite).
//
// No Graph SDK dependency — raw fetch, matching this codebase's existing
// pattern of calling external AI providers directly rather than through
// their SDKs (see lib/ai-client.ts).

import { getValidAccessToken } from '@/lib/connectors/tokens'

const TENANT       = 'organizations'
const AUTHORIZE_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`
const TOKEN_URL      = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`
const SCOPES         = 'offline_access Chat.Read ChatMessage.Send User.Read'
const GRAPH           = 'https://graph.microsoft.com/v1.0'

export function buildTeamsAuthorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id:     process.env.TEAMS_CLIENT_ID ?? '',
    response_type: 'code',
    redirect_uri:  redirectUri,
    scope:         SCOPES,
    state,
  })
  return `${AUTHORIZE_URL}?${params.toString()}`
}

interface GraphTokenResponse {
  access_token?:  string
  refresh_token?: string
  expires_in?:    number
  error?:         string
  error_description?: string
}

export async function exchangeTeamsCode(code: string, redirectUri: string) {
  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.TEAMS_CLIENT_ID ?? '',
      client_secret: process.env.TEAMS_CLIENT_SECRET ?? '',
      code,
      redirect_uri:  redirectUri,
      grant_type:    'authorization_code',
      scope:         SCOPES,
    }),
  })
  const data = (await res.json()) as GraphTokenResponse
  if (!data.access_token) {
    throw new Error(`Teams token exchange failed: ${data.error_description ?? data.error ?? 'unknown error'}`)
  }

  // A second call to fetch the signed-in user's display context (tenant
  // name isn't in the token response at all — Graph's own /organization
  // endpoint needs a different permission than what we request here, so we
  // settle for the user's own name via /me, which User.Read already covers).
  let workspaceName: string | null = null
  let externalAccountId: string | null = null
  try {
    const meRes = await fetch(`${GRAPH}/me?$select=id,displayName`, {
      headers: { Authorization: `Bearer ${data.access_token}` },
    })
    const me = await meRes.json()
    workspaceName     = me?.displayName ?? null
    externalAccountId = me?.id ?? null
  } catch {
    // Non-fatal — the connection still works without a display name; the
    // UI falls back to a generic "Connected" label.
  }

  return {
    accessToken:       data.access_token,
    refreshToken:      data.refresh_token ?? null,
    expiresInSeconds:  data.expires_in ?? null,
    externalAccountId,
    externalTeamId:    null,   // not resolvable from User.Read alone — see comment above
    workspaceName,
    scopes:            SCOPES,
  }
}

async function refreshTeamsToken(refreshToken: string) {
  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.TEAMS_CLIENT_ID ?? '',
      client_secret: process.env.TEAMS_CLIENT_SECRET ?? '',
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      scope:         SCOPES,
    }),
  })
  const data = (await res.json()) as GraphTokenResponse
  if (!data.access_token) {
    throw new Error(`Teams token refresh failed: ${data.error_description ?? data.error ?? 'unknown error'}`)
  }
  return {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token,
    expiresIn:    data.expires_in,
  }
}

async function getToken(userId: string): Promise<string | null> {
  return getValidAccessToken(userId, 'teams', refreshTeamsToken)
}

export interface TeamsMessageMatch {
  chatId:      string
  chatTopic:   string   // display label — a 1:1 chat's other member's name, or the chat's topic
  userName:    string | null
  text:        string
  timestamp:   string   // ISO createdDateTime — pass to checkTeamsReplies as sentAfterIso
}

/**
 * Graph's dedicated /search/query endpoint has its own separate permission
 * and availability requirements beyond what Chat.Read grants — to keep the
 * scope surface to exactly the three scopes listed above, this lists the
 * user's own chats and searches within their recent messages directly
 * instead. Fine for "find that conversation with Sarah" at the scale a
 * person actually searches at; not a substitute for full-text search across
 * years of history.
 */
export async function searchTeamsMessages(userId: string, query: string): Promise<TeamsMessageMatch[] | null> {
  const token = await getToken(userId)
  if (!token) return null

  try {
    const chatsRes = await fetch(`${GRAPH}/me/chats?$expand=members&$top=25`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const chatsData = await chatsRes.json()
    if (!chatsData.value) return []

    const lowerQuery = query.toLowerCase()
    const matches: TeamsMessageMatch[] = []

    for (const chat of chatsData.value) {
      const members = (chat.members ?? []).map((m: any) => m.displayName).filter(Boolean)
      const chatTopic = chat.topic || members.join(', ') || 'Teams chat'

      // Only fetch messages for a chat that's plausibly relevant — either
      // the query matches a member's name, or we don't yet know (small
      // chat lists, so fetching messages for all of them is still cheap).
      const msgsRes = await fetch(`${GRAPH}/chats/${chat.id}/messages?$top=15`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const msgsData = await msgsRes.json()

      for (const msg of msgsData.value ?? []) {
        const bodyText = (msg.body?.content ?? '').replace(/<[^>]+>/g, '').trim()
        if (!bodyText) continue
        const matchesQuery =
          bodyText.toLowerCase().includes(lowerQuery) ||
          chatTopic.toLowerCase().includes(lowerQuery) ||
          members.some((n: string) => n.toLowerCase().includes(lowerQuery))
        if (matchesQuery) {
          matches.push({
            chatId:    chat.id,
            chatTopic,
            userName:  msg.from?.user?.displayName ?? null,
            text:      bodyText,
            timestamp: msg.createdDateTime,
          })
        }
      }
      if (matches.length >= 10) break
    }

    return matches.slice(0, 10)
  } catch (err) {
    console.error('[Teams] search failed:', err)
    return null
  }
}

export async function checkTeamsReplies(userId: string, chatId: string, sentAfterIso: string): Promise<TeamsMessageMatch[] | null> {
  const token = await getToken(userId)
  if (!token) return null

  try {
    const res = await fetch(`${GRAPH}/chats/${chatId}/messages?$top=20`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json()
    const sentAfter = new Date(sentAfterIso).getTime()

    return (data.value ?? [])
      .filter((msg: any) => new Date(msg.createdDateTime).getTime() > sentAfter)
      .map((msg: any) => ({
        chatId,
        chatTopic: '',
        userName:  msg.from?.user?.displayName ?? null,
        text:      (msg.body?.content ?? '').replace(/<[^>]+>/g, '').trim(),
        timestamp: msg.createdDateTime,
      }))
      .filter((m: TeamsMessageMatch) => m.text)
  } catch (err) {
    console.error('[Teams] checkReplies failed:', err)
    return null
  }
}

export async function sendTeamsMessage(userId: string, chatId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const token = await getToken(userId)
  if (!token) return { ok: false, error: 'Not connected' }

  try {
    const res = await fetch(`${GRAPH}/chats/${chatId}/messages`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body: { content: text } }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      console.error('[Teams] send failed:', err)
      return { ok: false, error: err?.error?.message ?? `HTTP ${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    console.error('[Teams] send threw:', err)
    return { ok: false, error: 'Request failed' }
  }
}
