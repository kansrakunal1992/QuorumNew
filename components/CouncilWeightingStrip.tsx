'use client'
// components/CouncilWeightingStrip.tsx
// S2-02: Reveals which advisors were weighted most heavily for this specific decision,
// and why. Shows immediately after synthesis completes — same experience for all tiers
// (< 3 sessions, teaser, and unlocked). It explains the synthesis they already received
// for free; gating it would be punitive.
//
// Data source: computePersonaRelevance() in SessionView (already runs client-side to
// compute persona ordering). The result is passed here as a prop — no additional API call.
// Shows top 3 advisors by weight with a relative bar chart.

import type { PersonaRelevanceMap } from '@/lib/persona-relevance'

interface Props {
  weights: PersonaRelevanceMap
}

const LABELS: Record<string, string> = {
  contrarian:         'Contrarian',
  risk_architect:     'Risk Architect',
  pattern_analyst:    'Pattern Analyst',
  stakeholder_mirror: 'Stakeholder Mirror',
  elder:              'Elder',
  competitor:         'Competitor',
}

const ACCENTS: Record<string, string> = {
  contrarian:         '#b03535',
  risk_architect:     '#3268b0',
  pattern_analyst:    '#2e8a58',
  stakeholder_mirror: '#7230a8',
  elder:              '#a86a20',
  competitor:         '#5e6830',
}

export default function CouncilWeightingStrip({ weights }: Props) {
  const sorted = (Object.entries(weights) as [string, number][])
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)

  // Baseline is 0.50 — only show strip if at least one advisor is above baseline
  const hasElevated = sorted.some(([, s]) => s > 0.52)
  if (!hasElevated) return null

  const maxScore  = sorted[0]?.[1] ?? 1

  return (
    <div style={{
      marginTop:    16,
      paddingTop:   14,
      borderTop:    '1px solid var(--border-dim)',
    }}>
      <p style={{
        fontSize:      10,
        fontWeight:    700,
        letterSpacing: '0.10em',
        textTransform: 'uppercase',
        color:         'var(--text-4)',
        margin:        '0 0 10px',
      }}>
        How the Council was weighted for this decision
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sorted.map(([key, score]) => {
          const barWidth = Math.round((score / maxScore) * 100)
          const accent   = ACCENTS[key] ?? 'var(--text-4)'
          const pct      = Math.round(score * 100)

          return (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* Persona colour dot */}
              <div style={{
                width: 6, height: 6, borderRadius: '50%',
                background: accent, flexShrink: 0, opacity: 0.8,
              }} />

              {/* Persona label */}
              <span style={{
                fontSize:  11.5,
                color:     'var(--text-3)',
                width:     118,
                flexShrink: 0,
                lineHeight: 1.2,
              }}>
                {LABELS[key] ?? key}
              </span>

              {/* Bar track */}
              <div style={{
                flex:         1,
                height:       3,
                borderRadius: 2,
                background:   'var(--border-dim)',
                overflow:     'hidden',
              }}>
                <div style={{
                  width:        `${barWidth}%`,
                  height:       '100%',
                  borderRadius:  2,
                  background:    accent,
                  opacity:       0.65,
                  transition:    'width 0.4s ease',
                }} />
              </div>

              {/* Score */}
              <span style={{
                fontSize:    10,
                fontFamily:  'var(--font-mono)',
                color:       'var(--text-4)',
                width:       26,
                textAlign:   'right',
                flexShrink:  0,
              }}>
                {pct}
              </span>
            </div>
          )
        })}
      </div>

      <p style={{
        fontSize:   10.5,
        color:      'var(--text-5, var(--text-4))',
        margin:     '9px 0 0',
        lineHeight: 1.55,
      }}>
        Quorum weighted your Council based on the structural profile of this decision —
        its reversibility, identity stakes, and rule signals.
      </p>
    </div>
  )
}
