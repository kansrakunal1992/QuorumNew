// components/SynthesisChallenge.tsx
// ── Unified Session, point 1 + "worth stealing" pass ────────────────────────
// "Challenge Quorum" needs to live where the user is actually looking in
// this experience — next to Synthesis — not require expanding the Council
// and finding a specific persona's own pushback box first. Same structured-
// reason-chip pattern as PersonaPanel's per-persona challenge (kept
// consistent), but submits via onSubmit, which SessionView wires straight
// to the existing handleShareContext('synthesis', text) — the same
// broadcast-to-all-six-advisors-then-resynthesize pipeline PersonaPanel's
// own challenge already uses. No new backend behavior, just a better front
// door onto the one that exists.
//
// Text input now goes through SessionComposer, the same box used in
// PredictionReveal — same look, same placement logic, same button
// language, so this doesn't feel like a different kind of input each time
// it shows up in a session.

'use client'

import { useState } from 'react'
import SessionComposer from '@/components/SessionComposer'

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
  const [open, setOpen]     = useState(false)
  const [reason, setReason] = useState<string | null>(null)
  const [prefill, setPrefill] = useState('')
  const [sent, setSent]     = useState(false)

  if (sent) {
    return (
      <p style={{ fontSize: 12.5, color: 'var(--text-3)', margin: '10px 0 0' }}>
        Sent to the full council for reassessment — the read above will update.
      </p>
    )
  }

  if (!open) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', margin: '14px 0' }}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={disabled}
          style={{
            display:      'flex',
            alignItems:   'center',
            gap:          6,
            padding:      '10px 22px',
            fontSize:     13,
            fontWeight:   600,
            borderRadius: 999,
            border:       '1px solid var(--gold-dim, var(--border-mid))',
            background:   'var(--bg-card)',
            color:        'var(--gold)',
            cursor:       disabled ? 'default' : 'pointer',
            opacity:      disabled ? 0.5 : 1,
          }}
        >
          Disagree / ask a follow-up
        </button>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 12, padding: '12px 14px', border: '1px solid var(--border-dim)', borderRadius: 12, background: 'var(--bg-card-alt)' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {REASONS.map(r => (
          <button
            key={r.value}
            type="button"
            onClick={() => { setReason(r.value); setPrefill(r.prefill) }}
            style={{
              padding:      '7px 12px',
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
      {/* key remounts the composer with the new prefill when a reason chip
          is picked — SessionComposer owns its own text state internally
          (same as every other place it's used), so this is the simplest
          way to seed it without giving the composer a controlled-value API
          it doesn't need anywhere else it's used. */}
      <SessionComposer
        key={reason ?? 'blank'}
        placeholder="Say what you actually think Quorum got wrong…"
        initialValue={prefill}
        submitLabel="Send to the council"
        submittingLabel="Sending…"
        onSubmit={(text) => { onSubmit(text); setSent(true) }}
        secondaryAction={{ label: 'Cancel', onClick: () => { setOpen(false); setReason(null); setPrefill('') } }}
      />
    </div>
  )
}
