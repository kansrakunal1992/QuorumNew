'use client'

// ── RecurringConditionCard ────────────────────────────────────────────────────
// Chunk 4c — "What Keeps Coming Up"
// Plain language. No behavioral jargon. One actionable line.
// CTA links to Mirror → "What Keeps Coming Up" section for full detail.
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

const RECURRING_THRESHOLD = 3

// Plain language — what the user actually experiences, not the dimension label
const DIM_PLAIN: Record<string, {
  observation: (count: number, total: number) => string
  actionable:  string
}> = {
  reversibility: {
    observation: (c, t) => `In ${c} of your ${t} decisions, you have been making choices that cannot easily be undone — and continuing anyway.`,
    actionable:  'Before the next decision of this kind, write down what undoing it would actually cost. Name it once, clearly, before you decide.',
  },
  time_horizon: {
    observation: (c, t) => `${c} of your ${t} decisions involve consequences that play out over years, not months. You have been treating them with the same speed as short-term ones.`,
    actionable:  'For decisions with a long horizon, slow the process proportionally. A year-long consequence deserves more than an hour of deliberation.',
  },
  stakes_magnitude: {
    observation: (c, t) => `Across ${c} of your ${t} decisions, the genuine stakes have been high — and not always named explicitly before deciding.`,
    actionable:  'State the actual downside before the next high-stakes decision. Not a range — a specific worst case, in writing.',
  },
  outcome_uncertainty: {
    observation: (c, t) => `${c} of your ${t} decisions were made without being able to know the outcome in advance. You have been deciding without that being fully acknowledged.`,
    actionable:  'Separate what you know from what you are guessing. The Council works better with an honest map of your uncertainty.',
  },
  ambiguity: {
    observation: (c, t) => `In ${c} of your ${t} decisions, the question itself was not fully clear before you began. You have been analysing before the problem was defined.`,
    actionable:  'Write one sentence describing exactly what you are deciding before bringing the next ambiguous decision to the Council.',
  },
  task_complexity: {
    observation: (c, t) => `${c} of your ${t} decisions involved many moving parts that were not fully mapped before deciding.`,
    actionable:  'List the three most entangled variables before your next complex decision. You do not need to solve them — just name them.',
  },
  decision_discriminating_info: {
    observation: (c, t) => `Across ${c} of your ${t} decisions, there was information that would have changed your answer — and it was not gathered first.`,
    actionable:  'Name the one piece of information that would most change your decision. If you can get it, get it before you run the Council.',
  },
  time_pressure: {
    observation: (c, t) => `${c} of your ${t} decisions were brought under time pressure. In several cases, that pressure was self-created or perceived rather than real.`,
    actionable:  'For the next urgent decision, ask once: does anything external actually force this now? If the honest answer is no, slow down.',
  },
  decision_unit: {
    observation: (c, t) => `In ${c} of your ${t} decisions, the scope of what you were deciding was unclear — too large, too small, or bundled with a separate question.`,
    actionable:  'Before running the Council, ask: am I deciding the right-sized question? Unbundle if needed.',
  },
  value_conflict: {
    observation: (c, t) => `${c} of your ${t} decisions have contained a tension between two things you value. The tension was present; it was not always resolved before deciding.`,
    actionable:  'Name the two values in conflict before your next decision of this kind. Decide which takes precedence in this category — once, clearly.',
  },
  emotional_intensity: {
    observation: (c, t) => `Across ${c} of your ${t} decisions, the outcome mattered deeply to you personally. High emotional intensity has been a recurring condition in your record.`,
    actionable:  'When the outcome matters this much, separate your preference from your analysis. Run the Council on what is actually true, not what you want to be true.',
  },
  identity_alignment: {
    observation: (c, t) => `${c} of your ${t} decisions touched who you are or who you are becoming — not just what you should do. You have been making identity decisions at the speed of practical ones.`,
    actionable:  'Identity decisions deserve a separate, slower pass. Before the next one, ask: what would I decide if I were not worried about who this makes me?',
  },
  regret_asymmetry: {
    observation: (c, t) => `In ${c} of your ${t} decisions, the regret of being wrong in one direction was much larger than the other. That asymmetry was not always the deciding factor.`,
    actionable:  'Map the asymmetry explicitly: which regret is worse — acting and being wrong, or not acting and being wrong? Let the answer shape how much caution you apply.',
  },
  upstream_dependency: {
    observation: (c, t) => `${c} of your ${t} decisions depended on something else being resolved first. You have been analysing the downstream decision before the upstream one was settled.`,
    actionable:  'Name the prior question before bringing the next dependent decision to the Council. Resolve the upstream first — or decide explicitly that you will proceed without it.',
  },
}

export default function RecurringConditionCard({ dimensions, sessionCount }: Props) {
  const qualifying = dimensions.filter(d => d.high_count >= RECURRING_THRESHOLD)
  if (qualifying.length === 0) return null

  const top  = qualifying[0]
  const copy = DIM_PLAIN[top.dim]
  if (!copy) return null

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

      <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.65, margin: '0 0 10px' }}>
        {copy.observation(top.high_count, sessionCount)}
      </p>

      {/* Actionable */}
      <div style={{
        background:   'var(--bg-inset)',
        border:       '1px solid var(--border-dim)',
        borderRadius: 8,
        padding:      '10px 14px',
        marginBottom: 10,
      }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-4)', margin: '0 0 5px' }}>
          What to do next time
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6, margin: 0 }}>
          {copy.actionable}
        </p>
      </div>

      {/* CTA to Mirror — replaces evidence section (session IDs not available per dimension) */}
      <a
        href="/mirror#msec-patterns"
        style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          marginTop:      4,
          padding:        '8px 12px',
          background:     'var(--bg-inset)',
          border:         '1px solid var(--border-dim)',
          borderRadius:   8,
          textDecoration: 'none',
          transition:     'border-color 0.2s',
        }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-mid)')}
        onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-dim)')}
      >
        <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.4 }}>
          See all patterns in detail
        </span>
        <span style={{ fontSize: 11, color: 'var(--gold)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}>
          Mirror →
        </span>
      </a>
    </div>
  )
}
