'use client'

// components/ConnectorSettings.tsx
// ── Chat connector connect/disconnect (Phase 3, v2) ───────────────────────────
//
// Small and embeddable on purpose — used inline inside
// components/StakeholderOutreach.tsx (the moment someone actually needs a
// connector, per plan section 22's "integrations appear in context" rule),
// and reusable later on a dedicated account/settings page without changes.

import { useEffect, useState, useCallback } from 'react'

export type ConnectorProvider = 'slack' | 'teams' | 'gmail' | 'outlook'   // gmail/outlook added Phase 4, v3

interface ConnectorState {
  enabled:       boolean
  connected:     boolean
  workspaceName: string | null
}

interface StatusResponse {
  slack:   ConnectorState
  teams:   ConnectorState
  gmail:   ConnectorState
  outlook: ConnectorState
}

interface Props {
  authToken:  string | null
  onStatus?:  (status: StatusResponse) => void
}

const LABEL: Record<ConnectorProvider, string> = {
  slack: 'Slack', teams: 'Microsoft Teams', gmail: 'Gmail', outlook: 'Outlook',
}

export default function ConnectorSettings({ authToken, onStatus }: Props) {
  const [status, setStatus]   = useState<StatusResponse | null>(null)
  const [connecting, setConnecting] = useState<ConnectorProvider | null>(null)

  const refresh = useCallback(() => {
    fetch('/api/connectors/status', {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    })
      .then(r => r.json())
      .then(d => { setStatus(d); onStatus?.(d) })
      .catch(() => {})
  }, [authToken, onStatus])

  useEffect(() => { refresh() }, [refresh])

  // Picks up ?connector=slack_connected / teams_connected / *_failed left
  // by the OAuth callback redirect (see app/api/connectors/*/callback) and
  // refreshes status once, then cleans the URL so a page refresh doesn't
  // re-trigger it.
  useEffect(() => {
    const url = new URL(window.location.href)
    const flag = url.searchParams.get('connector')
    if (flag) {
      refresh()
      url.searchParams.delete('connector')
      window.history.replaceState({}, '', url.toString())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function connect(provider: ConnectorProvider) {
    if (!authToken) return
    setConnecting(provider)
    try {
      const returnPath = window.location.pathname + window.location.search
      const res = await fetch(`/api/connectors/${provider}/connect?returnPath=${encodeURIComponent(returnPath)}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      const data = await res.json()
      if (data.url) window.location.href = data.url
    } catch (err) {
      console.error(`[ConnectorSettings] ${provider} connect failed:`, err)
      setConnecting(null)
    }
  }

  async function disconnect(provider: ConnectorProvider) {
    if (!authToken) return
    await fetch(`/api/connectors/${provider}/disconnect`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${authToken}` },
    })
    refresh()
  }

  if (!status) return null

  const providers: ConnectorProvider[] = (['slack', 'teams', 'gmail', 'outlook'] as const).filter(p => status[p].enabled)
  if (!providers.length) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {providers.map(p => (
        <div key={p} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13.5 }}>
          <span style={{ color: 'var(--text-3)' }}>
            {status[p].connected
              ? `${LABEL[p]} — connected${status[p].workspaceName ? ` as ${status[p].workspaceName}` : ''}`
              : LABEL[p]}
          </span>
          {status[p].connected ? (
            <button
              type="button"
              onClick={() => disconnect(p)}
              style={{ background: 'none', border: 'none', color: 'var(--text-4)', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}
            >
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              onClick={() => connect(p)}
              disabled={connecting === p || !authToken}
              style={{
                background: 'none', border: '1px solid var(--border-mid)', borderRadius: 8,
                padding: '4px 10px', color: 'var(--text-2)', fontSize: 13,
                cursor: authToken ? 'pointer' : 'default', opacity: authToken ? 1 : 0.5,
              }}
            >
              {connecting === p ? 'Connecting…' : 'Connect'}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
