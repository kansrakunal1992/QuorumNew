'use client'

// components/IntakeExamples.tsx
// -- Landing screen: example openers, visible without any tap ---------------------------------------------
// Sits directly under the input and the "Help me decide" button. A tap fills the box (the parent decides how);
// the visitor still presses the button themselves. Replaces the old route to examples ("See examples" ->
// category chip -> dropdown -> question, three taps before any text reached the box), which is still there as
// "More examples" for anyone who wants it.
//
// Styling follows the rest of the landing screen: the same pill/border tokens as the chat's quick-reply chips
// (ChatIntake's chip style) and the same 12.5px quiet caption as the "Walk me through it" row. Sentence case, no
// new colours, no motion.

import { INTAKE_EXAMPLES, INTAKE_EXAMPLES_SHORT_SCREEN_COUNT } from '@/lib/intake-examples'

interface Props {
  onPick: (id: string, text: string) => void
  /** id of the example whose text is currently in the box, if any (shown as selected until the text changes). */
  activeId?: string | null
}

export default function IntakeExamples({ onPick, activeId = null }: Props) {
  return (
    <div className="qi-examples" style={{ width: '100%', textAlign: 'left' }}>
      {/* On short screens only the first few examples show, so the first screen stays input + button + examples. */}
      <style>{`@media (max-height: 700px) { .qi-examples .qi-example-extra { display: none; } }`}</style>
      <p style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.5, margin: '0 0 8px', textAlign: 'center' }}>
        Not sure how to start? Tap one and edit it.
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {INTAKE_EXAMPLES.map((ex, i) => {
          const selected = activeId === ex.id
          return (
            <li key={ex.id} className={i >= INTAKE_EXAMPLES_SHORT_SCREEN_COUNT ? 'qi-example-extra' : undefined}>
              <button
                type="button"
                onClick={() => onPick(ex.id, ex.text)}
                aria-pressed={selected}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '10px 14px', borderRadius: 14, fontSize: 14, lineHeight: 1.35,
                  border: selected ? '1px solid var(--gold)' : '1px solid var(--border-mid)',
                  background: selected ? 'var(--gold-dim)' : 'transparent',
                  color: selected ? 'var(--text-1)' : 'var(--text-2)',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {ex.label}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
