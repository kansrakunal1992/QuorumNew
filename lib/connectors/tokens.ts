import 'server-only'

// lib/connectors/tokens.ts
// ── Connector token storage (Phase 2/3, v2) ───────────────────────────────────
//
// Provider-agnostic: knows how to store, fetch, and refresh an OAuth token
// pair, but nothing about Slack's or Teams's specific token shapes — each
// provider file (lib/connectors/slack.ts, lib/connectors/teams.ts) passes in
// its own `refresh` function. Never imported from a client component —
// tokens never leave the server (lib/encryption.ts's own 'server-only'
// guard would catch this anyway, but the explicit import here makes the
// guarantee visible in this file too).

import { createServiceClient } from '@/lib/supabase'
import { encrypt, decrypt } from '@/lib/encryption'

export type ConnectorProvider = 'slack' | 'teams' | 'gmail' | 'outlook'   // gmail/outlook added Phase 4, v3

export interface ConnectorAccount {
  id:                 string
  provider:           ConnectorProvider
  accessToken:        string
  refreshToken:       string | null
  externalAccountId:  string | null
  externalTeamId:     string | null
  workspaceName:      string | null
}

export interface SaveTokenInput {
  accessToken:        string
  refreshToken?:       string | null
  expiresInSeconds?:   number | null
  externalAccountId?:  string | null
  externalTeamId?:     string | null
  workspaceName?:      string | null
  scopes?:             string | null
}

export async function saveConnectorAccount(
  userId:   string,
  provider: ConnectorProvider,
  tokens:   SaveTokenInput,
): Promise<void> {
  const supabase = createServiceClient()
  const expiresAt = tokens.expiresInSeconds
    ? new Date(Date.now() + tokens.expiresInSeconds * 1000).toISOString()
    : null

  const { error } = await supabase
    .from('connector_accounts')
    .upsert(
      {
        user_id:              userId,
        provider,
        access_token:         encrypt(tokens.accessToken),
        refresh_token:        tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
        token_expires_at:     expiresAt,
        external_account_id:  tokens.externalAccountId ?? null,
        external_team_id:     tokens.externalTeamId ?? null,
        workspace_name:       tokens.workspaceName ?? null,
        scopes:               tokens.scopes ?? null,
        connected_at:         new Date().toISOString(),
        revoked_at:           null,
      },
      { onConflict: 'user_id,provider' },
    )

  if (error) throw new Error(`Failed to save ${provider} connection: ${error.message}`)
}

/**
 * Returns a currently-valid access token, refreshing it first if it's
 * expired (or within 60s of expiring) and a refresh token is on file.
 * `refresh` is provider-specific (each provider's own token endpoint/shape)
 * — this function only owns the "is it stale, and what do I do once I have
 * a new one" logic, not any provider's wire format.
 *
 * Returns null when there's no connection, or a refresh was needed but
 * failed (e.g. the user revoked access on the provider's side) — callers
 * should treat null as "not connected," not throw a 500 for it, since a
 * revoked connection is a normal state, not a bug.
 */
export async function getValidAccessToken(
  userId:   string,
  provider: ConnectorProvider,
  refresh:  (refreshToken: string) => Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }>,
): Promise<string | null> {
  const supabase = createServiceClient()
  const { data: row } = await supabase
    .from('connector_accounts')
    .select('access_token, refresh_token, token_expires_at')
    .eq('user_id', userId)
    .eq('provider', provider)
    .is('revoked_at', null)
    .single()

  if (!row) return null

  const accessToken = decrypt(row.access_token)
  if (!accessToken) return null

  const expiresAt = row.token_expires_at ? new Date(row.token_expires_at).getTime() : null
  const isStale   = expiresAt !== null && expiresAt - Date.now() < 60_000

  if (!isStale) return accessToken

  const refreshToken = decrypt(row.refresh_token)
  if (!refreshToken) return accessToken   // no way to refresh — hand back what we have, let the caller's API call fail if it's truly expired

  try {
    const refreshed = await refresh(refreshToken)
    await supabase
      .from('connector_accounts')
      .update({
        access_token:     encrypt(refreshed.accessToken),
        refresh_token:    refreshed.refreshToken ? encrypt(refreshed.refreshToken) : row.refresh_token,
        token_expires_at: refreshed.expiresIn ? new Date(Date.now() + refreshed.expiresIn * 1000).toISOString() : null,
      })
      .eq('user_id', userId)
      .eq('provider', provider)
    return refreshed.accessToken
  } catch (err) {
    console.error(`[Connectors] ${provider} token refresh failed:`, err)
    return null
  }
}

export async function getConnectorStatus(userId: string, provider: ConnectorProvider): Promise<{ connected: boolean; workspaceName: string | null }> {
  const supabase = createServiceClient()
  const { data: row } = await supabase
    .from('connector_accounts')
    .select('workspace_name')
    .eq('user_id', userId)
    .eq('provider', provider)
    .is('revoked_at', null)
    .single()

  return { connected: !!row, workspaceName: row?.workspace_name ?? null }
}

/** Hard delete, not a soft revoke — "easy disconnect" means the token is
 *  actually gone, not just hidden. */
export async function disconnectConnector(userId: string, provider: ConnectorProvider): Promise<void> {
  const supabase = createServiceClient()
  await supabase.from('connector_accounts').delete().eq('user_id', userId).eq('provider', provider)
}
