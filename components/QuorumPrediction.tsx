// components/QuorumPrediction.tsx
// ── Unified Session, Tier 2 + "worth stealing" pass ─────────────────────────
// Fires once, right after InitialInstinctCapture resolves, and shows
// Quorum's hypothesis while Council/Synthesis continue generating
// underneath. This is a hypothesis about the person ("we think you'll
// choose X"), never a recommendation — see lib/prediction-engine.ts's
// system prompt for the same rule enforced server-side.
//
// If a prediction was already generated in an earlier page load (passed in
// via initialPredictedChoice, read from the session row — see SessionView.tsx),
// this renders it immediately and never calls /api/persona/predict at all.
//
// Reasoning text now reveals via useTypewriter instead of popping in whole —
// not real token streaming (the network wait is unchanged), but it removes
// the jarring spinner-then-instant-block transition. See lib/useTypewriter.ts
// for why this is a client-side reveal, not a backend streaming change.
//
// Point 5 fix: requires an explicit "Continue" click (onContinue) before
// Synthesis reveals, instead of both appearing at once.

'use client'

import { useEffect, useState } from 'react'
import { useTypewriter } from '@/lib/useTypewriter'

interface Props {
  sessionId:               string
  authToken:               string | null
  onPredicted?:            (predictedChoice: string) => void
  onContinue?:             () => void
  alreadyAcknowledged?:    boolean
  initialPredictedChoice?: string | null
  initialReasoning?:       string | null
  initialUsedSearch?:      boolean | null
}

interface PredictionState {
  status: 'loading' | 'done' | 'error'
  predictedChoice?: string
  reasoning?:       string
  usedSearch?:      boolean
  historyCount?:    number
}

export default function QuorumPrediction({
  sessionId, authToken, onPredicted, onContinue, alreadyAcknowledged,
  initialPredictedChoice, initialReasoning, initialUsedSearch,
}: Props) {
  const hydrated = !!initialPredictedChoice
  const [state, setState] = useState<PredictionState>(
    hydrated
      ? { status: 'done', predictedChoice: initialPredictedChoice!, reasoning: initialReasoning ?? '', usedSearch: !!initialUsedSearch }
      : { status: 'loading' }
  )
  // Hydrated (page-refresh) case reveals instantly — the typewriter effect
  // is for the felt-latency moment right after a live call resolves, not
  // something that should replay every time this component remounts.
  const revealedReasoning = useTypewriter(state.status === 'done' ? (state.reasoning ?? '') : null, hydrated ? 0 : 28)
  const displayReasoning = hydrated ? (state.reasoning ?? '') : revealedReasoning

  useEffect(() => {
    if (hydrated) return
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
  }, [sessionId, hydrated])

  useEffect(() => {
    if (state.status === 'error') onContinue?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status])

  if (state.status === 'error') return null

  return (
    <div
      className="sv-fade sv-fade-2"
      style={{
        border:       '1px solid var(--gold-dim, var(--border-mid))',
        borderRadius: 14,
        padding:      '18px 20px',
        marginBottom: 16,
        background:   'var(--bg-card)',
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
          <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>Forming a hypothesis…</p>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 17, color: 'var(--text-1)', margin: '0 0 8px', fontWeight: 600 }}>
            We think you'll choose: {state.predictedChoice}
          </p>
          <p style={{ fontSize: 13.5, color: 'var(--text-2)', margin: '0 0 8px', lineHeight: 1.5, minHeight: '1.5em' }}>
            {displayReasoning}
          </p>
          <p style={{ fontSize: 11.5, color: 'var(--text-4)', margin: '0 0 14px' }}>
            {(state.historyCount ?? 0) > 0
              ? `Based partly on ${state.historyCount} of your past decisions${state.usedSearch ? ' and general patterns' : ''}.`
              : state.usedSearch
                ? 'We don\u2019t know you well yet, so this leans on general patterns rather than your own history.'
                : null}
          </p>
          {!alreadyAcknowledged && (
            <button
              type="button"
              className="btn-primary"
              onClick={onContinue}
              style={{ padding: '8px 18px', fontSize: 13, minHeight: 44 }}
            >
              See Quorum's full read →
            </button>
          )}
        </>
      )}
    </div>
  )
}
