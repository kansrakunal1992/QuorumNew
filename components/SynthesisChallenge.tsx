// components/SynthesisChallenge.tsx
// ── Unified Session, point 1 ────────────────────────────────────────────────
// "Challenge Quorum" needs to live where the user is actually looking in
// this experience — next to Synthesis — not require expanding the Council
// and finding a specific persona's own pushback box first. Same structured-
// reason-chip pattern as PersonaPanel's per-persona challenge (kept
// consistent), but submits via onSubmit, which SessionView wires straight
// to the existing handleShareContext('synthesis', text) — the same
// broadcast-to-all-six-advisors-then-resynthesize pipeline PersonaPanel's
// own challenge already uses. No new backend behavior, just a better front
// door onto the one that exists.

'use client'

import { useState } from 'react'

interface Props {
  onSubmit:  (text: string) => void
  disabled?: boolean
}

const REASONS: { value: string; label: string; prefill: string }[] = [
  { value: 'priorities', label: 'Misread my priorities',      prefill: 'You misunderstood what actually matters to me here: ' },
  { value: 'risk',       label: 'Missed a risk',              prefill: 'You missed a risk that matters: ' },
  { value: 'situation',  label: 'Misread the situation',      prefill: 'You misunderstood the actual situation: ' },
  { value: 'disagree',   label: 'I disagree with the take',   prefill: 'I disagree with this because: ' },
  { value: 'missing',    label: 'You\u2019re missing information', prefill: 'There\u2019s information you don\u2019t have: ' },
]

export default function SynthesisChallenge({ onSubmit, disabled }: Props) {
  const [open, setOpen]         = useState(false)
  const [reason, setReason]     = useState<string | null>(null)
  const [text, setText]         = useState('')
  const [sent, setSent]         = useState(false)

  if (sent) {
    return (
      <p style={{ fontSize: 12.5, color: 'var(--text-3)', margin: '10px 0 0' }}>
        Sent to the full council for reassessment \u2014 the read above will update.
      </p>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="btn-ghost"
        style={{ fontSize: 12.5, padding: '6px 12px', marginTop: 10, opacity: disabled ? 0.5 : 1 }}
      >
        Disagree / ask a follow-up
      </button>
    )
  }

  return (
    <div style={{ marginTop: 12, padding: '12px 14px', border: '1px solid var(--border-dim)', borderRadius: 12, background: 'var(--bg-card-alt)' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {REASONS.map(r => (
          <button
            key={r.value}
            type="button"
            onClick={() => { setReason(r.value); if (!text.trim()) setText(r.prefill) }}
            style={{
              padding:      '4px 10px',
              fontSize:     11.5,
              borderRadius: 999,
              border:       `1px solid ${reason === r.value ? 'var(--gold)' : 'var(--border-dim)'}`,
              background:   reason === r.value ? 'rgba(201,168,76,0.12)' : 'transparent',
              color:        reason === r.value ? 'var(--gold)' : 'var(--text-4)',
              cursor:       'pointer',
            }}
          >
            {r.label}
          </button>
        ))}
      </div>
      <textarea
        rows={2}
        placeholder="Say what you actually think Quorum got wrong\u2026"
        value={text}
        onChange={e => setText(e.target.value)}
        style={{ width: '100%', fontSize: 13, padding: '8px 10px', marginBottom: 8 }}
        autoFocus
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="btn-primary"
          disabled={!text.trim()}
          onClick={() => { onSubmit(text.trim()); setSent(true) }}
          style={{ padding: '6px 16px', fontSize: 12.5, opacity: text.trim() ? 1 : 0.45 }}
        >
          Send to the council
        </button>
        <button type="button" className="btn-ghost" onClick={() => { setOpen(false); setText(''); setReason(null) }}>
          Cancel
        </button>
      </div>
    </div>
  )
}
