import 'server-only'

// lib/connectors/outlook.ts
// ── Outlook connector (Phase 4, v3) ───────────────────────────────────────────
//
// Unlike Teams, Microsoft Graph's Mail.Send/Mail.Read ARE supported for
// personal Microsoft accounts (confirmed in Graph's own permissions
// reference — "Delegated (personal Microsoft account): Mail.Send"), so this
// uses tenant=common (work/school AND personal), not tenant=organizations
// like lib/connectors/teams.ts. The two connectors can still share one
// Azure app registration — see env.example's Outlook section — as long as
// that app's "Supported account types" is set to the broadest option
// (multi-tenant + personal accounts); each connector's own authorize call
// picks its own narrower tenant endpoint at request time.
//
// Full send + search + read here, unlike Gmail — Outlook has no equivalent
// "restricted scope" tier for Mail.Read, so there's no reason to hold this
// one back to send-only.

import { getValidAccessToken } from '@/lib/connectors/tokens'

const TENANT        = 'common'
const AUTHORIZE_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`
const TOKEN_URL      = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`
const SCOPES         = 'offline_access Mail.Send Mail.Read User.Read'
const GRAPH           = 'https://graph.microsoft.com/v1.0'

// Falls back to the Teams credentials — see env.example: one Azure app can
// serve both connectors. If MICROSOFT_CLIENT_ID is set, it's used for both;
// otherwise each connector keeps working off its own original var name, so
// nothing that already works (a v2 Teams setup) breaks by v3 existing.
const CLIENT_ID     = process.env.MICROSOFT_CLIENT_ID     ?? process.env.TEAMS_CLIENT_ID     ?? ''
const CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET ?? process.env.TEAMS_CLIENT_SECRET ?? ''

export function buildOutlookAuthorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
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

export async function exchangeOutlookCode(code: string, redirectUri: string) {
  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      code, redirect_uri: redirectUri, grant_type: 'authorization_code', scope: SCOPES,
    }),
  })
  const data = (await res.json()) as GraphTokenResponse
  if (!data.access_token) {
    throw new Error(`Outlook token exchange failed: ${data.error_description ?? data.error ?? 'unknown error'}`)
  }

  let workspaceName: string | null = null
  let externalAccountId: string | null = null
  try {
    const meRes = await fetch(`${GRAPH}/me?$select=id,mail,userPrincipalName`, {
      headers: { Authorization: `Bearer ${data.access_token}` },
    })
    const me = await meRes.json()
    workspaceName     = me?.mail ?? me?.userPrincipalName ?? null
    externalAccountId = me?.id ?? null
  } catch { /* non-fatal */ }

  return {
    accessToken:       data.access_token,
    refreshToken:      data.refresh_token ?? null,
    expiresInSeconds:  data.expires_in ?? null,
    externalAccountId,
    externalTeamId:    null,
    workspaceName,
    scopes:            SCOPES,
  }
}

async function refreshOutlookToken(refreshToken: string) {
  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token', refresh_token: refreshToken, scope: SCOPES,
    }),
  })
  const data = (await res.json()) as GraphTokenResponse
  if (!data.access_token) {
    throw new Error(`Outlook token refresh failed: ${data.error_description ?? data.error ?? 'unknown error'}`)
  }
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in }
}

async function getToken(userId: string): Promise<string | null> {
  return getValidAccessToken(userId, 'outlook', refreshOutlookToken)
}

export interface OutlookMessageMatch {
  messageId:    string
  fromAddress:  string | null
  fromName:     string | null
  subject:      string
  text:         string
  timestamp:    string   // ISO receivedDateTime
}

/** Uses Graph's $search on the messages collection — a simple, well-supported
 *  full-text match across subject/body/sender, no separate search API or
 *  extra permission needed beyond Mail.Read. */
export async function searchOutlookMessages(userId: string, query: string): Promise<OutlookMessageMatch[] | null> {
  const token = await getToken(userId)
  if (!token) return null

  try {
    const res = await fetch(
      `${GRAPH}/me/messages?$search="${encodeURIComponent(query)}"&$top=10&$select=id,from,subject,bodyPreview,receivedDateTime`,
      { headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: 'eventual' } },
    )
    const data = await res.json()
    if (!data.value) return []

    return data.value.map((m: any) => ({
      messageId:   m.id,
      fromAddress: m.from?.emailAddress?.address ?? null,
      fromName:    m.from?.emailAddress?.name ?? null,
      subject:     m.subject ?? '(no subject)',
      text:        m.bodyPreview ?? '',
      timestamp:   m.receivedDateTime,
    }))
  } catch (err) {
    console.error('[Outlook] search failed:', err)
    return null
  }
}

export async function sendOutlookMessage(
  userId:  string,
  to:      string,
  subject: string,
  body:    string,
): Promise<{ ok: boolean; error?: string }> {
  const token = await getToken(userId)
  if (!token) return { ok: false, error: 'Not connected' }

  try {
    const res = await fetch(`${GRAPH}/me/sendMail`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject,
          body:         { contentType: 'Text', content: body },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: true,
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      console.error('[Outlook] send failed:', err)
      return { ok: false, error: err?.error?.message ?? `HTTP ${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    console.error('[Outlook] send threw:', err)
    return { ok: false, error: 'Request failed' }
  }
}

/** "Check for a reply": messages received from `fromAddress` after `sentAfterIso`. */
export async function checkOutlookReplies(userId: string, fromAddress: string, sentAfterIso: string): Promise<OutlookMessageMatch[] | null> {
  const token = await getToken(userId)
  if (!token) return null

  try {
    const filter = `from/emailAddress/address eq '${fromAddress.replace(/'/g, "''")}' and receivedDateTime gt ${sentAfterIso}`
    const res = await fetch(
      `${GRAPH}/me/messages?$filter=${encodeURIComponent(filter)}&$top=10&$select=id,from,subject,bodyPreview,receivedDateTime`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const data = await res.json()
    return (data.value ?? []).map((m: any) => ({
      messageId:   m.id,
      fromAddress: m.from?.emailAddress?.address ?? null,
      fromName:    m.from?.emailAddress?.name ?? null,
      subject:     m.subject ?? '(no subject)',
      text:        m.bodyPreview ?? '',
      timestamp:   m.receivedDateTime,
    }))
  } catch (err) {
    console.error('[Outlook] checkReplies failed:', err)
    return null
  }
}
