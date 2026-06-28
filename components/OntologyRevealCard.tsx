'use client'
// OntologyRevealCard — "Decision X-Ray" shown on sessions 1–3 only.
// Appears after ontologyReady fires, auto-dismisses after 5 seconds.
// Shows the 3 highest-scoring dimensions of the decision in plain English.
// Gate: totalSessionCount <= 3. Never shows session 4+.

import { useState, useEffect, useRef } from 'react'
import { getTopDimensions } from '@/lib/session-labels'

interface Props {
  ontologyVector: Record<string, { score: number; confidence: number }>
  onDismiss: () => void
}

const DURATION = 5000

export default function OntologyRevealCard({ ontologyVector, onDismiss }: Props) {
  const [progress,  setProgress]  = useState(0)
  const [visible,   setVisible]   = useState(true)
  const onDismissRef = useRef(onDismiss)
  useEffect(() => { onDismissRef.current = onDismiss }, [onDismiss])

  const dims = getTopDimensions(ontologyVector)

  useEffect(() => {
    if (!visible || dims.length === 0) return
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
  }, [dims.length, visible])

  if (!visible || dims.length === 0) return null

  return (
    <div
      className="sv-fade sv-fade-2"
      style={{
        background:   'var(--bg-card)',
        border:       '1px solid var(--border-mid)',
        borderRadius: 13,
        padding:      '16px 20px 14px',
        marginBottom: 12,
      }}
    >
      {/* Label */}
      <p style={{
        fontFamily:    'var(--font-mono)',
        fontSize:      10,
        fontWeight:    700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color:         'var(--text-4)',
        margin:        '0 0 10px',
      }}>
        The Council reads this decision as
      </p>

      {/* Dimension chips */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 13 }}>
        {dims.map(label => (
          <span key={label} style={{
            fontSize:     12,
            fontWeight:   600,
            color:        'var(--gold)',
            background:   'var(--gold-glow)',
            border:       '1px solid var(--border-mid)',
            borderRadius: 6,
            padding:      '4px 11px',
            lineHeight:   1.4,
          }}>
            {label}
          </span>
        ))}
      </div>

      {/* Progress bar — time remaining */}
      <div style={{
        height:       2,
        background:   'var(--border-dim)',
        borderRadius: 1,
        overflow:     'hidden',
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
