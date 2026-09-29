import 'server-only'

// lib/connectors/gmail.ts
// ── Gmail connector — send-only (Phase 4, v3) ─────────────────────────────────
//
// Send-only per the locked decision (plan section 6 / round-one sign-off):
// only the `gmail.send` scope is requested — Gmail's read scopes
// (gmail.readonly, gmail.modify) are Google "restricted" scopes requiring
// app verification plus an annual third-party security assessment (CASA).
// `gmail.send` is not in that tier — standard OAuth verification only.
//
// This is a genuinely separate Google OAuth client from lib/google-auth.ts's
// "Continue with Google" sign-in — that flow goes through Supabase's own
// managed OAuth and doesn't expose a token this app can call the Gmail API
// with. GMAIL_CLIENT_ID/SECRET below are a dedicated Google Cloud OAuth
// client for this one purpose.

import { getValidAccessToken } from '@/lib/connectors/tokens'

const AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE     = 'https://www.googleapis.com/auth/gmail.send'

export function buildGmailAuthorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id:     process.env.GMAIL_CLIENT_ID ?? '',
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         SCOPE,
    access_type:   'offline',   // required to get a refresh_token back
    prompt:        'consent',   // forces a refresh_token on every connect, not just the first ever
    state,
  })
  return `${AUTH_URL}?${params.toString()}`
}

interface GoogleTokenResponse {
  access_token?:  string
  refresh_token?: string
  expires_in?:    number
  error?:         string
  error_description?: string
}

export async function exchangeGmailCode(code: string, redirectUri: string) {
  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GMAIL_CLIENT_ID ?? '',
      client_secret: process.env.GMAIL_CLIENT_SECRET ?? '',
      code,
      redirect_uri:  redirectUri,
      grant_type:    'authorization_code',
    }),
  })
  const data = (await res.json()) as GoogleTokenResponse
  if (!data.access_token) {
    throw new Error(`Gmail token exchange failed: ${data.error_description ?? data.error ?? 'unknown error'}`)
  }

  let workspaceName: string | null = null
  let externalAccountId: string | null = null
  try {
    const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${data.access_token}` },
    })
    const profile = await profileRes.json()
    workspaceName     = profile?.emailAddress ?? null
    externalAccountId = profile?.emailAddress ?? null
  } catch { /* non-fatal — falls back to a generic "Connected" label */ }

  return {
    accessToken:       data.access_token,
    refreshToken:      data.refresh_token ?? null,
    expiresInSeconds:  data.expires_in ?? null,
    externalAccountId,
    externalTeamId:    null,
    workspaceName,
    scopes:            SCOPE,
  }
}

async function refreshGmailToken(refreshToken: string) {
  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GMAIL_CLIENT_ID ?? '',
      client_secret: process.env.GMAIL_CLIENT_SECRET ?? '',
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }),
  })
  const data = (await res.json()) as GoogleTokenResponse
  if (!data.access_token) {
    throw new Error(`Gmail token refresh failed: ${data.error_description ?? data.error ?? 'unknown error'}`)
  }
  // Google does not re-issue a refresh_token on refresh — the original one
  // stays valid indefinitely (until revoked), so refreshToken is omitted
  // here, which tells lib/connectors/tokens.ts to keep the one already on file.
  return { accessToken: data.access_token, expiresIn: data.expires_in }
}

async function getToken(userId: string): Promise<string | null> {
  return getValidAccessToken(userId, 'gmail', refreshGmailToken)
}

function encodeMimeMessage(to: string | null, subject: string, body: string): string {
  // 'to' is deliberately optional/blank-able — the draft is composed inside
  // Quorum with no recipient resolution step (no Gmail read scope to look
  // anyone's address up with), so in practice the person fills in the "To"
  // themselves. Kept as a parameter for when a stakeholder's email is
  // already known some other way (e.g. typed in by the user).
  const lines = [
    to ? `To: ${to}` : '',
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body,
  ].filter(Boolean)
  const raw = lines.join('\r\n')
  return Buffer.from(raw).toString('base64url')
}

export async function sendGmailMessage(
  userId:  string,
  to:      string | null,
  subject: string,
  body:    string,
): Promise<{ ok: boolean; error?: string }> {
  const token = await getToken(userId)
  if (!token) return { ok: false, error: 'Not connected' }

  try {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encodeMimeMessage(to, subject, body) }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      console.error('[Gmail] send failed:', err)
      return { ok: false, error: err?.error?.message ?? `HTTP ${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    console.error('[Gmail] send threw:', err)
    return { ok: false, error: 'Request failed' }
  }
}
