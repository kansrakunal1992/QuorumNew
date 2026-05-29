'use client'

// ── PatternSurfaceCard ────────────────────────────────────────────────────────
// Chunk 4a — Proactive pattern surfacing on home screen.
// Shown when mirrorUnlocked + sessionCount >= 5.
// Reads /api/mirror/patterns and surfaces the top-firing rule in plain language.
// No chart. No graph. One specific, structural, slightly uncomfortable finding.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'

interface RulePattern {
  rule_id:     string
  label:       string
  description: string
  type:        'REDIRECT' | 'GATE' | 'FLAG'
  fire_count:  number
  pct:         number
  session_ids: string[]
}

interface Props {
  authToken:    string | null
  sessionCount: number
}

const PATTERN_THRESHOLD = 5

// Plain-language narrative per rule — specific, structural, slightly uncomfortable
const RULE_NARRATIVE: Record<string, (count: number, total: number) => string> = {
  R1:  (c, t) => `In ${c} of your ${t} decisions, you were waiting for a prior question to resolve before you could decide. The prior question was never named.`,
  R2:  (c, t) => `${c} of your ${t} decisions carried strong identity stakes. In each case, the Council flagged the values question before the analysis — you moved to analysis first.`,
  R3:  (c, t) => `You brought ${c} decisions to the Council where the information needed to decide didn't exist yet. The decisions were treated as ready.`,
  R4:  (c, t) => `In ${c} of your ${t} decisions, the downside was structurally irreversible while the upside was not. The asymmetry was present; it was not the deciding factor.`,
  R5:  (c, t) => `${c} of your ${t} decisions carried high emotional intensity without genuine time pressure. The urgency was real to you. The structure didn't support it.`,
  R6:  (c, t) => `${c} decisions involved multiple stakeholders with unresolved alignment. The decisions proceeded without that alignment established first.`,
  R7:  (c, t) => `In ${c} of your ${t} decisions, a specific piece of missing information would have materially changed the answer. The information was not gathered before deciding.`,
  R8:  (c, t) => `${c} of your ${t} decisions contained a deep conflict between two values you hold. The conflict was visible. It was not resolved — the decision was made anyway.`,
  R9:  (c, t) => `${c} decisions were structurally irreversible, made under emotional pressure, with no genuine time constraint. All three conditions were present each time.`,
  R10: (c, t) => `In ${c} of your ${t} decisions, the complexity and ambiguity were both high. You brought these to the Council without first structuring what you were trying to solve.`,
  R12: (c, t) => `${c} decisions required alignment with a partner or co-decision-maker. In each case, the decision was analysed before that alignment was sought.`,
}

export default function PatternSurfaceCard({ authToken, sessionCount }: Props) {
  const [pattern,  setPattern]  = useState<RulePattern | null>(null)
  const [total,    setTotal]    = useState(0)
  const [loading,  setLoading]  = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!authToken || sessionCount < PATTERN_THRESHOLD) { setLoading(false); return }

    const headers: Record<string, string> = {}
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`

    fetch('/api/mirror/patterns', { headers })
      .then(r => r.json())
      .then(data => {
        if (data.threshold_met && data.patterns?.length > 0) {
          setPattern(data.patterns[0])
          setTotal(data.session_count ?? sessionCount)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [authToken, sessionCount])

  if (loading || !pattern) return null

  const narrative = RULE_NARRATIVE[pattern.rule_id]?.(pattern.fire_count, total)
  if (!narrative) return null

  const typeColor: Record<string, string> = {
    FLAG:     'var(--gold)',
    REDIRECT: '#3a78c4',
    GATE:     '#38a468',
  }

  return (
    <div style={{
      background:   'var(--bg-card)',
      border:       '1px solid var(--border-mid)',
      borderLeft:   `2px solid ${typeColor[pattern.type] ?? 'var(--gold)'}`,
      borderRadius: 12,
      padding:      '16px 20px',
      marginBottom: 12,
      cursor:       'pointer',
      transition:   'border-color 0.2s',
    }}
    onClick={() => setExpanded(e => !e)}
    onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-hi)')}
    onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-mid)')}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
        <div>
          <p style={{
            fontFamily:    'var(--font-mono)',
            fontSize:      9.5,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color:         typeColor[pattern.type] ?? 'var(--gold)',
            margin:        '0 0 4px',
            opacity:       0.9,
          }}>
            Pattern surfaced from your record
          </p>
          <p style={{
            fontFamily: 'var(--font-display)',
            fontSize:   15,
            fontWeight: 400,
            color:      'var(--text-1)',
            margin:     0,
            lineHeight: 1.4,
          }}>
            {pattern.label}
          </p>
        </div>
        <span style={{
          fontFamily:    'var(--font-mono)',
          fontSize:      10,
          color:         'var(--text-4)',
          background:    'var(--bg-inset)',
          border:        '1px solid var(--border-dim)',
          borderRadius:  20,
          padding:       '2px 10px',
          whiteSpace:    'nowrap',
          flexShrink:    0,
          letterSpacing: '0.06em',
        }}>
          {pattern.fire_count} of {total}
        </span>
      </div>

      {/* Narrative */}
      <p style={{
        fontSize:   12.5,
        color:      'var(--text-3)',
        lineHeight: 1.65,
        margin:     0,
      }}>
        {narrative}
      </p>

      {/* Expanded: session list */}
      {expanded && pattern.session_ids.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-dim)' }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-4)', margin: '0 0 8px' }}>
            Decisions where this fired
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {pattern.session_ids.slice(0, 4).map(id => (
              <a
                key={id}
                href={`/record/${id}`}
                onClick={e => e.stopPropagation()}
                style={{
                  fontSize:       11,
                  color:          'var(--text-3)',
                  fontFamily:     'var(--font-mono)',
                  letterSpacing:  '0.04em',
                  textDecoration: 'none',
                  opacity:        0.75,
                  transition:     'opacity 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '0.75')}
              >
                → {id.slice(0, 8)}…
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Expand hint */}
      <p style={{ fontSize: 10, color: 'var(--text-4)', margin: '10px 0 0', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', opacity: 0.6 }}>
        {expanded ? 'Tap to collapse' : 'Tap to see source decisions'}
      </p>
    </div>
  )
}
