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

interface Props {
  weights: Record<string, number>
  /** P1: previous synthesis version's weight snapshot — when provided, renders
   *  a ↑/↓ delta next to each score. Omitted entirely (exactly today's
   *  behaviour) when this prop isn't passed, so existing callers are unaffected.
   *  Typed as a plain Record rather than PersonaRelevanceMap: synthesis-version
   *  snapshots (lib/synthesis-diff.ts) store weights as Record<string, number>,
   *  and this component never actually relies on all 6 advisor keys being
   *  guaranteed present — it only sorts/slices whatever entries exist. */
  previousWeights?: Record<string, number> | null
  /** Sprint 1 follow-on (Feature #4 polish): one short, plain-English clause
   *  per advisor explaining what actually drove its weight — from
   *  lib/persona-relevance.ts's explainPersonaWeights(), same inputs as the
   *  synthesis directive itself. When a key has no entry (nothing specific
   *  found for that advisor), that row just shows no subline — never an
   *  invented one. Omitted entirely → the original generic footer line
   *  stays exactly as it was, so existing callers are unaffected. */
  reasons?: Record<string, string> | null
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

// Sprint 1 follow-on: an advisor outside the top 3 by raw weight can still
// have moved a lot since the last version (e.g. Elder dropping 8pts while
// staying 4th-ranked) — the original "top 3 only" cap made that invisible.
// A real jump is shown even if it isn't a top-3 weight; capped at one extra
// slot so this stays a glance, not a leaderboard.
const MOVER_DELTA_THRESHOLD = 8
const MAX_SHOWN = 4

export default function CouncilWeightingStrip({ weights, previousWeights = null, reasons = null }: Props) {
  const allEntries = Object.entries(weights) as [string, number][]
  const byWeight    = [...allEntries].sort(([, a], [, b]) => b - a)
  const top3        = byWeight.slice(0, 3)
  const top3Keys    = new Set(top3.map(([k]) => k))

  // Sprint 1 follow-on: find the single biggest mover outside the top 3, if
  // previousWeights lets us compute deltas and it's a real jump.
  let extraMover: [string, number] | null = null
  if (previousWeights) {
    const moversOutsideTop3 = byWeight
      .filter(([k]) => !top3Keys.has(k))
      .map(([k, s]): [string, number, number] => {
        const prevPct = Math.round((previousWeights[k] ?? s) * 100)
        return [k, s, Math.abs(Math.round(s * 100) - prevPct)]
      })
      .filter(([, , absDelta]) => absDelta >= MOVER_DELTA_THRESHOLD)
      .sort((a, b) => b[2] - a[2])
    if (moversOutsideTop3.length > 0) {
      extraMover = [moversOutsideTop3[0][0], moversOutsideTop3[0][1]]
    }
  }

  const sorted = extraMover ? [...top3, extraMover].slice(0, MAX_SHOWN) : top3

  // Baseline is 0.50 — only show strip if at least one advisor is above baseline
  const hasElevated = sorted.some(([, s]) => s > 0.52)
  if (!hasElevated) return null

  const maxScore  = byWeight[0]?.[1] ?? 1

  // Only show the generic footer sentence when we have no specific reasons
  // at all for anything currently shown — once even one advisor has a real
  // reason, the per-row sublines carry that job instead, and repeating a
  // generic paragraph underneath would be redundant.
  const anySpecificReason = sorted.some(([key]) => reasons?.[key])

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
          // P1: delta vs previous synthesis version, if supplied.
          const prevPct  = previousWeights ? Math.round((previousWeights[key] ?? score) * 100) : null
          const delta    = prevPct !== null ? pct - prevPct : 0
          const reason   = reasons?.[key]

          return (
            <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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

                {/* P1: delta badge — only shown when previousWeights supplied and the
                    change is non-trivial (avoids noisy ±1 rounding flicker). */}
                {prevPct !== null && Math.abs(delta) >= 2 && (
                  <span style={{
                    fontSize:   9,
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 700,
                    width:      28,
                    textAlign:  'left',
                    flexShrink: 0,
                    color:      delta > 0 ? 'var(--positive, #2e8a58)' : 'var(--negative, #b03535)',
                  }}>
                    {delta > 0 ? `↑${delta}` : `↓${Math.abs(delta)}`}
                  </span>
                )}
              </div>

              {/* Sprint 1 follow-on: specific per-advisor reason, indented to
                  align under the label rather than the dot. Short clause only —
                  no period, reads as a continuation of the label above it. */}
              {reason && (
                <span style={{
                  fontSize:   10.5,
                  color:      'var(--text-4)',
                  lineHeight: 1.4,
                  marginLeft: 16,
                }}>
                  {reason}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {!anySpecificReason && (
        <p style={{
          fontSize:   10.5,
          color:      'var(--text-5, var(--text-4))',
          margin:     '9px 0 0',
          lineHeight: 1.55,
        }}>
          Quorum weighted your Council based on the structural profile of this decision —
          its reversibility, identity stakes, and rule signals.
        </p>
      )}
    </div>
  )
}
