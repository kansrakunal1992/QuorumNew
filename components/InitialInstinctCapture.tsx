// components/InitialInstinctCapture.tsx
// ── Unified Session, Tier 2 ────────────────────────────────────────────────
// Locks the user's own leaning and priority before Quorum says anything.
// Rendered only under the unified session flag, and only until submitted —
// see SessionView.tsx for the gate (nothing else in the session renders
// until this resolves, matching the product doc's "critical bias
// protection" requirement).

'use client'

import { useState } from 'react'

interface Props {
  sessionId:  string
  authToken:  string | null
  onComplete: (instinct: 'accept' | 'reject' | 'unsure', priority: string) => void
}

const PRIORITIES: { value: string; label: string }[] = [
  { value: 'career_growth', label: 'Career growth' },
  { value: 'security',      label: 'Security' },
  { value: 'money',         label: 'Money' },
  { value: 'time_freedom',  label: 'Time / freedom' },
  { value: 'family',        label: 'Family' },
  { value: 'other',         label: 'Something else' },
]

export default function InitialInstinctCapture({ sessionId, authToken, onComplete }: Props) {
  const [instinct, setInstinct] = useState<'accept' | 'reject' | 'unsure' | null>(null)
  const [priority, setPriority] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = instinct !== null && priority !== null && !submitting

  async function handleSubmit() {
    if (!instinct || !priority) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/session/${sessionId}/instinct`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ initialInstinct: instinct, optimizationPriority: priority }),
      })
      if (!res.ok) throw new Error('save failed')
      onComplete(instinct, priority)
    } catch {
      setError('Couldn\u2019t save that — try again.')
      setSubmitting(false)
    }
  }

  return (
    <div
      className="sv-fade sv-fade-1"
      style={{
        border:       '1px solid var(--border-mid)',
        borderRadius: 14,
        padding:      '20px 20px 18px',
        marginBottom: 16,
        background:   'var(--bg-card)',
      }}
    >
      <p style={{
        fontFamily:    'var(--font-mono)',
        fontSize:      11,
        letterSpacing: '0.06em',
        color:         'var(--text-4)',
        margin:        '0 0 14px',
        textTransform: 'uppercase',
      }}>
        Before Quorum weighs in
      </p>

      <p style={{ fontSize: 15, color: 'var(--text-1)', margin: '0 0 10px', fontWeight: 500 }}>
        What are you currently leaning toward?
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {(['accept', 'reject', 'unsure'] as const).map(opt => (
          <button
            key={opt}
            type="button"
            onClick={() => setInstinct(opt)}
            style={chipStyle(instinct === opt)}
          >
            {opt === 'accept' ? 'Leaning yes' : opt === 'reject' ? 'Leaning no' : 'Genuinely unsure'}
          </button>
        ))}
      </div>

      <p style={{ fontSize: 15, color: 'var(--text-1)', margin: '0 0 10px', fontWeight: 500 }}>
        What matters most in this decision?
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {PRIORITIES.map(p => (
          <button
            key={p.value}
            type="button"
            onClick={() => setPriority(p.value)}
            style={chipStyle(priority === p.value)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-4)', margin: '0 0 14px' }}>
        Locking this first means Quorum's read can't quietly talk you into agreeing with it later.
      </p>

      {error && <p style={{ fontSize: 12, color: 'var(--danger, #c25454)', margin: '0 0 10px' }}>{error}</p>}

      <button
        type="button"
        className="btn-primary"
        disabled={!canSubmit}
        onClick={handleSubmit}
        style={{ padding: '9px 20px', fontSize: 13, opacity: canSubmit ? 1 : 0.45 }}
      >
        {submitting ? 'Locking it in\u2026' : 'Lock it in'}
      </button>
    </div>
  )
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    padding:      '7px 14px',
    fontSize:     13,
    borderRadius: 999,
    border:       `1px solid ${active ? 'var(--gold)' : 'var(--border-mid)'}`,
    background:   active ? 'rgba(201,168,76,0.14)' : 'transparent',
    color:        active ? 'var(--gold)' : 'var(--text-2)',
    cursor:       'pointer',
  }
}
