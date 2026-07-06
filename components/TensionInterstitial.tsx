'use client'
// TensionInterstitial — S3-01: a brief beat between "all advisors finished" and
// "synthesis begins," surfacing the shape of disagreement across the Council before
// the verdict arrives. Auto-dismisses after 2.5s — same pattern as OpeningCeremonyCard.
//
// Lean classification comes from each persona's <lean> header tag (proceed/wait/mixed),
// parsed in SessionView from the raw streamed content. If fewer than 4 of 6 advisors
// produced a valid tag (model non-compliance, edge case), falls back to a generic line
// rather than presenting a count that misrepresents the Council.

import { useState, useEffect, useRef } from 'react'

export type Lean = 'proceed' | 'wait' | 'mixed'

interface Props {
  leans: Record<string, Lean>
  onDismiss: () => void
}

const DURATION = 4000  // 1.6x the original 2500ms — gives the beat enough weight to register
const MIN_VALID_LEANS = 4

export default function TensionInterstitial({ leans, onDismiss }: Props) {
  const [progress, setProgress] = useState(0)
  const [visible,  setVisible]  = useState(true)
  const onDismissRef = useRef(onDismiss)
  useEffect(() => { onDismissRef.current = onDismiss }, [onDismiss])

  useEffect(() => {
    if (!visible) return
    const start = Date.now()
    const tick = setInterval(() => {
      const elapsed = Date.now() - start
      const pct = Math.min(100, (elapsed / DURATION) * 100)
      setProgress(pct)
      if (elapsed >= DURATION) {
        clearInterval(tick)
        setVisible(false)
        onDismissRef.current()
      }
    }, 50)
    return () => clearInterval(tick)
  }, [visible])

  if (!visible) return null

  const values      = Object.values(leans)
  const proceedCount = values.filter(l => l === 'proceed').length
  const waitCount     = values.filter(l => l === 'wait').length
  const hasEnoughData = values.length >= MIN_VALID_LEANS

  let headline: string
  let sub: string
  if (!hasEnoughData) {
    headline = 'The Council has finished'
    sub      = 'Synthesis is weighing everything you\u2019ve heard.'
  } else if (proceedCount > 0 && waitCount > 0) {
    headline = `${proceedCount} lean${proceedCount === 1 ? 's' : ''} toward proceeding, ${waitCount} lean${waitCount === 1 ? 's' : ''} toward waiting`
    sub      = 'Synthesis is weighing the tension between them.'
  } else {
    headline = 'The Council largely agrees'
    sub      = 'Synthesis is bringing the perspectives together.'
  }

  return (
    <div
      className="sv-fade sv-fade-2"
      style={{
        background:   'var(--bg-card)',
        border:       '1px solid var(--border-mid)',
        borderRadius: 13,
        padding:      '20px 20px 16px',
        marginBottom: 12,
        textAlign:    'center',
      }}
    >
      <p style={{
        fontSize:   13.5,
        fontWeight: 600,
        color:      'var(--text-1)',
        margin:     '0 0 3px',
        letterSpacing: '0.01em',
      }}>
        {headline}
      </p>
      <p style={{
        fontSize:   11.5,
        color:      'var(--text-4)',
        margin:     0,
        lineHeight: 1.5,
      }}>
        {sub}
      </p>

      <div style={{
        height:       2,
        background:   'var(--border-dim)',
        borderRadius: 1,
        overflow:     'hidden',
        marginTop:    16,
      }}>
        <div style={{
          height:     '100%',
          width:      `${progress}%`,
          background: 'var(--gold)',
          borderRadius: 1,
          transition: 'width 0.05s linear',
        }} />
      </div>
    </div>
  )
}
