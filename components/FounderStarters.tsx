'use client'

// components/FounderStarters.tsx
// ── v18: six founder decisions, one tap each ─────────────────────────────────────────────────────────────────────────
//
// The commercial message is consequential business decisions; the product is not narrowed. This sits UNDER the box (the box
// stays the first thing on the screen) and ABOVE the existing category pills, which remain as "Something else". A tap sends the
// sentence as the person's first message, exactly like the pills do, and carries the decision's playbook so the intake asks the
// right questions even when the sentence would not have matched by keyword (see lib/founder-starters.ts).
//
// Rows, not chips: these are full questions, and a founder reading six of them should be able to scan them. Plain buttons (never
// links), disabled while a request is in flight, 48px minimum touch height, the app's own tokens.

import { FOUNDER_STARTERS, FEEDER_STARTER } from '@/lib/founder-starters'
import type { FounderStarter } from '@/lib/founder-starters'

interface Props {
  onPick:    (s: FounderStarter) => void
  disabled?: boolean
}

const row: React.CSSProperties = {
  width: '100%', textAlign: 'left', minHeight: 48, padding: '10px 14px', borderRadius: 12, fontFamily: 'inherit',
  fontSize: 14.5, lineHeight: 1.4, color: 'var(--text-1)', background: 'var(--bg-card)', border: '1px solid var(--border-dim)',
}

export default function FounderStarters({ onPick, disabled = false }: Props) {
  return (
    <section aria-label="Decisions founders bring" style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
      <p style={{ fontSize: 12.5, color: 'var(--text-3)', margin: '0 0 2px' }}>Or start with a decision founders bring:</p>
      {FOUNDER_STARTERS.map(s => (
        <button key={s.id} type="button" disabled={disabled} onClick={() => onPick(s)}
          style={{ ...row, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
          {s.label}
        </button>
      ))}
      <button type="button" disabled={disabled} onClick={() => onPick(FEEDER_STARTER)}
        style={{ ...row, background: 'transparent', color: 'var(--text-2)', fontSize: 13.5, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
        {FEEDER_STARTER.label}
      </button>
    </section>
  )
}
