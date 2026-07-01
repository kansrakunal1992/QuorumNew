'use client'
// OpeningCeremonyCard — S2-07: a brief ritual beat shown once the Council is about
// to convene (right after the questions step completes), only on sessions 1–3.
// Auto-dismisses after 3 seconds — same pattern as OntologyRevealCard (S1-01).
// Sequencing: Decision X-Ray (5s) → Opening Ceremony (3s) → first advisor streams.
// Gate: totalSessionCount <= 3. Never shows session 4+ — the marginal orientation
// value is lowest for returning users who already know how Council works.

import { useState, useEffect, useRef } from 'react'

interface Props {
  onDismiss: () => void
}

const DURATION = 3000
const ADVISOR_COUNT = 6

export default function OpeningCeremonyCard({ onDismiss }: Props) {
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
      {/* Six pulsing dots — one per advisor, staggered animation reads as "convening" */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 9, marginBottom: 14 }}>
        {Array.from({ length: ADVISOR_COUNT }).map((_, i) => (
          <span
            key={i}
            style={{
              width:      7,
              height:     7,
              borderRadius: '50%',
              background: 'var(--gold)',
              display:    'inline-block',
              animation:  `ceremonyPulse 1.2s ease-in-out ${i * 0.12}s infinite`,
            }}
          />
        ))}
      </div>

      <p style={{
        fontSize:   13.5,
        fontWeight: 600,
        color:      'var(--text-1)',
        margin:     '0 0 3px',
        letterSpacing: '0.01em',
      }}>
        The Council is convening
      </p>
      <p style={{
        fontSize:   11.5,
        color:      'var(--text-4)',
        margin:     0,
        lineHeight: 1.5,
      }}>
        Six advisors, each reading your decision through a different lens
      </p>

      {/* Progress bar — time remaining */}
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

      <style>{`
        @keyframes ceremonyPulse {
          0%, 100% { opacity: 0.3; transform: scale(0.85); }
          50%      { opacity: 1;   transform: scale(1.15); }
        }
      `}</style>
    </div>
  )
}
