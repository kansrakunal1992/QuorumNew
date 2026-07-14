'use client'
// components/Tooltip.tsx
//
// Lightweight hover/focus tooltip — CSS-driven, theme-aware (uses the same
// --bg-card / --border-hi / --text-* tokens as everything else, so it
// automatically follows light/dark like the rest of the app). Deliberately
// NOT a popup/modal: no backdrop, no click-to-dismiss, no focus trap — it
// just appears on hover or keyboard focus and disappears when you leave.
//
// Used across the admin dashboard to let the UI "prompt" when an action is
// due (flagged rule, threshold override, milestone reached, open alert)
// without adding a modal or a toast the admin has to dismiss.

import { useId, useState, type ReactNode } from 'react'

interface TooltipProps {
  label: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  tone?: 'default' | 'warning' | 'success'
}

export default function Tooltip({ label, children, side = 'top', tone = 'default' }: TooltipProps) {
  const [open, setOpen] = useState(false)
  const id = useId()

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        tabIndex={0}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{ display: 'inline-flex', alignItems: 'center', cursor: 'help' }}
      >
        {children}
      </span>
      {open && (
        <span id={id} role="tooltip" className={`qv-tooltip qv-tooltip-${side} qv-tooltip-${tone}`}>
          {label}
        </span>
      )}
    </span>
  )
}

/** Small colored dot that signals "this needs a look" — pair with <Tooltip> to explain why. */
export function DueDot({ tone = 'warning' }: { tone?: 'warning' | 'amber' }) {
  return <span className={`qv-due-dot ${tone === 'amber' ? 'qv-due-dot-amber' : ''}`} aria-hidden="true" />
}
