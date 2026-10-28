'use client'

// components/SpecificityCheck.tsx
// ── "Did this feel specific to you?" — one tap, after the Council (v10) ──────
//
// The shortened journey asks for less before the Council runs, so the real risk is a first result that reads
// generic. This is the one place that risk is measured: a single tap after the synthesis, recorded as an id
// (yes | partly | no) — never text. It replaces the "did this capture what you're really deciding?" tap that used
// to sit on the confirm screen, which measured the summary rather than the Council.
//
// Shown for a person's first few decisions only (the activation window), once per session, and never blocks
// or moves anything around it.

import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { track } from '@/lib/track'

interface Props {
  sessionId: string
}

type Answer = 'yes' | 'partly' | 'no'

const OPTIONS: { value: Answer; label: string }[] = [
  { value: 'yes',    label: 'Yes' },
  { value: 'partly', label: 'Partly' },
  { value: 'no',     label: 'Not really' },
]

const storageKey = (sessionId: string) => `quorum:specific:${sessionId}`

export default function SpecificityCheck({ sessionId }: Props) {
  const [answer, setAnswer] = useState<Answer | null>(null)

  // A refresh must not ask again: remember the answer on this device, for this session.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey(sessionId))
      if (saved === 'yes' || saved === 'partly' || saved === 'no') setAnswer(saved)
    } catch { /* storage unavailable — the check simply shows */ }
  }, [sessionId])

  function pick(value: Answer) {
    if (answer) return
    setAnswer(value)
    track('council_specificity_feedback', { specific: value }, { sessionId })
    try { window.localStorage.setItem(storageKey(sessionId), value) } catch { /* fine */ }
  }

  const chip = (sel: boolean): CSSProperties => ({
    padding: '6px 12px', borderRadius: 999, fontSize: 13.5, lineHeight: 1.3, cursor: answer ? 'default' : 'pointer',
    border: sel ? '2px solid var(--gold)' : '1px solid var(--border-mid)',
    background: sel ? 'var(--gold-dim)' : 'var(--bg-card)', color: sel ? 'var(--text-1)' : 'var(--text-2)',
    opacity: answer && !sel ? 0.5 : 1,
  })

  return (
    <div
      role="group"
      aria-label="Did this feel specific to you?"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--text-3)', margin: '4px 0 12px' }}
    >
      <span>Did this feel specific to you?</span>
      {OPTIONS.map(o => (
        <button key={o.value} type="button" aria-pressed={answer === o.value} disabled={answer !== null}
          onClick={() => pick(o.value)} style={chip(answer === o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
