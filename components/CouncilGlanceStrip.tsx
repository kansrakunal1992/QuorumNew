// components/CouncilGlanceStrip.tsx
// Council redesign (Sprint 2), point C — "stack of short cards is still a
// stack" problem. This is the Tier-0 layer: a single row read in a couple
// of seconds, sitting above the (now denser, collapsed-by-default) card
// grid, so the shape of the debate — how many advisors lean which way — is
// visible before reading any individual card. Deliberately a separate,
// simpler component from CouncilWeightingStrip: that one shows the top 3-4
// advisors by synthesis WEIGHT, after synthesis, as the "why" behind
// Quorum's read. This one shows all 6, by LEAN, before the grid — different
// data, different question ("who's said anything yet, and which way"), and
// mixing the two would make an already-overloaded "colored dot" visual
// vocabulary mean two different things depending on where it appears.
//
// Consolidation (round 2): the personaAccent local copy this comment used
// to describe is gone — accentColor now lives once, on PersonaMeta
// (lib/types.ts / lib/personas.ts), and PersonaPanel.tsx /
// CouncilWeightingStrip.tsx read it from there too instead of each keeping
// an independent copy of the same six values.

import type { PersonaKey } from '@/lib/types'
import { PERSONAS } from '@/lib/personas'
import type { Lean } from './TensionInterstitial'
import PersonaIcon from './PersonaIcon'
import { LEAN_COLORS } from './LeanBadge'

interface Props {
  orderedKeys: PersonaKey[]
  leans: Partial<Record<string, Lean>>
  /** Which chips, if any, correspond to currently-expanded cards — drawn
   *  with a slightly stronger border so the strip and the grid below it
   *  read as one connected view rather than two disconnected pieces. More
   *  than one card can be expanded at once, so this is a set, not a single
   *  key. */
  expandedKeys?: ReadonlySet<string>
  onSelect?: (key: PersonaKey) => void
}

export default function CouncilGlanceStrip({ orderedKeys, leans, expandedKeys, onSelect }: Props) {
  return (
    <div
      role="list"
      aria-label="Council at a glance — one lean per advisor"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 16,
      }}
    >
      {orderedKeys.map((key, i) => {
        const persona = PERSONAS[key]
        if (!persona) return null
        const lean = leans[key]
        const accent = persona.accentColor || 'var(--text-3)'
        const isExpanded = expandedKeys?.has(key) ?? false
        const shortLabel = persona.label.replace(/^The\s+/, '')

        return (
          <button
            key={key}
            role="listitem"
            type="button"
            className="council-stagger"
            onClick={onSelect ? () => onSelect(key) : undefined}
            aria-label={`${persona.label}${lean ? `, leans ${lean}` : ', still responding'}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 10px 5px 8px',
              borderRadius: 999,
              border: `1px solid ${isExpanded ? accent : 'var(--border-dim)'}`,
              background: 'var(--bg-inset)',
              cursor: onSelect ? 'pointer' : 'default',
              font: 'inherit',
              // Round 12: display-order index for .council-stagger's
              // animation-delay (globals.css) — inert unless an ancestor
              // carries data-council-arrived (SessionView, flag on).
              ...({ '--council-i': i } as React.CSSProperties),
            }}
          >
            <PersonaIcon persona={key as Exclude<PersonaKey, 'synthesis' | 'decision_brief'>} size={14} color={accent} strokeWidth={1.6} />
            <span style={{ fontSize: 12, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{shortLabel}</span>
            <span
              aria-hidden="true"
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: lean ? LEAN_COLORS[lean] : 'var(--border-mid)',
                flexShrink: 0,
                opacity: lean ? 1 : 0.6,
              }}
            />
          </button>
        )
      })}
    </div>
  )
}
