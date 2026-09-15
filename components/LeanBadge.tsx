// components/LeanBadge.tsx
// Council redesign (Sprint 2): small color-coded pill for a persona's
// proceed/wait/mixed classification — the "color classification" piece of
// the tiered Council rework. Given one shared home here (LEAN_LABELS/
// LEAN_COLORS + the badge itself) rather than a local copy per call site,
// since it's used in two places at once from day one: PersonaPanel's
// collapsed-card summary and CouncilGlanceStrip's at-a-glance row. This is
// deliberately NOT the same pattern as ACCENT_COLORS (persona identity
// colors), which already has one copy in PersonaPanel.tsx and a second,
// independently-drifting copy in CouncilWeightingStrip.tsx — a known,
// separately-tracked cleanup item this file doesn't attempt to fix.
//
// LEAN_LABELS matches the wording already used for the "shifted after
// pushback" badge (PersonaPanel.tsx) and WhatChangedDrawer, so a lean reads
// the same way everywhere it appears.

import type { Lean } from './TensionInterstitial'

export const LEAN_LABELS: Record<Lean, string> = {
  proceed: 'Proceed',
  wait:    'Wait',
  mixed:   'Mixed',
}

// Not theme-conditional for 'proceed' (same literal in light/dark) —
// matches the existing var(--positive, #2e8a58) fallback convention already
// used in CouncilWeightingStrip.tsx, so a "proceed" reads as the same green
// wherever it shows up. 'wait' reuses --gold (already theme-aware, already
// carries an "worth a second look" connotation elsewhere in the app) rather
// than introducing a fourth color token. 'mixed' reuses the existing
// secondary-text token rather than a new neutral gray.
export const LEAN_COLORS: Record<Lean, string> = {
  proceed: '#2e8a58',
  wait:    'var(--gold)',
  mixed:   'var(--text-4)',
}

interface Props {
  lean: Lean
  size?: 'sm' | 'md'
}

export default function LeanBadge({ lean, size = 'sm' }: Props) {
  const color = LEAN_COLORS[lean]
  const small = size === 'sm'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: small ? '2px 8px' : '3px 10px',
        borderRadius: 999,
        fontSize: small ? 11 : 12,
        fontWeight: 600,
        letterSpacing: '0.03em',
        textTransform: 'uppercase',
        color,
        background: 'var(--bg-inset)',
        border: '1px solid var(--border-dim)',
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden="true"
        style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }}
      />
      {LEAN_LABELS[lean]}
    </span>
  )
}
