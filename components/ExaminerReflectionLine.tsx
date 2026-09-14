// components/ExaminerReflectionLine.tsx
// ── Unified session, point 3 + "worth stealing" pass ────────────────────────
// Self-contained so it can't affect ExaminerPanel's own state machine if
// something goes wrong — worst case it renders nothing. Fetches once on
// mount; not named "Reflection" in the UI to avoid confusion with the
// pre-existing E0 "REFLECTION" (emotional/inward) question badge elsewhere
// in ExaminerPanel — this is a different concept (paraphrase-back, not a
// question type).
//
// Reveals via useTypewriter rather than popping in whole, matching the same
// treatment given to QuorumPrediction's reasoning text — see
// lib/useTypewriter.ts for why this is a client-side reveal, not real
// backend streaming.

'use client'

import { useEffect, useState } from 'react'
import { useTypewriter } from '@/lib/useTypewriter'

interface Props {
  sessionId: string
}

export default function ExaminerReflectionLine({ sessionId }: Props) {
  const [line, setLine] = useState<string | null>(null)
  const revealed = useTypewriter(line, 28)

  useEffect(() => {
    let cancelled = false
    fetch('/api/persona/reflect', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sessionId }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d?.line) setLine(d.line) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [sessionId])

  if (!line) return null

  return (
    <p style={{
      fontSize:   13,
      color:      'var(--text-3)',
      fontStyle:  'italic',
      lineHeight: 1.6,
      margin:     '14px 20px 0',
      minHeight:  '1.6em',
    }}>
      {revealed}
    </p>
  )
}
