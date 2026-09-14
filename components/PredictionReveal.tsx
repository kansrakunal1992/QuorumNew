// components/PredictionReveal.tsx
// ── Unified Session, Tier 2 + "worth stealing" pass ─────────────────────────
// The "make your decision" + reveal moment. Three states now instead of two:
// composing (SessionComposer, same shared box used in SynthesisChallenge),
// reviewing (a brief "here's what you typed — confirm or edit" checkpoint,
// since this step is compulsory and one-shot), then revealed.
//
// Point 4: this owns the review-date field that used to live in
// components/DecisionStateCard.tsx ("Decision position"), which is skipped
// under the flag in SessionView.tsx. Review date is required. Saved through
// the same /api/session/commitment endpoint DecisionStateCard used, so
// existing review-date nudge cron jobs pick it up identically either way.
//
// Point 6: this is deliberately NOT the same moment as InitialInstinctCapture
// — that locked a gut lean before Quorum said anything; this locks what you
// are actually going to do, after seeing the hypothesis and the full read.

'use client'

import { useState } from 'react'
import SessionComposer from '@/components/SessionComposer'

interface Props {
  sessionId:             string
  authToken:             string | null
  predictedChoice:       string | null
  initialInstinctLabel?: string | null
  onDecided?:            () => void
  alreadyDecided?:       boolean
  initialMatched?:       boolean | null
}

interface RevealState {
  predictionMatched: boolean
  patternCount:      number
}

function todayPlusDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export default function PredictionReveal({
  sessionId, authToken, predictedChoice, initialInstinctLabel, onDecided, alreadyDecided, initialMatched,
}: Props) {
  // 'compose' -> 'review' -> locked (reveal shown)
  const [phase, setPhase]           = useState<'compose' | 'review'>('compose')
  const [draftDecision, setDraft]   = useState('')
  const [reviewDate, setReviewDate] = useState(todayPlusDays(30))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [reveal, setReveal]         = useState<RevealState | null>(
    alreadyDecided ? { predictionMatched: !!initialMatched, patternCount: 0 } : null
  )

  async function handleConfirmLock() {
    if (!draftDecision.trim() || !reviewDate) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/session/${sessionId}/decide`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ finalDecision: draftDecision.trim() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'save failed')
      }
      const data = await res.json()

      // Same endpoint DecisionStateCard used to call — keeps the existing
      // review-date nudge cron jobs working. Best-effort: a failure here
      // shouldn't block the reveal, which already saved via /decide above.
      fetch('/api/session/commitment', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ sessionId, leaning: draftDecision.trim(), switch_condition: null, review_date: reviewDate }),
      }).catch(() => {})

      setReveal({ predictionMatched: data.predictionMatched, patternCount: data.patternCount })
      onDecided?.()
    } catch (e) {
      setError(e instanceof Error && e.message === 'Final decision already recorded for this session'
        ? 'You already locked a decision for this session.'
        : 'Couldn\u2019t save that — try again.')
      setPhase('compose')
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

  if (phase === 'review') {
    return (
      <div style={{ ...revealBoxStyle, borderLeft: '3px solid var(--gold)' }}>
        <p style={{
          fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
          color: 'var(--text-4)', textTransform: 'uppercase', margin: '0 0 10px',
        }}>
          Review before locking — this can\u2019t be edited after
        </p>
        <p style={{ fontSize: 15, color: 'var(--text-1)', margin: '0 0 8px', lineHeight: 1.5 }}>
          {draftDecision}
        </p>
        <p style={{ fontSize: 12.5, color: 'var(--text-3)', margin: '0 0 16px' }}>
          Review on {reviewDate}
        </p>
        {error && <p style={{ fontSize: 12, color: 'var(--danger, #c25454)', margin: '0 0 10px' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn-primary"
            disabled={submitting}
            onClick={handleConfirmLock}
            style={{ padding: '10px 20px', fontSize: 13, minHeight: 44 }}
          >
            {submitting ? 'Locking it in…' : 'Confirm & lock'}
          </button>
          <button type="button" className="btn-ghost" onClick={() => setPhase('compose')} style={{ minHeight: 44 }}>
            Edit
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ ...revealBoxStyle, borderLeft: '3px solid var(--gold)' }}>
      <p style={{
        fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
        color: 'var(--text-4)', textTransform: 'uppercase', margin: '0 0 10px',
      }}>
        Make your decision — required to close this record
      </p>
      {initialInstinctLabel && (
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 10px', lineHeight: 1.5 }}>
          You started out {initialInstinctLabel}. Now that you've seen Quorum's hypothesis and full
          read, what are you actually going to do?
        </p>
      )}
      <SessionComposer
        placeholder="What are you actually going to do?"
        initialValue={draftDecision}
        submitLabel="Review"
        onSubmit={(text) => { setDraft(text); setPhase('review') }}
      />
      <label style={{ display: 'block', fontSize: 11.5, color: 'var(--text-3)', margin: '12px 0 6px' }}>
        When should Quorum bring this back to you? (required)
      </label>
      <input
        type="date"
        value={reviewDate}
        min={todayPlusDays(1)}
        onChange={e => setReviewDate(e.target.value)}
        style={{ fontSize: 16, padding: '9px 10px' }}
        required
      />
    </div>
  )
}

const revealBoxStyle: React.CSSProperties = {
  border:       '1px solid var(--border-mid)',
  borderRadius: 14,
  padding:      '20px',
  marginTop:    16,
  marginBottom: 16,
  background:   'var(--bg-card)',
}
