'use client'

import { useState } from 'react'

interface Outcome {
  what_decided: string
  council_helped: 'yes' | 'partially' | 'no'
  notes: string
}

interface Props {
  sessionId: string
  existingOutcome: Outcome | null
}

export default function OutcomeTracker({ sessionId, existingOutcome }: Props) {
  const [mode,      setMode]      = useState<'prompt' | 'form' | 'saved'>(
    existingOutcome ? 'saved' : 'prompt'
  )
  const [decided,   setDecided]   = useState(existingOutcome?.what_decided  ?? '')
  const [helped,    setHelped]    = useState<'yes'|'partially'|'no'|''>(existingOutcome?.council_helped ?? '')
  const [notes,     setNotes]     = useState(existingOutcome?.notes ?? '')
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')

  const handleSave = async () => {
    if (!decided.trim() || !helped) {
      setError('Please fill in what you decided and whether the Council helped.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/outcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          what_decided: decided.trim(),
          council_helped: helped,
          notes: notes.trim() || null,
        }),
      })
      if (!res.ok) throw new Error()
      setMode('saved')
    } catch {
      setError('Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const helpedOptions: { value: 'yes'|'partially'|'no'; label: string; color: string }[] = [
    { value: 'yes',       label: 'Yes, it changed my thinking',      color: '#1a4a2e' },
    { value: 'partially', label: 'Partially — surfaced new angles',  color: '#3a3a10' },
    { value: 'no',        label: 'Not meaningfully',                  color: '#4a1a1a' },
  ]

  if (mode === 'prompt') {
    return (
      <div style={{
        borderRadius: 14,
        border: '1px solid var(--border-mid)',
        background: 'var(--bg-card)',
        padding: '20px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 20,
        flexWrap: 'wrap',
      }}>
        <div>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', margin: 0 }}>
            What did you decide?
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 4 }}>
            Recording your outcome helps close the loop — and makes future sessions sharper.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
          <button
            className="btn-primary"
            style={{ fontSize: 13, padding: '9px 20px' }}
            onClick={() => setMode('form')}
          >
            Record outcome
          </button>
          <button
            className="btn-ghost"
            style={{ fontSize: 12, padding: '9px 14px' }}
            onClick={() => setMode('saved')}  // dismiss without saving
          >
            Later
          </button>
        </div>
      </div>
    )
  }

  if (mode === 'form') {
    return (
      <div style={{
        borderRadius: 14,
        border: '1px solid var(--gold-dim)',
        background: 'var(--bg-card)',
        padding: '24px',
      }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', marginBottom: 18 }}>
          Record what happened
        </p>

        {/* What you decided */}
        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 6, fontWeight: 500 }}>
          What did you decide?
        </label>
        <textarea
          rows={2}
          value={decided}
          onChange={e => setDecided(e.target.value)}
          placeholder="e.g. Decided not to invest — staying with mutual funds for now"
          style={{ fontSize: 13, marginBottom: 16 }}
        />

        {/* Did the Council help */}
        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 8, fontWeight: 500 }}>
          Did the Council change your thinking?
        </label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {helpedOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => setHelped(opt.value)}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 0.15s',
                border: helped === opt.value
                  ? '1px solid var(--gold)'
                  : '1px solid var(--border-dim)',
                background: helped === opt.value
                  ? opt.color
                  : 'transparent',
                color: helped === opt.value
                  ? 'var(--text-1)'
                  : 'var(--text-3)',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Optional notes */}
        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 6, fontWeight: 500 }}>
          What was most useful (or missing)?
          <span style={{ color: 'var(--text-4)', fontWeight: 400, marginLeft: 6 }}>optional</span>
        </label>
        <textarea
          rows={2}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="e.g. The Risk Architect's irreversibility point was the one that shifted things…"
          style={{ fontSize: 13, marginBottom: 18 }}
        />

        {error && <p style={{ fontSize: 12, color: '#e05050', marginBottom: 12 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            className="btn-primary"
            style={{ fontSize: 13, padding: '9px 22px' }}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save outcome'}
          </button>
          <button
            className="btn-ghost"
            style={{ fontSize: 12 }}
            onClick={() => setMode('prompt')}
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // saved state
  if (mode === 'saved' && existingOutcome) {
    const helpedLabel = {
      yes:       'Changed my thinking',
      partially: 'Surfaced new angles',
      no:        'Not meaningfully helpful',
    }[existingOutcome.council_helped]

    const helpedColor = {
      yes:       '#1a4a2e',
      partially: '#3a3a10',
      no:        '#4a1a1a',
    }[existingOutcome.council_helped]

    return (
      <div style={{
        borderRadius: 14,
        border: '1px solid var(--border-dim)',
        background: 'var(--bg-card)',
        padding: '20px 24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 6, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Decision outcome
            </p>
            <p style={{ fontSize: 14, color: 'var(--text-1)', lineHeight: 1.55, marginBottom: 10 }}>
              {existingOutcome.what_decided}
            </p>
            <span style={{
              fontSize: 11,
              padding: '4px 12px',
              borderRadius: 20,
              background: helpedColor,
              color: 'var(--text-2)',
              display: 'inline-block',
            }}>
              {helpedLabel}
            </span>
            {existingOutcome.notes && (
              <p style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 10, lineHeight: 1.6, fontStyle: 'italic' }}>
                {existingOutcome.notes}
              </p>
            )}
          </div>
          <button
            className="btn-ghost"
            style={{ fontSize: 11, padding: '5px 12px', flexShrink: 0 }}
            onClick={() => { setMode('form') }}
          >
            Edit
          </button>
        </div>
      </div>
    )
  }

  // Dismissed (later clicked) with no existing outcome
  return null
}
