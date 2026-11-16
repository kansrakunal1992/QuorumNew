'use client'

// components/IntakeQuickStarts.tsx
// -- Landing screen: start with one tap --------------------------------------------------------------------
// Sits directly under the "Help me decide" button and above the example sentences. For the visitor who does not yet
// know how to say it: pick the kind of decision and Quorum asks the rest, one small question at a time (the guided
// mode that "Walk me through it" already starts). The categories are the same six the older example chips used.
//
// A tap sends the first message, so the pills are ordinary buttons (never links, never auto-fired) and are disabled
// while a request is in flight. Styling reuses the chat's own chip look; sentence case; no new colours.

import { INTAKE_QUICK_STARTS } from '@/lib/intake-examples'

interface Props {
  onPick: (id: string, text: string) => void
  disabled?: boolean
}

export default function IntakeQuickStarts({ onPick, disabled = false }: Props) {
  return (
    <div className="qi-quickstarts" style={{ width: '100%' }}>
      <p style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.5, margin: '0 0 8px', textAlign: 'center' }}>
        Can{'\u2019'}t put it into words? Pick the kind of decision and Quorum asks the rest.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 6 }}>
        {INTAKE_QUICK_STARTS.map(q => (
          <button
            key={q.id}
            type="button"
            disabled={disabled}
            onClick={() => onPick(q.id, q.text)}
            style={{
              padding: '8px 14px', borderRadius: 999, fontSize: 14, lineHeight: 1.3,
              border: '1px solid var(--border-mid)', background: 'transparent', color: 'var(--text-2)',
              cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1, fontFamily: 'inherit',
            }}
          >
            {q.label}
          </button>
        ))}
      </div>
    </div>
  )
}
