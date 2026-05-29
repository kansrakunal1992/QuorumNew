'use client'

// ── RecurringConditionCard ────────────────────────────────────────────────────
// Chunk 4c — "What Keeps Coming Up"
// After 3+ decisions with the same high-scoring structural dimension,
// surfaces a pure observation. No recommendation. No advice.
// Reads top_dimensions[] from /api/mirror/patterns (same call as 4a).
// ─────────────────────────────────────────────────────────────────────────────

interface DimPattern {
  dim:        string
  label:      string
  avg_score:  number
  high_count: number
}

interface Props {
  dimensions:   DimPattern[]
  sessionCount: number
}

const RECURRING_THRESHOLD = 3   // high_count must be >= this

// Human-readable question frame per dimension
const DIM_QUESTION: Record<string, string> = {
  reversibility:               'reversibility — whether what you are deciding can be undone',
  time_horizon:                'time horizon — how far ahead the consequences of this reach',
  stakes_magnitude:            'stakes magnitude — how much is genuinely at risk',
  outcome_uncertainty:         'outcome uncertainty — whether the result is knowable in advance',
  ambiguity:                   'ambiguity — whether the question itself is clear enough to answer',
  task_complexity:             'task complexity — how many moving parts are genuinely entangled',
  decision_discriminating_info:'information gaps — what you would need to know to decide with confidence',
  time_pressure:               'time pressure — whether the deadline is real or perceived',
  decision_unit:               'scope — whether you are deciding the right-sized question',
  value_conflict:              'value conflict — whether what you want is in tension with what you believe',
  emotional_intensity:         'emotional intensity — how much the outcome matters to you personally',
  identity_alignment:          'identity — whether this decision touches who you are or who you are becoming',
  regret_asymmetry:            'regret asymmetry — whether the regret of being wrong is symmetrical',
  upstream_dependency:         'upstream dependency — whether this decision depends on another that is unresolved',
}

export default function RecurringConditionCard({ dimensions, sessionCount }: Props) {
  const qualifying = dimensions.filter(d => d.high_count >= RECURRING_THRESHOLD)
  if (qualifying.length === 0) return null

  const top = qualifying[0]
  const question = DIM_QUESTION[top.dim]
  if (!question) return null

  return (
    <div style={{
      background:   'var(--bg-card)',
      border:       '1px solid var(--border-dim)',
      borderRadius: 12,
      padding:      '16px 20px',
      marginBottom: 12,
    }}>
      <p style={{
        fontFamily:    'var(--font-mono)',
        fontSize:      9.5,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color:         'var(--text-4)',
        margin:        '0 0 8px',
        opacity:       0.8,
      }}>
        What keeps coming up
      </p>
      <p style={{
        fontSize:   13,
        color:      'var(--text-2)',
        lineHeight: 1.65,
        margin:     0,
      }}>
        You have opened a question about{' '}
        <span style={{ color: 'var(--text-1)', fontWeight: 500 }}>{question}</span>
        {' '}across {top.high_count} of your {sessionCount} decisions.
        It has not been resolved in any of them.
      </p>
    </div>
  )
}
