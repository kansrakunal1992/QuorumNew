'use client'

// components/HabitSetupCard.tsx
// -- Phase 2 (retention work): "where will you bring the next one?" -----------
// Shown once, under the second decision. Two single-choice questions:
//   1. the cue  -- an if-then plan ("when X comes up, I bring it here"). Plans
//      that name a concrete situation are the part of the habit literature
//      that holds up best for getting a behaviour to actually happen; we treat
//      it as a hypothesis to test here, not a guarantee.
//   2. the cadence -- how Quorum may bring decisions back. Only 'weekly'
//      triggers email; the other two are real choices meaning "no weekly
//      email", so the question is honest rather than a disguised opt-in.
//
// Anonymous people: stored in localStorage (lib/habit-prefs.ts) and flushed by
// /auth/callback after they link. Linked people: saved straight away.
// Outline-style only -- this screen already has other actions.

import { useEffect, useState } from 'react'
import { CUES, CADENCES, readHabitPrefs, writeHabitPrefs, type HabitPrefs } from '@/lib/habit-prefs'
import { getAuthHeaders } from '@/lib/auth-headers'
import { track } from '@/lib/track'

interface Props {
  surface: string
  linked: boolean | null
  onSaved?: (prefs: HabitPrefs) => void
}

export default function HabitSetupCard({ surface, linked, onSaved }: Props) {
  const [cue, setCue]         = useState<string | null>(null)
  const [cadence, setCadence] = useState<string | null>(null)
  const [state, setState]     = useState<'idle' | 'saving' | 'saved' | 'hidden' | 'error'>('idle')

  // Already answered on this device -> do not ask again.
  useEffect(() => {
    const p = readHabitPrefs()
    if (p?.cadence) setState('hidden')
  }, [])

  if (state === 'hidden') return null

  const chip = (selected: boolean) => ({
    padding: '8px 13px', fontSize: 12.5, borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
    border: `1px solid ${selected ? 'var(--gold)' : 'var(--border-dim)'}`,
    background: selected ? 'rgba(201,168,76,0.1)' : 'var(--bg-inset)',
    color: selected ? 'var(--gold)' : 'var(--text-3)',
    minHeight: 38,
  }) as const

  async function save() {
    if (!cue && !cadence) return
    setState('saving')
    const prefs: HabitPrefs = { cue, cadence }
    writeHabitPrefs(prefs)
    track('habit_saved', { cue, cadence, linked: !!linked, surface })
    // Phase 4: choosing Weekly is the explicit opt-in to the weekly brief.
    if (cadence === 'weekly') track('notification_opted_in', { channel: 'email_weekly', linked: !!linked, surface })
    if (linked) {
      try {
        const res = await fetch('/api/preferences/habit', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
          body:    JSON.stringify({ cue, cadence }),
        })
        if (!res.ok) throw new Error(String(res.status))
      } catch {
        // Kept locally; the callback flush / next visit will retry. Do not scare the user.
      }
    }
    setState('saved')
    onSaved?.(prefs)
  }

  if (state === 'saved') {
    return (
      <p style={{ fontSize: 12.5, color: 'var(--text-3)', margin: 0, textAlign: 'center' }}>
        Saved.{cadence === 'weekly' && !linked ? ' Weekly needs somewhere to send it, so connect an email below.' : ''}
      </p>
    )
  }

  return (
    <div style={{
      width: '100%', textAlign: 'left', padding: '14px 16px',
      background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: 12,
    }}>
      <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: '0 0 8px', lineHeight: 1.45 }}>
        Next time you catch yourself going back and forth, where will you bring it?
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {CUES.map(c => (
          <button key={c.id} type="button" style={chip(cue === c.id)} onClick={() => setCue(cue === c.id ? null : c.id)}>
            {c.label}
          </button>
        ))}
      </div>

      <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: '0 0 8px', lineHeight: 1.45 }}>
        How should Quorum bring decisions back to you?
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {CADENCES.map(c => (
          <button key={c.id} type="button" style={chip(cadence === c.id)} onClick={() => setCadence(cadence === c.id ? null : c.id)}>
            {c.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <button
          className="btn-ghost"
          style={{ fontSize: 13, padding: '9px 16px', minHeight: 40 }}
          onClick={save}
          disabled={state === 'saving' || (!cue && !cadence)}
        >
          {state === 'saving' ? 'Saving\u2026' : 'Save'}
        </button>
        <button
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, color: 'var(--text-4)', textDecoration: 'underline', textUnderlineOffset: 2 }}
          onClick={() => { writeHabitPrefs({ cue: null, cadence: 'big_only' }); setState('hidden') }}
        >
          Not now
        </button>
      </div>
    </div>
  )
}
