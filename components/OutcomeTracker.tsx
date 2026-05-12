'use client'

import { useState } from 'react'

type OutcomeQuality = 'better_than_expected' | 'as_expected' | 'worse_than_expected' | 'too_early'

interface Outcome {
  what_decided:             string
  council_helped:           'yes' | 'partially' | 'no'
  notes:                    string | null
  outcome_quality:          OutcomeQuality | null
  retrospective_confidence: number | null
}

interface Props {
  sessionId:       string
  existingOutcome: Outcome | null
}

export default function OutcomeTracker({ sessionId, existingOutcome }: Props) {
  // localSaved: captures outcome data after a fresh in-session save,
  // since existingOutcome is a server prop and won't update client-side.
  const [localSaved, setLocalSaved] = useState<Outcome | null>(null)
  const [mode,       setMode]       = useState<'prompt' | 'form' | 'saved'>(
    existingOutcome ? 'saved' : 'prompt'
  )
  const [decided,         setDecided]         = useState(existingOutcome?.what_decided  ?? '')
  const [helped,          setHelped]          = useState<'yes' | 'partially' | 'no' | ''>(
    existingOutcome?.council_helped ?? ''
  )
  const [notes,           setNotes]           = useState(existingOutcome?.notes ?? '')
  // ── Sprint 14: outcome quality + retrospective confidence ─────────────────
  const [outcomeQuality,  setOutcomeQuality]  = useState<OutcomeQuality | ''>(
    existingOutcome?.outcome_quality ?? ''
  )
  const [retroConfidence, setRetroConfidence] = useState<number>(
    existingOutcome?.retrospective_confidence ?? 5
  )
  const [saving,          setSaving]          = useState(false)
  const [error,           setError]           = useState('')

  // The outcome to display — prefer server prop (already in DB),
  // fall back to what we just saved this session.
  const displayOutcome = existingOutcome ?? localSaved

  const handleSave = async () => {
    if (!decided.trim() || !helped) {
      setError('Please fill in what you decided and whether the Council helped.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/outcome', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          what_decided:             decided.trim(),
          council_helped:           helped,
          notes:                    notes.trim() || null,
          // Sprint 14 fields
          outcome_quality:          outcomeQuality || null,
          retrospective_confidence: retroConfidence,
        }),
      })
      if (!res.ok) throw new Error()

      // Capture locally so the saved-state card renders even though
      // existingOutcome (server prop) is still null.
      setLocalSaved({
        what_decided:             decided.trim(),
        council_helped:           helped as 'yes' | 'partially' | 'no',
        notes:                    notes.trim() || null,
        outcome_quality:          (outcomeQuality as OutcomeQuality) || null,
        retrospective_confidence: retroConfidence,
      })
      setMode('saved')
    } catch {
      setError('Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const helpedOptions: {
    value: 'yes' | 'partially' | 'no'
    label: string
    bg: string
  }[] = [
    { value: 'yes',       label: 'Yes, it changed my thinking',     bg: '#1a4a2e' },
    { value: 'partially', label: 'Partially — surfaced new angles',  bg: '#3a3a10' },
    { value: 'no',        label: 'Not meaningfully',                 bg: '#4a1a1a' },
  ]

  // Sprint 14: outcome quality options
  const qualityOptions: { value: OutcomeQuality; label: string; color: string }[] = [
    { value: 'better_than_expected', label: '↑ Better than expected',  color: 'var(--green-text)' },
    { value: 'as_expected',          label: '→ As expected',           color: 'var(--text-2)' },
    { value: 'worse_than_expected',  label: '↓ Worse than expected',   color: '#c04040' },
    { value: 'too_early',            label: '⏳ Too early to tell',    color: 'var(--text-3)' },
  ]

  // ── Prompt state ─────────────────────────────────────────────────
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
            Recording your outcome closes the loop — and makes future sessions sharper.
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
            onClick={() => setMode('saved')}   // dismiss — component goes null
          >
            Later
          </button>
        </div>
      </div>
    )
  }

  // ── Form state ───────────────────────────────────────────────────
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
                background: helped === opt.value ? opt.bg : 'transparent',
                color: helped === opt.value ? 'var(--text-1)' : 'var(--text-3)',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* ── Sprint 14: How did the outcome compare? ──────────────── */}
        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 8, fontWeight: 500 }}>
          How did the outcome compare to what you expected?
          <span style={{ color: 'var(--text-4)', fontWeight: 400, marginLeft: 6 }}>optional</span>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 16 }}>
          {qualityOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => setOutcomeQuality(outcomeQuality === opt.value ? '' : opt.value)}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: 'inherit',
                textAlign: 'left',
                transition: 'all 0.15s',
                border: outcomeQuality === opt.value
                  ? `1px solid ${opt.color}`
                  : '1px solid var(--border-dim)',
                background: outcomeQuality === opt.value ? 'rgba(255,255,255,0.04)' : 'transparent',
                color: outcomeQuality === opt.value ? opt.color : 'var(--text-3)',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* ── Sprint 14: Retrospective confidence ───────────────────── */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <label style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 500 }}>
              In hindsight, how confident do you feel about this decision?
              <span style={{ color: 'var(--text-4)', fontWeight: 400, marginLeft: 6 }}>optional</span>
            </label>
            <span style={{
              fontSize: 13,
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              color: retroConfidence <= 3 ? '#c04040'
                   : retroConfidence <= 6 ? 'var(--gold)'
                   : 'var(--green-text)',
              minWidth: 28,
              textAlign: 'right',
            }}>
              {retroConfidence}<span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-4)' }}>/10</span>
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={retroConfidence}
            onChange={e => setRetroConfidence(Number(e.target.value))}
            style={{
              width: '100%',
              accentColor: retroConfidence <= 3 ? '#c04040'
                         : retroConfidence <= 6 ? 'var(--gold)'
                         : 'var(--green-text)',
              cursor: 'pointer',
              height: 4,
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--text-4)' }}>Still uncertain</span>
            <span style={{ fontSize: 10, color: 'var(--text-4)' }}>Fully at peace</span>
          </div>
        </div>

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

        {error && (
          <p style={{ fontSize: 12, color: '#e05050', marginBottom: 12 }}>{error}</p>
        )}

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

  // ── Saved state ──────────────────────────────────────────────────
  // Renders when: (a) existingOutcome came from server, OR
  //               (b) user just saved this session (localSaved set)
  if (mode === 'saved' && displayOutcome) {
    const helpedLabel = {
      yes:       'Changed my thinking',
      partially: 'Surfaced new angles',
      no:        'Not meaningfully helpful',
    }[displayOutcome.council_helped]

    const helpedBg = {
      yes:       '#1a4a2e',
      partially: '#3a3a10',
      no:        '#4a1a1a',
    }[displayOutcome.council_helped]

    const qualityLabel = displayOutcome.outcome_quality
      ? qualityOptions.find(q => q.value === displayOutcome.outcome_quality)
      : null

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
              {displayOutcome.what_decided}
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{
                fontSize: 11,
                padding: '4px 12px',
                borderRadius: 20,
                background: helpedBg,
                color: '#fff',
                display: 'inline-block',
              }}>
                {helpedLabel}
              </span>
              {qualityLabel && (
                <span style={{
                  fontSize: 11,
                  padding: '4px 12px',
                  borderRadius: 20,
                  border: '1px solid var(--border-dim)',
                  color: qualityLabel.color,
                  display: 'inline-block',
                }}>
                  {qualityLabel.label}
                </span>
              )}
              {displayOutcome.retrospective_confidence && (
                <span style={{
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  color: displayOutcome.retrospective_confidence <= 3 ? '#c04040'
                       : displayOutcome.retrospective_confidence <= 6 ? 'var(--gold)'
                       : 'var(--green-text)',
                }}>
                  Hindsight confidence: {displayOutcome.retrospective_confidence}/10
                </span>
              )}
            </div>
            {displayOutcome.notes && (
              <p style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 10, lineHeight: 1.6, fontStyle: 'italic' }}>
                {displayOutcome.notes}
              </p>
            )}
          </div>
          <button
            className="btn-ghost"
            style={{ fontSize: 11, padding: '5px 12px', flexShrink: 0 }}
            onClick={() => setMode('form')}
          >
            Edit
          </button>
        </div>
      </div>
    )
  }

  // Dismissed (Later clicked) with no outcome — hide until next visit
  return null
}
