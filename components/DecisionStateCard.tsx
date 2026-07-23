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
// State machine: 'form' → 'saved' | 'skipped'
// S3-02: removed the 'prompt' step — it added a click before the user could
// even see what was being asked, and the "Capture position" vs "Skip" choice
// read as a 50/50 decision rather than the low-friction default it should be.
// The form now renders immediately post-synthesis; "Skip" (de-emphasized,
// plain text, no bounding box) is the one-click way out. Skipping stores
// nothing — correct.
//
// UX fix: showing all three fields (leaning, switch condition, review date +
// three date-shortcut buttons) open by default was visually heavy right under
// a synthesis card — it read as "shabby"/cluttered rather than inviting. Kept
// the S3-02 decision (form open by default, no extra click to start typing).
// Originally both optional fields (switch condition, review date) were tucked
// behind a "+ Add more detail" toggle, collapsed by default.
//
// Vet-fix (c): review date is no longer behind that toggle. It isn't merely
// descriptive the way switch_condition is — it's the primary retention hook
// (drives the Monthly Judgment Review open-loops list and the reanalyze-nudge
// email; see commitment_review_date usage), and giving it the same
// "collapsed, optional" treatment as a purely descriptive field meant most
// users never set it. Leaning + first move is still the first, no-friction
// field; review date is now the second, always-visible field; switch
// condition remains behind "+ Add more detail" since it has no functional
// role beyond context.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'

interface Props {
  sessionId: string
}

type Mode = 'form' | 'saved' | 'skipped'

interface Commitment {
  leaning:          string
  switch_condition: string
  review_date:      string
}

export default function DecisionStateCard({ sessionId }: Props) {
  const [mode,     setMode]     = useState<Mode>('form')
  const [leaning,  setLeaning]  = useState('')
  const [switchC,  setSwitchC]  = useState('')
  const [date,     setDate]     = useState('')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')
  const [saved,    setSaved]    = useState<Commitment | null>(null)
  const [showMore, setShowMore] = useState(false)

  // Review-date nudge: review_date is the primary retention hook (see file
  // header), but it's still meant to be genuinely optional — this is a single
  // soft confirmation, not a hard gate. Fires at most once per card: whichever
  // of Save/Skip the user first triggers without a date shows the nudge;
  // choosing to proceed anyway (or setting a date and trying again) resolves
  // it for good, since both paths take the card out of 'form' mode.
  const [confirmMode, setConfirmMode] = useState<'save' | 'skip' | null>(null)
  const [nudged,      setNudged]      = useState(false)

  const proceedSave = async () => {
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

  const handleSaveClick = () => {
    // At least leaning or a review date required — rest optional
    if (!leaning.trim() && !date) {
      setError('Add where you\'re leaning or a review date — even one is useful.')
      return
    }
    if (!date && !nudged) {
      setNudged(true)
      setConfirmMode('save')
      return
    }
    proceedSave()
  }

  const handleSkipClick = () => {
    if (!date && !nudged) {
      setNudged(true)
      setConfirmMode('skip')
      return
    }
    setMode('skipped')
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
          marginBottom:  6,
        }}>
          Decision position
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-4)', marginBottom: 16, lineHeight: 1.5 }}>
          Capturing this now prevents hindsight from rewriting it later. Takes a minute — skip if you'd rather not.
        </p>

        {/* Field 1: Leaning + Next move (clubbed) — always visible, the one
            field that matters most */}
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

        {/* Field 2 (vet-fix c): Review date — promoted out of the collapsed
            "+ Add more detail" section to always-visible. Unlike switch_condition,
            this field isn't just descriptive: it's the primary retention hook
            (drives the Monthly Judgment Review open-loops list and the
            reanalyze-nudge email), so it was getting the same "optional, tucked
            away" treatment as a field with no functional role, and most users
            never opened the toggle to set it. Leaning stays the single
            no-friction field up top; review date now sits right below it,
            still clearly optional; switch condition — genuinely just
            descriptive detail — is the one still behind the toggle. */}
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
            marginBottom: showMore ? 16 : 6,
            boxSizing:    'border-box',
          }}
        />

        {!showMore ? (
          <button
            onClick={() => setShowMore(true)}
            style={{
              fontSize:   12,
              padding:    '4px 0',
              background: 'none',
              border:     'none',
              color:      'var(--text-4)',
              cursor:     'pointer',
              fontFamily: 'inherit',
              marginBottom: 16,
              display:    'block',
            }}
          >
            + Add more detail <span style={{ color: 'var(--text-4)' }}>(what would change your course)</span>
          </button>
        ) : (
          <>
            {/* Field 3: Switch condition (clubbed with main risk) */}
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
          </>
        )}

        {error && (
          <p style={{ fontSize: 12, color: '#e05050', marginBottom: 12 }}>{error}</p>
        )}

        {/* One-time nudge: only reachable via handleSaveClick/handleSkipClick
            when no date is set yet, and only ever shown once (see `nudged`). */}
        {confirmMode ? (
          <div style={{
            borderRadius: 10,
            border:       '1px solid var(--gold-dim)',
            background:   'var(--gold-glow)',
            padding:      '12px 14px',
          }}>
            <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5, marginBottom: 10 }}>
              No review date yet — that&apos;s what brings this decision back to you later.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                className="btn-primary"
                style={{ fontSize: 12.5, padding: '8px 16px', minHeight: 40 }}
                onClick={() => setConfirmMode(null)}
              >
                Add a date
              </button>
              <button
                style={{
                  fontSize:     12.5,
                  padding:      '8px 14px',
                  minHeight:    40,
                  background:   'none',
                  border:       '1px solid var(--border-dim)',
                  borderRadius: 8,
                  color:        'var(--text-3)',
                  cursor:       'pointer',
                  fontFamily:   'inherit',
                }}
                disabled={saving}
                onClick={() => confirmMode === 'save' ? proceedSave() : setMode('skipped')}
              >
                {confirmMode === 'save'
                  ? (saving ? 'Saving…' : 'Save without a date')
                  : 'Skip anyway'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="btn-primary"
              style={{ fontSize: 13, padding: '9px 22px' }}
              onClick={handleSaveClick}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save position'}
            </button>
            {/* S3-02: de-emphasized — plain text, no border, lower contrast than the */}
            {/* primary "Save position" button beside it. This is the one-click skip. */}
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
              onClick={handleSkipClick}
            >
              Skip
            </button>
          </div>
        )}
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
