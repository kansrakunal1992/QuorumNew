'use client'

// ── ContradictionBanner ───────────────────────────────────────────────────────
// Chunk 4b — shown in SessionView post-synthesis.
// Uses actual field names from /api/mirror/contradictions GET response:
//   id, principleText, principleSessionId, principleDecision,
//   violationText, violationSessionId, violationDecision,
//   severity, category
//
// Match strategy: show if violationSessionId === current session.id
// Fallback: show most recent unmatched contradiction if none matches exactly
// (covers the case where the current session just generated one that hasn't
// been linked yet via violationSessionId).
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'

interface Contradiction {
  id:                 string
  principleText:      string
  principleSessionId: string | null
  principleDecision:  string | null
  violationText:      string
  violationSessionId: string | null
  violationDecision:  string | null
  severity:           'sharp' | 'notable' | 'forming'
  category:           string
}

interface Props {
  contradiction: Contradiction
  authToken:     string | null
  onDismiss:     (id: string) => void
}

const SEVERITY_COLOR: Record<string, string> = {
  sharp:   '#c04040',
  notable: '#c08030',
  forming: '#3a78c4',
}
const SEVERITY_LABEL: Record<string, string> = {
  sharp:   'Sharp contradiction',
  notable: 'Notable tension',
  forming: 'Emerging tension',
}

export default function ContradictionBanner({ contradiction, authToken, onDismiss }: Props) {
  const [actioning, setActioning] = useState<'exception' | 'update' | null>(null)
  const [done,      setDone]      = useState(false)

  if (done) return null

  const color = SEVERITY_COLOR[contradiction.severity] ?? 'var(--gold)'
  const label = SEVERITY_LABEL[contradiction.severity] ?? 'Tension detected'

  const handleAction = async (action: 'exception' | 'update') => {
    setActioning(action)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`
      await fetch(`/api/mirror/contradictions?id=${contradiction.id}`, { method: 'DELETE', headers })
      onDismiss(contradiction.id)
      setDone(true)
    } catch {
      setActioning(null)
    }
  }

  return (
    <div style={{
      background:   'var(--bg-card)',
      border:       '1px solid var(--border-mid)',
      borderLeft:   `2px solid ${color}`,
      borderRadius: 12,
      padding:      '16px 20px',
      marginTop:    16,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 10 }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', color, margin: 0, opacity: 0.9 }}>
          {label} · from your record
        </p>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)', background: 'var(--bg-inset)', border: '1px solid var(--border-dim)', borderRadius: 20, padding: '2px 9px', whiteSpace: 'nowrap', letterSpacing: '0.06em' }}>
          {contradiction.category}
        </span>
      </div>

      {/* What you said */}
      <div style={{ marginBottom: 8 }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-4)', margin: '0 0 5px' }}>
          What you said
        </p>
        <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6, margin: 0, fontStyle: 'italic' }}>
          &ldquo;{contradiction.principleText}&rdquo;
        </p>
        {contradiction.principleDecision && (
          <p style={{ fontSize: 11, color: 'var(--text-4)', margin: '5px 0 0' }}>
            From: {contradiction.principleDecision}…
          </p>
        )}
      </div>

      {/* Divider */}
      <div style={{ borderTop: '1px solid var(--border-dim)', margin: '10px 0' }} />

      {/* What you did */}
      <div style={{ marginBottom: 14 }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-4)', margin: '0 0 5px' }}>
          This decision
        </p>
        <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6, margin: 0 }}>
          {contradiction.violationText}
        </p>
        {contradiction.violationDecision && (
          <p style={{ fontSize: 11, color: 'var(--text-4)', margin: '5px 0 0' }}>
            From: {contradiction.violationDecision}…
          </p>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={() => handleAction('exception')}
          disabled={!!actioning}
          style={{
            padding: '8px 16px', borderRadius: 8,
            border: '1px solid var(--border-mid)', background: 'transparent',
            color: 'var(--text-3)', fontSize: 12, fontWeight: 500,
            cursor: actioning ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            opacity: actioning === 'update' ? 0.4 : 1, transition: 'all 0.15s',
          }}
          onMouseEnter={e => { if (!actioning) e.currentTarget.style.borderColor = 'var(--border-hi)' }}
          onMouseLeave={e => { if (!actioning) e.currentTarget.style.borderColor = 'var(--border-mid)' }}
        >
          {actioning === 'exception' ? 'Flagging…' : 'Flag as exception'}
        </button>
        <button
          onClick={() => handleAction('update')}
          disabled={!!actioning}
          style={{
            padding: '8px 16px', borderRadius: 8,
            border: `1px solid ${color}`, background: `${color}14`,
            color, fontSize: 12, fontWeight: 500,
            cursor: actioning ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            opacity: actioning === 'exception' ? 0.4 : 1, transition: 'all 0.15s',
          }}
          onMouseEnter={e => { if (!actioning) e.currentTarget.style.background = `${color}22` }}
          onMouseLeave={e => { if (!actioning) e.currentTarget.style.background = `${color}14` }}
        >
          {actioning === 'update' ? 'Updating…' : 'Update my rule'}
        </button>
      </div>
    </div>
  )
}
