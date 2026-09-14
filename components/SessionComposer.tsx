// components/SessionComposer.tsx
// ── Unified session, "worth stealing" pass ──────────────────────────────────
// One consistent-looking text box used wherever the user types something in
// a session — currently wired into SynthesisChallenge and PredictionReveal.
// Not a single persisted DOM instance (Examiner's own answer input is a
// separate, complex pre-existing state machine — safer to leave its
// internals alone than risk destabilizing it for a visual-only goal). This
// gets the felt effect that matters — same box, same placement logic, same
// button language — everywhere it's safe to actually share the component.

'use client'

import { useState } from 'react'

interface Props {
  placeholder:       string
  submitLabel:       string
  submittingLabel?:  string
  onSubmit:          (text: string) => void | Promise<void>
  initialValue?:      string
  minRows?:          number
  disabled?:         boolean
  secondaryAction?:  { label: string; onClick: () => void }
}

export default function SessionComposer({
  placeholder, submitLabel, submittingLabel, onSubmit,
  initialValue = '', minRows = 2, disabled, secondaryAction,
}: Props) {
  const [text, setText]             = useState(initialValue)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    if (!text.trim() || submitting || disabled) return
    setSubmitting(true)
    try {
      await onSubmit(text.trim())
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <textarea
        rows={minRows}
        placeholder={placeholder}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit() }}
        disabled={disabled}
        style={{
          width: '100%', fontSize: 16, padding: '12px 14px',
          marginBottom: 10, borderRadius: 12,
          border: '1px solid var(--border-mid)', background: 'var(--bg-inset)',
          color: 'var(--text-1)', resize: 'none', fontFamily: 'inherit',
        }}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          className="btn-primary"
          disabled={!text.trim() || submitting || disabled}
          onClick={handleSubmit}
          style={{ padding: '10px 22px', fontSize: 13, minHeight: 44, opacity: text.trim() ? 1 : 0.45 }}
        >
          {submitting ? (submittingLabel ?? 'Sending…') : submitLabel}
        </button>
        {secondaryAction && (
          <button type="button" className="btn-ghost" onClick={secondaryAction.onClick} style={{ minHeight: 44 }}>
            {secondaryAction.label}
          </button>
        )}
      </div>
    </div>
  )
}
