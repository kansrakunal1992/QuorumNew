'use client'

// ── RecurringConditionCard ────────────────────────────────────────────────────
// Chunk 4c — "What Keeps Coming Up"
// Plain language. No behavioral jargon. One actionable line.
// UX fix: decision evidence follows same toggle pattern as PatternSurfaceCard.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'

interface DimPattern {
  dim:        string
  label:      string
  avg_score:  number
  high_count: number
}

interface SessionSummary {
  id:            string
  decision_text: string
  created_at:    string
}

interface Props {
  dimensions:   DimPattern[]
  sessionCount: number
  sessions?:    SessionSummary[]
}

const RECURRING_THRESHOLD = 3
const DECISIONS_PREVIEW   = 2   // show 2, rest behind "Show more"

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

export default function RecurringConditionCard({ dimensions, sessionCount, sessions }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [showAll,  setShowAll]  = useState(false)

  const qualifying = dimensions.filter(d => d.high_count >= RECURRING_THRESHOLD)
  if (qualifying.length === 0) return null

  const top  = qualifying[0]
  const copy = DIM_PLAIN[top.dim]
  if (!copy) return null

  // Most-recent sessions first as evidence — sorted descending by date
  const allSessions = sessions
    ? [...sessions].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    : []
  const visibleSessions = showAll ? allSessions : allSessions.slice(0, DECISIONS_PREVIEW)
  const hiddenCount     = allSessions.length - DECISIONS_PREVIEW

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

      {/* Toggle — only shown when sessions exist */}
      {allSessions.length > 0 && (
        <button
          onClick={() => setExpanded(e => !e)}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)', letterSpacing: '0.08em', opacity: 0.65, transition: 'opacity 0.2s' }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '0.65')}
        >
          {expanded ? 'Hide decisions ↑' : 'See source decisions ↓'}
        </button>
      )}

      {/* Source decisions */}
      {expanded && allSessions.length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-dim)' }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-4)', margin: '0 0 8px' }}>
            Decisions where this fired
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {visibleSessions.map(s => (
              <a
                key={s.id}
                href={`/record/${s.id}`}
                style={{ fontSize: 12, color: 'var(--text-3)', textDecoration: 'none', lineHeight: 1.5, display: 'flex', alignItems: 'flex-start', gap: 8, transition: 'color 0.15s' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-1)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-3)')}
              >
                <span style={{ color: 'var(--text-4)', flexShrink: 0, marginTop: 1 }}>→</span>
                <span>{s.decision_text.length > 80 ? s.decision_text.slice(0, 80) + '…' : s.decision_text}</span>
              </a>
            ))}
          </div>

          {hiddenCount > 0 && !showAll && (
            <button
              onClick={e => { e.stopPropagation(); setShowAll(true) }}
              style={{ marginTop: 8, background: 'none', border: '1px solid var(--border-dim)', borderRadius: 8, padding: '6px 14px', fontSize: 11, color: 'var(--text-4)', cursor: 'pointer', fontFamily: 'inherit', transition: 'border-color 0.2s, color 0.2s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-mid)'; e.currentTarget.style.color = 'var(--text-3)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-dim)'; e.currentTarget.style.color = 'var(--text-4)' }}
            >
              Show {hiddenCount} more
            </button>
          )}
        </div>
      )}
    </div>
  )
}
