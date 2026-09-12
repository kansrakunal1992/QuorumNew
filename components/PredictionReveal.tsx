// components/PredictionReveal.tsx
// ── Unified Session, Tier 2 ────────────────────────────────────────────────
// The "make your decision" + reveal moment. Two states: before submission,
// a plain input for the final call plus a compulsory review date; after,
// "Quorum predicted you" / "You surprised Quorum" plus a pattern callback.
// Framed per the product doc as "does Quorum actually understand you"
// rather than "beat the AI" — no score, no streak, no points.
//
// Point 4: this now also owns the review-date field that used to live in
// components/DecisionStateCard.tsx ("Decision position"), which is skipped
// under the flag in SessionView.tsx — the two were visually overlapping,
// both capturing "where you stand" right after Synthesis. Review date is
// required here (DecisionStateCard's was optional) since the doc doesn't
// want compulsory left ambiguous, and it's saved through the exact same
// /api/session/commitment endpoint DecisionStateCard used, so the existing
// review-date nudge cron jobs pick it up identically either way.
//
// Point 4 also fixed the visual overlap directly: this and DecisionStateCard
// no longer both render at once.
//
// Point 6/2: there is deliberately no skip/dismiss button here — see
// SessionView.tsx, which withholds RecordReceipt until onDecided fires.
//
// Point 6: this is deliberately NOT the same moment as InitialInstinctCapture
// — that locked a gut lean before Quorum said anything; this locks what you
// are actually going to do, after seeing the hypothesis and the full read.
// initialInstinctLabel makes that relationship explicit instead of leaving
// the user to infer why they're being asked for "a decision" twice.

'use client'

import { useState } from 'react'

interface Props {
  sessionId:             string
  authToken:             string | null
  predictedChoice:       string | null
  initialInstinctLabel?: string | null   // e.g. "leaning yes" — see SessionView
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
  const [finalDecision, setFinalDecision] = useState('')
  const [reviewDate, setReviewDate]       = useState(todayPlusDays(30)) // sensible default, still requires the user to confirm/change it
  const [submitting, setSubmitting]       = useState(false)
  const [error, setError]                 = useState<string | null>(null)
  const [reveal, setReveal]               = useState<RevealState | null>(
    alreadyDecided ? { predictionMatched: !!initialMatched, patternCount: 0 } : null
  )

  async function handleSubmit() {
    const trimmed = finalDecision.trim()
    if (!trimmed || !reviewDate) return
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

      // Same endpoint DecisionStateCard used to call — keeps the existing
      // review-date nudge cron jobs working exactly as before. Best-effort:
      // a failure here shouldn't block the reveal, which already saved
      // successfully via /decide above.
      fetch('/api/session/commitment', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ sessionId, leaning: trimmed, switch_condition: null, review_date: reviewDate }),
      }).catch(() => {})

      setReveal({ predictionMatched: data.predictionMatched, patternCount: data.patternCount })
      onDecided?.()
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

  const canSubmit = !!finalDecision.trim() && !!reviewDate && !submitting

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
      <textarea
        rows={2}
        placeholder="What are you actually going to do?"
        value={finalDecision}
        onChange={e => setFinalDecision(e.target.value)}
        style={{ width: '100%', fontSize: 16, padding: '10px 12px', marginBottom: 10 }}
      />
      <label style={{ display: 'block', fontSize: 11.5, color: 'var(--text-3)', margin: '0 0 6px' }}>
        When should Quorum bring this back to you? (required)
      </label>
      <input
        type="date"
        value={reviewDate}
        min={todayPlusDays(1)}
        onChange={e => setReviewDate(e.target.value)}
        style={{ fontSize: 16, padding: '9px 10px', marginBottom: 10 }}
        required
      />
      {error && <p style={{ fontSize: 12, color: 'var(--danger, #c25454)', margin: '0 0 10px' }}>{error}</p>}
      <div>
        <button
          type="button"
          className="btn-primary"
          disabled={!canSubmit}
          onClick={handleSubmit}
          style={{ padding: '9px 20px', fontSize: 13, opacity: canSubmit ? 1 : 0.45 }}
        >
          {submitting ? 'Locking it in…' : 'Lock in my decision'}
        </button>
      </div>
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
