'use client'

// components/DecisionBriefPanel.tsx
// ── Natural Intake (v7) — "What I've got so far" ─────────────────────────────
//
// The decision brief, filling in as the person talks. Two jobs:
//   1. Show WHY each question is being asked: a row that is still open is the
//      thing Quorum is about to ask about.
//   2. Let a power user see at a glance that it is nearly done — and fix
//      anything wrong with one tap (a row tap puts "About <that>:" in the input).
//
// Copy-lock rules (docs/COPY_AND_STRUCTURE_LOCK_v1.md) still hold: no internal
// terms, and NO numeric progress — the collapsed header is a small dot meter
// and a plain sentence, never "3 of 6". Collapsed by default so the thread
// stays the main thing on screen.

import { useMemo, useState } from 'react'
import type { ChatDecisionState } from '@/lib/types'
import { KIND_LABELS, briefRows, briefStatus } from '@/lib/chat-intake-brief'

interface Props {
  state:      ChatDecisionState | null
  /** Tapping a row hands the label back so the input can start with "About …:". */
  onEditRow?: (label: string) => void
}

export default function DecisionBriefPanel({ state, onEditRow }: Props) {
  const [open, setOpen] = useState(false)

  const view = useMemo(() => {
    if (!state) return null
    const rows   = briefRows(state)
    const status = briefStatus(state)
    return { rows, status }
  }, [state])

  // Nothing worth showing until Quorum has understood at least one thing.
  if (!state || !view || (!view.rows.some(r => r.status === 'known') && !state.decisionStatement)) return null

  const { rows, status } = view
  const required = rows.filter(r => r.required)
  const kind     = state.decisionKind ? KIND_LABELS[state.decisionKind] : null
  const summary  = status.ready
    ? 'I\u2019ve got the picture'
    : status.resolved === 0
      ? 'Getting the picture'
      : 'Filling in the picture'

  return (
    <div style={{
      margin: '0 20px', border: '1px solid var(--border-dim)', borderRadius: 14,
      background: 'var(--bg-card)', overflow: 'hidden',
    }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '9px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        {/* Dot meter — one dot per thing we need, filled once known/flagged. Never a number. */}
        <span aria-hidden style={{ display: 'flex', gap: 4 }}>
          {required.map(r => (
            <span key={r.key} style={{
              width: 6, height: 6, borderRadius: 999,
              background: r.status === 'open' ? 'var(--border-mid)' : 'var(--gold)',
              opacity: r.status === 'unknown' ? 0.5 : 1,
            }} />
          ))}
        </span>
        <span style={{ flex: 1, fontSize: 13, color: 'var(--text-2)' }}>
          {summary}{kind ? <span style={{ color: 'var(--text-4)' }}> · {kind}</span> : null}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{open ? 'Hide' : 'See'}</span>
      </button>

      {open && (
        <div style={{ padding: '2px 14px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {state.decisionStatement && (
            <p style={{ fontSize: 13.5, color: 'var(--text-1)', lineHeight: 1.45, margin: '0 0 8px' }}>
              {state.decisionStatement}
            </p>
          )}
          {rows.map(r => (
            <button
              key={r.key}
              type="button"
              onClick={() => onEditRow?.(r.label)}
              title="Tap to correct or add to this"
              style={{
                display: 'flex', gap: 10, alignItems: 'baseline', textAlign: 'left',
                background: 'none', border: 'none', padding: '5px 0', cursor: onEditRow ? 'pointer' : 'default',
              }}
            >
              <span style={{ flex: '0 0 38%', fontSize: 12.5, color: 'var(--text-3)' }}>{r.label}</span>
              <span style={{
                flex: 1, fontSize: 13, lineHeight: 1.4,
                color: r.status === 'known' ? 'var(--text-1)' : 'var(--text-4)',
                fontStyle: r.status === 'known' ? 'normal' : 'italic',
              }}>
                {r.status === 'known' ? r.value : r.status === 'unknown' ? 'Not sure yet \u2014 worth finding out' : 'Still open'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
