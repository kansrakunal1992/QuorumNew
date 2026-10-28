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
// are actually going to do, after seeing the full read.

'use client'

import { useEffect, useRef, useState } from 'react'
import SessionComposer from '@/components/SessionComposer'
import { track } from '@/lib/track'   // Phase 1: first-party events
import { finalChoicesFor } from '@/lib/final-choice'   // v12: the same options shown on the confirm screen, as taps

interface Props {
  sessionId:             string
  authToken:             string | null
  predictedChoice:       string | null
  initialInstinctLabel?: string | null
  /** Phase 1: now also reports the review date that was just saved. */
  onDecided?:            (info?: { reviewDate: string }) => void
  /**
   * Phase 1: starting review date, in days. Callers pass a shorter default for
   * low-stakes decisions (a 30-day check on "should I reply to this?" is too
   * slow to ever feel relevant). Ignored once the person has picked a date.
   */
  defaultReviewDays?:    number
  alreadyDecided?:       boolean
  initialMatched?:       boolean | null
  /**
   * v12: the session's own option labels (the same ones shown on the confirm screen) as tappable choices. Fewer than two
   * -> the box stays a plain text field, exactly as before.
   */
  optionLabels?:         string[]
  /** v12: the option they tapped as their first lean (full label), so it can be marked for comparison. */
  firstLeanLabel?:       string | null
  /**
   * v12: one of their first few decisions. Quorum's guess was then made from how people generally decide, not from their
   * history, so the reveal says so instead of implying it already knows them.
   */
  earlyUser?:            boolean
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
  sessionId, authToken, predictedChoice, initialInstinctLabel, onDecided, alreadyDecided, initialMatched, defaultReviewDays,
  optionLabels, firstLeanLabel, earlyUser,
}: Props) {
  // v12: tappable options (same labels as the confirm screen) + "Something else" (free text). null -> text box only.
  const choices = finalChoicesFor(optionLabels, firstLeanLabel)
  const [picked, setPicked]             = useState<string | null>(null)   // a choice's full label, or 'other'
  const [chosenOption, setChosenOption] = useState<string | null>(null)   // sent so the match with Quorum's guess is exact
  // 'compose' -> 'review' -> locked (reveal shown)
  const [phase, setPhase]           = useState<'compose' | 'review'>('compose')
  const [draftDecision, setDraft]   = useState('')
  const [reviewDate, setReviewDate] = useState(todayPlusDays(defaultReviewDays ?? 30))
  // Phase 1: true once the person picks a chip or edits the date -- after that
  // a late-arriving defaultReviewDays (stakes tags land asynchronously) must
  // not overwrite their choice.
  const reviewTouched = useRef(false)
  const reviewViaChip = useRef(false)
  useEffect(() => {
    if (!reviewTouched.current && defaultReviewDays) setReviewDate(todayPlusDays(defaultReviewDays))
  }, [defaultReviewDays])
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
        body: JSON.stringify({ finalDecision: draftDecision.trim(), ...(chosenOption ? { chosenOptionLabel: chosenOption } : {}) }),
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
      track('review_date_chosen', {
        days_out: Math.max(0, Math.round((new Date(`${reviewDate}T12:00:00`).getTime() - Date.now()) / 86_400_000)),
        via_chip: reviewViaChip.current,
      }, { sessionId })
      onDecided?.({ reviewDate })
    } catch (e) {
      setError(e instanceof Error && e.message === 'Final decision already recorded for this session'
        ? 'You already locked a decision for this session.'
        : 'Couldn\u2019t save that — try again.')
      setPhase('compose')
      setSubmitting(false)
    }
  }

  if (reveal) {
    // v12: if Quorum's guess never arrived, say nothing about a guess (it used to read 'Quorum guessed "null"').
    if (!predictedChoice) {
      return (
        <div style={revealBoxStyle}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', color: 'var(--gold)', textTransform: 'uppercase', margin: '0 0 10px' }}>
            Decision locked
          </p>
          <p style={{ fontSize: 15, color: 'var(--text-1)', margin: 0, lineHeight: 1.5 }}>
            That's recorded. Quorum will bring it back to you on your review date.
          </p>
        </div>
      )
    }
    // v12: for a person's first few decisions Quorum's guess came from how people generally decide, not from their own
    // history — so it is called a first guess, and the footer says it is still learning them.
    const heading = earlyUser
      ? (reveal.predictionMatched ? 'Quorum\u2019s first guess matched' : 'Quorum guessed differently')
      : (reveal.predictionMatched ? 'Quorum predicted you' : 'You surprised Quorum')
    const lead = earlyUser ? 'From what you\u2019d told it, Quorum guessed' : 'Quorum guessed'
    return (
      <div style={revealBoxStyle}>
        <p style={{
          fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
          color: 'var(--gold)', textTransform: 'uppercase', margin: '0 0 10px',
        }}>
          {heading}
        </p>
        <p style={{ fontSize: 15, color: 'var(--text-1)', margin: '0 0 8px', lineHeight: 1.5 }}>
          {reveal.predictionMatched
            ? `${lead} \"${predictedChoice}\" -- and that's what you chose.`
            : `${lead} \"${predictedChoice}\" -- you went a different way.`}
        </p>
        {reveal.patternCount > 0 && (
          <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0, lineHeight: 1.5 }}>
            {reveal.predictionMatched
              ? `You've made a structurally similar choice in ${reveal.patternCount} previous decision${reveal.patternCount === 1 ? '' : 's'}.`
              : `You just broke a pattern that showed up in ${reveal.patternCount} previous decision${reveal.patternCount === 1 ? '' : 's'}.`}
          </p>
        )}
        <p style={{ fontSize: 11.5, color: 'var(--text-4)', margin: '10px 0 0' }}>
          {earlyUser
            ? 'It doesn\u2019t know you yet \u2014 each decision is how it starts to learn the way you decide.'
            : 'Either way is useful -- this is about whether Quorum understands you, not about beating it.'}
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
          You started out {initialInstinctLabel}. Now that you've seen the full
          read, what are you actually going to do?
        </p>
      )}
      {/* A failed save returns here (phase 'compose'); the message used to be rendered only on the review step, so the
          person saw the box silently reset with no explanation. */}
      {error && <p role="alert" style={{ fontSize: 12, color: 'var(--danger, #c25454)', margin: '0 0 10px' }}>{error}</p>}
      {choices ? (
        <>
          {/* v12: the same options as the confirm screen, one tap each — so what they chose now can be compared with where
              they leaned, and with Quorum's guess, exactly. "Something else" opens the text box below. */}
          <div role="radiogroup" aria-label="What are you actually going to do?" style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '0 0 12px' }}>
            {choices.map(c => {
              const sel = picked === c.fullLabel
              return (
                <button key={c.fullLabel} type="button" role="radio" aria-checked={sel}
                  onClick={() => setPicked(c.fullLabel)}
                  style={{
                    textAlign: 'left', padding: '11px 14px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14.5, lineHeight: 1.35, minHeight: 44,
                    border: sel ? '2px solid var(--gold)' : '1px solid var(--border-mid)',
                    background: sel ? 'var(--gold-dim)' : 'var(--bg-inset)', color: sel ? 'var(--text-1)' : 'var(--text-2)',
                  }}>
                  {c.label}
                  {c.isFirstLean && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-3)', marginTop: 2 }}>Your first lean</span>}
                </button>
              )
            })}
            <button type="button" role="radio" aria-checked={picked === 'other'}
              onClick={() => setPicked('other')}
              style={{
                textAlign: 'left', padding: '11px 14px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14.5, minHeight: 44,
                border: picked === 'other' ? '2px solid var(--gold)' : '1px dashed var(--border-mid)',
                background: picked === 'other' ? 'var(--gold-dim)' : 'transparent', color: picked === 'other' ? 'var(--text-1)' : 'var(--text-3)',
              }}>
              Something else
            </button>
          </div>
          {picked === 'other' && (
            <SessionComposer
              placeholder="What are you actually going to do?"
              initialValue={chosenOption ? '' : draftDecision}
              submitLabel="Review"
              onSubmit={(text) => { setDraft(text); setChosenOption(null); setPhase('review') }}
            />
          )}
          {picked && picked !== 'other' && (
            <button type="button" className="btn-primary" style={{ padding: '10px 20px', fontSize: 13, minHeight: 44 }}
              onClick={() => { setDraft(picked); setChosenOption(picked); setPhase('review') }}>
              Review
            </button>
          )}
        </>
      ) : (
        <SessionComposer
          placeholder="What are you actually going to do?"
          initialValue={draftDecision}
          submitLabel="Review"
          onSubmit={(text) => { setDraft(text); setPhase('review') }}
        />
      )}
      <label style={{ display: 'block', fontSize: 11.5, color: 'var(--text-3)', margin: '12px 0 6px' }}>
        When should Quorum bring this back to you? (required)
      </label>
      {/* Phase 1: quick picks. A small decision resolves in days, not a month. */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0 0 8px' }}>
        {[
          { label: 'In 3 days',  days: 3  },
          { label: 'In 1 week',  days: 7  },
          { label: 'In 1 month', days: 30 },
        ].map(opt => {
          const selected = reviewDate === todayPlusDays(opt.days)
          return (
            <button
              key={opt.days}
              type="button"
              onClick={() => { reviewTouched.current = true; reviewViaChip.current = true; setReviewDate(todayPlusDays(opt.days)) }}
              style={{
                padding: '8px 14px', fontSize: 12.5, borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
                border: `1px solid ${selected ? 'var(--gold)' : 'var(--border-dim)'}`,
                background: selected ? 'rgba(201,168,76,0.1)' : 'var(--bg-inset)',
                color: selected ? 'var(--gold)' : 'var(--text-3)',
                minHeight: 38,
              }}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
      <input
        type="date"
        value={reviewDate}
        min={todayPlusDays(1)}
        onChange={e => { reviewTouched.current = true; reviewViaChip.current = false; setReviewDate(e.target.value) }}
        style={{
          fontSize:     16,
          padding:      '9px 10px',
          borderRadius: 8,
          border:       '1px solid var(--border-dim)',
          background:   'var(--bg-inset)',
          color:        'var(--text-1)',
          fontFamily:   'inherit',
          boxSizing:    'border-box',
        }}
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
