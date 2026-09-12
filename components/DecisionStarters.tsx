// components/DecisionStarters.tsx
// ── Strategy doc: "decision starters" ───────────────────────────────────────
// Solves "I don't know what decision to bring" — the blank-page problem that
// blocks activation before Quorum ever sees a real decision. Deliberately
// not called "templates" in the UI (per the brief: that reads as software).
// Clicking a starter fills the textarea as an editable draft, not a
// submission — the user still writes the real decision, this just removes
// the standing-in-front-of-a-blank-page moment.

'use client'

import { useState } from 'react'

interface Props {
  onPick: (text: string) => void
}

const CATEGORIES: { label: string; items: string[] }[] = [
  { label: 'Career',       items: ['Should I take this job offer?', 'Should I leave my current job?', 'Should I ask for a promotion?'] },
  { label: 'Business',     items: ['Should I hire this person?', 'Should I start this company?', 'Should I raise money right now?'] },
  { label: 'Money',        items: ['Should I make this investment?', 'Should I buy this house?'] },
  { label: 'Life',         items: ['Should I move?', 'Should I make this major change?'] },
  { label: 'Relationships',items: ['Should I have this difficult conversation?'] },
  { label: 'Everyday',     items: ['Should I buy this?', 'Should I commit to this?'] },
]

export default function DecisionStarters({ onPick }: Props) {
  const [open, setOpen] = useState<string | null>(null)

  return (
    <div style={{ margin: '10px 0 16px' }}>
      <p style={{
        fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: 'var(--text-4)', margin: '0 0 8px',
      }}>
        Or start with a decision
      </p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {CATEGORIES.map(cat => (
          <div key={cat.label} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setOpen(o => (o === cat.label ? null : cat.label))}
              style={{
                padding: '6px 13px', fontSize: 12.5, borderRadius: 999,
                border: `1px solid ${open === cat.label ? 'var(--gold)' : 'var(--border-dim)'}`,
                background: open === cat.label ? 'rgba(201,168,76,0.1)' : 'var(--bg-card)',
                color: open === cat.label ? 'var(--gold)' : 'var(--text-3)',
                cursor: 'pointer',
              }}
            >
              {cat.label}
            </button>
            {open === cat.label && (
              <div style={{
                position: 'absolute', top: '110%', left: 0, zIndex: 20,
                width: 'min(280px, calc(100vw - 48px))',
                border: '1px solid var(--border-mid)', borderRadius: 10,
                background: 'var(--bg-card)', boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                padding: 6,
              }}>
                {cat.items.map(item => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => { onPick(item); setOpen(null) }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '8px 10px', fontSize: 13, color: 'var(--text-2)',
                      background: 'transparent', border: 'none', borderRadius: 6,
                      cursor: 'pointer',
                    }}
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
