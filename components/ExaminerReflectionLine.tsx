// components/ExaminerReflectionLine.tsx
// ── Unified session, point 3 ────────────────────────────────────────────────
// Self-contained so it can't affect ExaminerPanel's own state machine if
// something goes wrong — worst case it renders nothing. Fetches once on
// mount; not named "Reflection" in the UI to avoid confusion with the
// pre-existing E0 "REFLECTION" (emotional/inward) question badge elsewhere
// in ExaminerPanel — this is a different concept (paraphrase-back, not a
// question type).

'use client'

import { useEffect, useState } from 'react'

interface Props {
  sessionId: string
}

export default function ExaminerReflectionLine({ sessionId }: Props) {
  const [line, setLine] = useState<string | null>(null)

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
    }}>
      {line}
    </p>
  )
}
