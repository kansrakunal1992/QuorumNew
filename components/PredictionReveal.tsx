// components/PredictionReveal.tsx
// ── Unified Session, Tier 2 ────────────────────────────────────────────────
// The "make your decision" + reveal moment. Two states: before submission,
// a plain input for the final call; after, "Quorum predicted you" / "You
// surprised Quorum" plus a pattern callback. Framed per the product doc as
// "does Quorum actually understand you" rather than "beat the AI" — no
// score, no streak, no points.

'use client'

import { useState } from 'react'

interface Props {
  sessionId:       string
  authToken:       string | null
  predictedChoice: string | null
}

interface RevealState {
  predictionMatched: boolean
  patternCount:      number
}

export default function PredictionReveal({ sessionId, authToken, predictedChoice }: Props) {
  const [finalDecision, setFinalDecision] = useState('')
  const [submitting, setSubmitting]       = useState(false)
  const [error, setError]                 = useState<string | null>(null)
  const [reveal, setReveal]               = useState<RevealState | null>(null)

  async function handleSubmit() {
    const trimmed = finalDecision.trim()
    if (!trimmed) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/session/${sessionId}/decide`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ finalDecision: trimmed }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'save failed')
      }
      const data = await res.json()
      setReveal({ predictionMatched: data.predictionMatched, patternCount: data.patternCount })
    } catch (e) {
      setError(e instanceof Error && e.message === 'Final decision already recorded for this session'
        ? 'You already locked a decision for this session.'
        : 'Couldn\u2019t save that — try again.')
      setSubmitting(false)
    }
  }

  if (reveal) {
    return (
      <div style={revealBoxStyle}>
        <p style={{
          fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
          color: 'var(--gold)', textTransform: 'uppercase', margin: '0 0 10px',
        }}>
          {reveal.predictionMatched ? 'Quorum predicted you' : 'You surprised Quorum'}
        </p>
        <p style={{ fontSize: 15, color: 'var(--text-1)', margin: '0 0 8px', lineHeight: 1.5 }}>
          {reveal.predictionMatched
            ? `Quorum guessed "${predictedChoice}" — and that's what you chose.`
            : `Quorum guessed "${predictedChoice}" — you went a different way.`}
        </p>
        {reveal.patternCount > 0 && (
          <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0, lineHeight: 1.5 }}>
            {reveal.predictionMatched
              ? `You've made a structurally similar choice in ${reveal.patternCount} previous decision${reveal.patternCount === 1 ? '' : 's'}.`
              : `You just broke a pattern that showed up in ${reveal.patternCount} previous decision${reveal.patternCount === 1 ? '' : 's'}.`}
          </p>
        )}
        <p style={{ fontSize: 11.5, color: 'var(--text-4)', margin: '10px 0 0' }}>
          Either way is useful — this is about whether Quorum understands you, not about beating it.
        </p>
      </div>
    )
  }

  return (
    <div style={revealBoxStyle}>
      <p style={{
        fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
        color: 'var(--text-4)', textTransform: 'uppercase', margin: '0 0 10px',
      }}>
        Make your decision
      </p>
      <textarea
        rows={2}
        placeholder="What are you actually going to do?"
        value={finalDecision}
        onChange={e => setFinalDecision(e.target.value)}
        style={{ width: '100%', fontSize: 14, padding: '10px 12px', marginBottom: 10 }}
      />
      {error && <p style={{ fontSize: 12, color: 'var(--danger, #c25454)', margin: '0 0 10px' }}>{error}</p>}
      <button
        type="button"
        className="btn-primary"
        disabled={!finalDecision.trim() || submitting}
        onClick={handleSubmit}
        style={{ padding: '9px 20px', fontSize: 13, opacity: finalDecision.trim() ? 1 : 0.45 }}
      >
        {submitting ? 'Locking it in\u2026' : 'Lock in my decision'}
      </button>
    </div>
  )
}

const revealBoxStyle: React.CSSProperties = {
  border:       '1px solid var(--border-mid)',
  borderRadius: 14,
  padding:      '20px',
  marginTop:    16,
  marginBottom: 16,
  background:   'var(--surface-1)',
}
