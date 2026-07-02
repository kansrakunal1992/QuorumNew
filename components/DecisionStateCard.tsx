'use client'
// components/DecisionStateCard.tsx
// ── Sprint Chunk 1 — Post-synthesis commitment capture ────────────────────────
//
// Renders after synthesis completes. Captures 3 clubbed fields:
//   leaning:          "Where are you leaning, and what's your first move?"
//                     (clubs current_leaning + next_action)
//   switch_condition: "What would change your course?"
//                     (clubs switch_conditions + main_unresolved_risk)
//   review_date:      When to revisit. Primary retention hook — drives
//                     Monthly Judgment Review open-loops list (Chunk 2).
//
// State machine: 'prompt' → 'form' → 'saved'
// Skippable at both prompt and form stages (stores nothing — correct).
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'

interface Props {
  sessionId: string
}

type Mode = 'prompt' | 'form' | 'saved'

interface Commitment {
  leaning:          string
  switch_condition: string
  review_date:      string
}

export default function DecisionStateCard({ sessionId }: Props) {
  const [mode,     setMode]     = useState<Mode>('prompt')
  const [leaning,  setLeaning]  = useState('')
  const [switchC,  setSwitchC]  = useState('')
  const [date,     setDate]     = useState('')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')
  const [saved,    setSaved]    = useState<Commitment | null>(null)

  const handleSave = async () => {
    // At least leaning or a review date required — rest optional
    if (!leaning.trim() && !date) {
      setError('Add where you\'re leaning or a review date — even one is useful.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/session/commitment', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          leaning:          leaning.trim()  || null,
          switch_condition: switchC.trim()  || null,
          review_date:      date            || null,
        }),
      })
      if (!res.ok) throw new Error()
      setSaved({ leaning: leaning.trim(), switch_condition: switchC.trim(), review_date: date })
      setMode('saved')
    } catch {
      setError('Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // ── Prompt ───────────────────────────────────────────────────────────────
  if (mode === 'prompt') {
    return (
      <div style={{
        borderRadius: 14,
        border:       '1px solid var(--border-mid)',
        background:   'var(--bg-card)',
        padding:      '20px 24px',
        display:      'flex',
        alignItems:   'center',
        justifyContent: 'space-between',
        gap:          20,
        flexWrap:     'wrap',
        marginTop:    12,
      }}>
        <div>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', margin: 0 }}>
            Before you close — where does this leave you?
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 4 }}>
            Capturing your position now prevents hindsight from rewriting it later.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexShrink: 0, alignItems: 'center' }}>
          <button
            className="btn-primary"
            style={{ fontSize: 13, padding: '9px 20px' }}
            onClick={() => setMode('form')}
          >
            Capture position
          </button>
          {/* S3-02: was a bordered btn-ghost button with near-equal visual weight to the
              primary CTA — sitting right beside it made skipping feel like an equally
              valid default. Plain text link, lower contrast, no bounding box — still one
              click away, but reads as the secondary path it actually is. */}
          <button
            style={{
              fontSize:   12,
              padding:    '9px 4px',
              background: 'none',
              border:     'none',
              color:      'var(--text-4)',
              cursor:     'pointer',
              fontFamily: 'inherit',
              textDecoration: 'underline',
              textUnderlineOffset: 2,
            }}
            onClick={() => setMode('saved')}   // skip — component disappears
          >
            Skip
          </button>
        </div>
      </div>
    )
  }

  // ── Form ─────────────────────────────────────────────────────────────────
  if (mode === 'form') {
    return (
      <div style={{
        borderRadius: 14,
        border:       '1px solid var(--gold-dim)',
        background:   'var(--bg-card)',
        padding:      '24px',
        marginTop:    12,
      }}>

        {/* Header */}
        <p style={{
          fontFamily:    'var(--font-mono)',
          fontSize:      10,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color:         'var(--text-4)',
          marginBottom:  14,
        }}>
          Decision position
        </p>

        {/* Field 1: Leaning + Next move (clubbed) */}
        <label style={{
          display:    'block',
          fontSize:   12,
          color:      'var(--text-3)',
          marginBottom: 6,
          fontWeight: 500,
        }}>
          Where are you leaning, and what's your first move?
        </label>
        <textarea
          rows={2}
          value={leaning}
          onChange={e => setLeaning(e.target.value)}
          placeholder="e.g. Leaning towards not proceeding — first step is asking for a 3-month extension to verify the numbers"
          style={{ fontSize: 13, marginBottom: 16 }}
        />

        {/* Field 2: Switch condition (clubbed with main risk) */}
        <label style={{
          display:    'block',
          fontSize:   12,
          color:      'var(--text-3)',
          marginBottom: 6,
          fontWeight: 500,
        }}>
          What would change your course?
          <span style={{ color: 'var(--text-4)', fontWeight: 400, marginLeft: 6 }}>optional</span>
        </label>
        <textarea
          rows={2}
          value={switchC}
          onChange={e => setSwitchC(e.target.value)}
          placeholder="e.g. If the independent audit comes back clean, or if a co-investor with domain knowledge joins"
          style={{ fontSize: 13, marginBottom: 16 }}
        />

        {/* Field 3: Review date */}
        <label style={{
          display:    'block',
          fontSize:   12,
          color:      'var(--text-3)',
          marginBottom: 6,
          fontWeight: 500,
        }}>
          Review by
          <span style={{ color: 'var(--text-4)', fontWeight: 400, marginLeft: 6 }}>optional</span>
        </label>

        {/* Quick date shortcuts */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
          {[
            { label: '+1 week',  days: 7  },
            { label: '+2 weeks', days: 14 },
            { label: '+1 month', days: 30 },
          ].map(({ label, days }) => {
            const d   = new Date()
            d.setDate(d.getDate() + days)
            const iso = d.toISOString().split('T')[0]
            return (
              <button
                key={days}
                onClick={() => setDate(iso)}
                style={{
                  padding:      '5px 12px',
                  borderRadius: 8,
                  fontSize:     11,
                  cursor:       'pointer',
                  fontFamily:   'inherit',
                  transition:   'all 0.15s',
                  border:       date === iso
                    ? '1px solid var(--gold)'
                    : '1px solid var(--border-dim)',
                  background:   date === iso ? 'var(--gold-glow)' : 'transparent',
                  color:        date === iso ? 'var(--gold)'      : 'var(--text-4)',
                }}
              >
                {label}
              </button>
            )
          })}
        </div>

        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          style={{
            width:        '100%',
            padding:      '9px 12px',
            borderRadius: 8,
            border:       '1px solid var(--border-dim)',
            background:   'var(--bg-inset)',
            color:        date ? 'var(--text-1)' : 'var(--text-4)',
            fontSize:     13,
            fontFamily:   'inherit',
            marginBottom: 18,
            boxSizing:    'border-box',
          }}
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
            {saving ? 'Saving…' : 'Save position'}
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

  // ── Saved ────────────────────────────────────────────────────────────────
  if (mode === 'saved' && saved) {
    return (
      <div style={{
        borderRadius: 14,
        border:       '1px solid var(--border-dim)',
        background:   'var(--bg-card)',
        padding:      '20px 24px',
        marginTop:    12,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>

            <p style={{
              fontFamily:    'var(--font-mono)',
              fontSize:      10,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color:         'var(--text-4)',
              marginBottom:  8,
            }}>
              Decision position captured
            </p>

            {saved.leaning && (
              <p style={{ fontSize: 13.5, color: 'var(--text-1)', lineHeight: 1.55, marginBottom: 8 }}>
                {saved.leaning}
              </p>
            )}

            {saved.switch_condition && (
              <p style={{ fontSize: 12.5, color: 'var(--text-3)', fontStyle: 'italic', lineHeight: 1.55, marginBottom: 8 }}>
                Would change course if: {saved.switch_condition}
              </p>
            )}

            {saved.review_date && (
              <span style={{
                display:      'inline-block',
                fontSize:     11,
                padding:      '4px 12px',
                borderRadius: 20,
                background:   'var(--gold-glow)',
                border:       '1px solid var(--gold-dim)',
                color:        'var(--gold)',
                fontFamily:   'var(--font-mono)',
              }}>
                Review by {new Date(saved.review_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
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

  // Skipped — render nothing
  return null
}
