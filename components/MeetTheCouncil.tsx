// components/MeetTheCouncil.tsx
// Item #4: a quiet, expandable "how each advisor thinks" reference section
// for the app home page.
//
// Deliberately NOT reachable from inside a live council/synthesis session —
// per the working decision on this item, nothing new gets a foothold inside
// that ritual. This is calm reference content, read before or after a
// session, not during one. Placed near the bottom of the home page, after
// the user's own decision history, matching the same "supplementary, not
// intrusive" positioning as the FAQ (#10).
//
// Copy below is intentionally distinct from each persona's existing
// `tagline` in lib/personas.ts (which already appears as a compact header
// inside the live PersonaPanel) — this is a fuller "how this advisor
// thinks" sentence, not a repeat of the one-liner.

'use client'

import { useState } from 'react'
import { PERSONAS } from '@/lib/personas'
import PersonaIcon from './PersonaIcon'
import type { PersonaKey } from '@/lib/types'

const COUNCIL_ORDER: Array<Exclude<PersonaKey, 'synthesis' | 'decision_brief'>> = [
  'contrarian',
  'risk_architect',
  'pattern_analyst',
  'stakeholder_mirror',
  'elder',
  'competitor',
]

const HOW_THEY_THINK: Record<(typeof COUNCIL_ORDER)[number], string> = {
  contrarian:
    "Built to find the strongest case against what you're about to do — not reflexive pushback, but the argument you'd want to hear before signing, not after.",
  risk_architect:
    'Runs a pre-mortem before you commit: where this fails, in what order, and which failure you are least prepared for.',
  pattern_analyst:
    'Reads this decision against the structure of your own past decisions — not what you wrote, but what kind of decision this actually is.',
  stakeholder_mirror:
    "Surfaces who else carries the consequences of this decision, and what they'd say if they were in the room.",
  elder:
    'Slows the frame down. Asks what this looks like in five years, not five weeks.',
  competitor:
    'Argues the position of someone who benefits if you choose wrong — the case you would face if this were contested, not agreed with.',
}

export default function MeetTheCouncil() {
  const [open, setOpen] = useState(false)

  return (
    <div
      style={{
        marginTop: 28,
        background: 'var(--bg-card)',
        border: '1px solid var(--border-mid)',
        borderRadius: 12,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: 2, background: 'linear-gradient(90deg, var(--gold-dim) 0%, transparent 60%)' }} />

      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 22px', background: 'transparent', border: 'none', cursor: 'pointer',
          fontFamily: 'inherit', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 13.5, letterSpacing: '0.03em', color: 'var(--text-2)' }}>
          Meet the Council
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ color: 'var(--text-4)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div style={{ padding: '0 22px 20px', display: 'flex', flexDirection: 'column', gap: 0 }}>
          {COUNCIL_ORDER.map((key, i) => {
            const meta = PERSONAS[key]
            return (
              <div
                key={key}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 0',
                  borderTop: i > 0 ? '1px solid var(--border-dim)' : 'none',
                }}
              >
                <div
                  style={{
                    flexShrink: 0, width: 32, height: 32, borderRadius: 8,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--bg-card-alt)', border: '1px solid var(--border-dim)',
                    color: 'var(--gold-dim)', marginTop: 2,
                  }}
                >
                  <PersonaIcon persona={key} size={17} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-1)', fontWeight: 500 }}>
                    {meta.label}
                  </p>
                  <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.55 }}>
                    {HOW_THEY_THINK[key]}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
