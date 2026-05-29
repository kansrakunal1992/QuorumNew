'use client'

// ── ContradictionBanner ───────────────────────────────────────────────────────
// Chunk 4b — Shown in SessionView post-synthesis when a stored contradiction
// exists that involves this session as the violation.
// Reads from /api/mirror/contradictions (GET) — already computed by the
// contradiction detector that runs after examiner completion.
// Two actions: Flag as exception / Update my rule (via DELETE to dismiss).
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'

interface Contradiction {
  id:                 string
  principleText:      string
  principleDecision:  string | null
  violationText:      string
  severity:           string
  category:           string
}

interface Props {
  contradiction: Contradiction
  authToken:     string | null
  onDismiss:     (id: string) => void
}

export default function ContradictionBanner({ contradiction, authToken, onDismiss }: Props) {
  const [actioning, setActioning] = useState<'exception' | 'update' | null>(null)
  const [done,      setDone]      = useState(false)

  if (done) return null

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
      borderLeft:   '2px solid #c08030',
      borderRadius: 12,
      padding:      '16px 20px',
      marginTop:    16,
    }}>
      {/* Header */}
      <p style={{
        fontFamily:    'var(--font-mono)',
        fontSize:      9.5,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color:         '#c08030',
        margin:        '0 0 8px',
        opacity:       0.9,
      }}>
        Contradiction detected from your record
      </p>

      {/* Violation */}
      <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, margin: '0 0 10px' }}>
        {contradiction.violationText}
      </p>

      {/* Principle source */}
      <div style={{
        background:   'var(--bg-inset)',
        border:       '1px solid var(--border-dim)',
        borderRadius: 8,
        padding:      '10px 14px',
        marginBottom: 14,
      }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-4)', margin: '0 0 5px' }}>
          Principle from your record
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.55, margin: 0 }}>
          {contradiction.principleText}
        </p>
        {contradiction.principleDecision && (
          <p style={{ fontSize: 11, color: 'var(--text-4)', margin: '6px 0 0', fontStyle: 'italic' }}>
            Extracted from: "{contradiction.principleDecision}…"
          </p>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={() => handleAction('exception')}
          disabled={!!actioning}
          style={{
            padding:       '8px 16px',
            borderRadius:  8,
            border:        '1px solid var(--border-mid)',
            background:    'transparent',
            color:         'var(--text-3)',
            fontSize:      12,
            fontWeight:    500,
            cursor:        actioning ? 'not-allowed' : 'pointer',
            fontFamily:    'inherit',
            transition:    'all 0.15s',
            opacity:       actioning === 'update' ? 0.4 : 1,
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
            padding:       '8px 16px',
            borderRadius:  8,
            border:        '1px solid #c08030',
            background:    'rgba(192,128,48,0.08)',
            color:         '#c08030',
            fontSize:      12,
            fontWeight:    500,
            cursor:        actioning ? 'not-allowed' : 'pointer',
            fontFamily:    'inherit',
            transition:    'all 0.15s',
            opacity:       actioning === 'exception' ? 0.4 : 1,
          }}
          onMouseEnter={e => { if (!actioning) e.currentTarget.style.background = 'rgba(192,128,48,0.14)' }}
          onMouseLeave={e => { if (!actioning) e.currentTarget.style.background = 'rgba(192,128,48,0.08)' }}
        >
          {actioning === 'update' ? 'Updating…' : 'Update my rule'}
        </button>
      </div>
    </div>
  )
}
