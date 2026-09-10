// components/QuorumPrediction.tsx
// ── Unified Session, Tier 2 ────────────────────────────────────────────────
// Fires once, right after InitialInstinctCapture resolves, and shows
// Quorum's hypothesis while Council/Synthesis continue generating
// underneath. This is a hypothesis about the person ("we think you'll
// choose X"), never a recommendation — see lib/prediction-engine.ts's
// system prompt for the same rule enforced server-side.

'use client'

import { useEffect, useState } from 'react'

interface Props {
  sessionId:    string
  authToken:    string | null
  onPredicted?: (predictedChoice: string) => void
}

interface PredictionState {
  status: 'loading' | 'done' | 'error'
  predictedChoice?: string
  reasoning?:       string
  usedSearch?:      boolean
  historyCount?:    number
}

export default function QuorumPrediction({ sessionId, authToken, onPredicted }: Props) {
  const [state, setState] = useState<PredictionState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    async function run() {
      try {
        const res = await fetch('/api/persona/predict', {
          method:  'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({ sessionId }),
        })
        if (!res.ok) throw new Error('predict failed')
        const data = await res.json()
        if (!cancelled) {
          setState({
            status:          'done',
            predictedChoice: data.predictedChoice,
            reasoning:        data.reasoning,
            usedSearch:       data.usedSearch,
            historyCount:     data.historyCount,
          })
          if (data.predictedChoice) onPredicted?.(data.predictedChoice)
        }
      } catch {
        if (!cancelled) setState({ status: 'error' })
      }
    }
    run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  if (state.status === 'error') return null // degrade silently — Council/Synthesis don't depend on this

  return (
    <div
      className="sv-fade sv-fade-2"
      style={{
        border:       '1px solid var(--gold-dim, var(--border-mid))',
        borderRadius: 14,
        padding:      '18px 20px',
        marginBottom: 16,
        background:   'var(--surface-1)',
      }}
    >
      <p style={{
        fontFamily:    'var(--font-mono)',
        fontSize:      11,
        letterSpacing: '0.06em',
        color:         'var(--gold)',
        margin:        '0 0 10px',
        textTransform: 'uppercase',
      }}>
        Quorum's hypothesis
      </p>

      {state.status === 'loading' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)', animation: 'blink 1.2s ease-in-out infinite' }} />
          <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>Forming a hypothesis\u2026</p>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 17, color: 'var(--text-1)', margin: '0 0 8px', fontWeight: 600 }}>
            We think you'll choose: {state.predictedChoice}
          </p>
          <p style={{ fontSize: 13.5, color: 'var(--text-2)', margin: '0 0 8px', lineHeight: 1.5 }}>
            {state.reasoning}
          </p>
          <p style={{ fontSize: 11.5, color: 'var(--text-4)', margin: 0 }}>
            {(state.historyCount ?? 0) > 0
              ? `Based partly on ${state.historyCount} of your past decisions${state.usedSearch ? ' and general patterns' : ''}.`
              : state.usedSearch
                ? 'We don\u2019t know you well yet, so this leans on general patterns rather than your own history.'
                : null}
          </p>
        </>
      )}
    </div>
  )
}
