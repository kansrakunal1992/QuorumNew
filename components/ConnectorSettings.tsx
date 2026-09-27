'use client'

// components/ConnectorSettings.tsx
// ── Chat connector connect/disconnect (Phase 3, v2) ───────────────────────────
//
// Small and embeddable on purpose — used inline inside
// components/StakeholderOutreach.tsx (the moment someone actually needs a
// connector, per plan section 22's "integrations appear in context" rule),
// and reusable later on a dedicated account/settings page without changes.

import { useEffect, useState, useCallback } from 'react'

export type ConnectorProvider = 'slack' | 'teams'

interface ConnectorState {
  enabled:       boolean
  connected:     boolean
  workspaceName: string | null
}

interface StatusResponse {
  slack: ConnectorState
  teams: ConnectorState
}

interface Props {
  authToken:  string | null
  onStatus?:  (status: StatusResponse) => void
}

const LABEL: Record<ConnectorProvider, string> = { slack: 'Slack', teams: 'Microsoft Teams' }

// Shown once, inline, the first time someone taps Connect for a given
// provider — before they're sent to the real OAuth screen. Per
// docs/PRIVACY_COPY_DRAFT_v1.md's "consent language shown at first
// connect" draft, reworded per-provider and wired in here so it actually
// ships with the connect flow instead of living only as draft copy.
const CONSENT_COPY: Record<ConnectorProvider, string> = {
  slack:
    'Quorum will only search Slack when you ask it to, for exactly what you ask it to find \u2014 never a background scan of your channels or DMs. You\u2019ll see what it found before any of it is used. Anything you send goes out from your own Slack account, as you, and only after you\u2019ve reviewed the message \u2014 nothing sends on its own. Disconnect anytime from here; anything already imported can be deleted along with the rest of your data.',
  teams:
    'Quorum will only search Teams when you ask it to, for exactly what you ask it to find \u2014 never a background scan of your chats. You\u2019ll see what it found before any of it is used. Anything you send goes out from your own Teams account, as you, and only after you\u2019ve reviewed the message \u2014 nothing sends on its own. Disconnect anytime from here; anything already imported can be deleted along with the rest of your data.',
}

export default function ConnectorSettings({ authToken, onStatus }: Props) {
  const [status, setStatus]   = useState<StatusResponse | null>(null)
  const [connecting, setConnecting] = useState<ConnectorProvider | null>(null)
  const [confirming, setConfirming] = useState<ConnectorProvider | null>(null)

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
    setConfirming(null)
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

  const providers: ConnectorProvider[] = (['slack', 'teams'] as const).filter(p => status[p].enabled)
  if (!providers.length) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {providers.map(p => (
        <div key={p} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13.5 }}>
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
                onClick={() => setConfirming(confirming === p ? null : p)}
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

          {/* First-connect consent — shown inline before handing off to the
              provider's real OAuth screen, never skipped. */}
          {confirming === p && !status[p].connected && (
            <div style={{
              background: 'var(--bg-inset)', border: '1px solid var(--border-dim)',
              borderRadius: 10, padding: 10, fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.45,
            }}>
              {CONSENT_COPY[p]}
              <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => connect(p)}
                  style={{ background: 'none', border: 'none', color: 'var(--gold-bright)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 0 }}
                >
                  Continue to {LABEL[p]}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(null)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-4)', fontSize: 12.5, cursor: 'pointer', padding: 0 }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
