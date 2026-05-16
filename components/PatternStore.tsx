'use client'

// components/PatternStore.tsx
// ── Mirror Module: Decision Pattern Store (Sprint 18b) ────────────────────────
//
// Surfaces /api/mirror/patterns in the Mirror unlocked view.
//
// Three layers:
//   1. Computed headline — synthesised from the top patterns client-side.
//      No AI call. Reads the actual firing pattern and produces a paragraph
//      that names what's going on structurally across the user's decisions.
//
//   2. Structural triggers — each rule shown with:
//        • plain-language explanation of what the pattern actually means
//        • concrete actionable tip the user can apply to future decisions
//        • frequency bar + phrase ("Almost every decision", "Recurring", etc.)
//
//   3. Decision profile — top ontology dimensions, each with:
//        • plain description of what the dimension measures
//        • score bar + plain reading ("High", "Moderate", etc.)
//        • a synthesis line across all top dims if they're uniformly high
//
// All copy is written to be readable without any Quorum context.
// No internal terms (rule engine, tagger, ontology vector) in user-facing copy.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'
import type { PatternStoreData, RulePattern, DimPattern, RuleType } from '@/lib/types'

// ── Type badges ───────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<RuleType, { label: string; color: string; bg: string }> = {
  REDIRECT: { label: 'Wrong question', color: '#7eb8e0', bg: 'rgba(126,184,224,0.08)' },
  GATE:     { label: 'Pause first',    color: '#c9a84c', bg: 'rgba(201,168,76,0.08)'  },
  FLAG:     { label: 'Watch this',     color: '#e09070', bg: 'rgba(224,144,112,0.08)' },
}

// ── Per-rule plain content ────────────────────────────────────────────────────
//
// plain:  What this pattern actually means for the user — no jargon.
// action: One concrete thing they can do differently in future decisions.

const RULE_CONTENT: Record<string, { plain: string; action: string }> = {
  R1: {
    plain:  'You're trying to decide something that depends on a bigger, unresolved question you haven't faced yet. Working on the downstream decision before the upstream one is settled tends to produce analysis that doesn't stick.',
    action: 'Before starting any significant decision, ask: "Is there a larger, prior question this one depends on?" If yes — that's the decision to make first.',
  },
  R2: {
    plain:  'This decision is tangled up with who you are or want to be. When identity is at stake, pure analysis won't cut through — the values question has to come first, or you'll keep circling.',
    action: 'Write down what going each way says about you. The identity question needs to be named and answered before you start weighing options.',
  },
  R3: {
    plain:  'The information you have isn't good enough to discriminate between your options. Deciding here means guessing dressed up as reasoning.',
    action: 'Don't force it. Name the one or two things you'd need to know, and go find them before you proceed.',
  },
  R4: {
    plain:  'The downside of being wrong on this decision is much larger than the upside of being right — but the way you're approaching it doesn't always reflect that asymmetry. You're treating a high-consequence decision like a normal one.',
    action: 'Before committing, write down the worst realistic outcome if you're wrong. If that number or consequence is much bigger than the gain, your bar for deciding should be higher than it currently feels.',
  },
  R5: {
    plain:  'The decision feels urgent — but the pressure is coming from your emotional state, not from a real deadline. Emotional intensity is manufacturing urgency that doesn't exist in the situation itself.',
    action: 'Ask yourself: "What actually happens if I wait 72 hours?" If the answer is "not much" — the urgency isn't real. The intensity is.',
  },
  R6: {
    plain:  'Multiple people are emotionally involved, and you're trying to think your way to an answer before everyone is even on the same page. The analysis becomes irrelevant if the people part isn't resolved first.',
    action: 'Make alignment the explicit first step — not something you hope happens once you've figured out what you want. Ask each person what they actually need from the outcome before you start analysing options.',
  },
  R7: {
    plain:  'There's one specific piece of missing information that would meaningfully change your answer — and you're moving forward without it.',
    action: 'Ask: "What one thing, if I knew it, would change my answer?" If you can name it clearly — go get it before you decide.',
  },
  R8: {
    plain:  'Two things you genuinely care about are pulling in opposite directions, and no amount of analysis will resolve that. This isn't an information problem — it's a values conflict.',
    action: 'Name the two values in conflict explicitly. Then decide which one you're choosing to prioritise in this specific situation — and own that choice rather than trying to optimise around it.',
  },
  R9: {
    plain:  'This decision is hard to undo, and you're feeling pressure to commit — but there's no real reason to rush. The combination of irreversibility and emotional urgency is dangerous.',
    action: 'Write it down: can this be undone? If not, the bar for deciding should be significantly higher than it currently feels. Slow down in proportion to how permanent the outcome is.',
  },
  R10: {
    plain:  'Too many moving parts, too many unknowns — trying to analyse this as one decision generates noise, not clarity.',
    action: 'Break it into 2–3 core sub-questions and solve those separately first. Don't attempt the whole picture until the component questions are clearer.',
  },
  R12: {
    plain:  'This is a joint decision, but the people involved aren't aligned on what actually matters. Analysing options together before that's resolved means everyone is arguing past each other.',
    action: 'Have the values conversation first. What does each person actually need from this outcome — not want, need. That question comes before any option is put on the table.',
  },
}

// ── Per-dimension plain content ───────────────────────────────────────────────

const DIM_CONTENT: Record<string, { meaning: string }> = {
  reversibility:                { meaning: 'How easy it would be to undo this decision if it turns out to be wrong.' },
  time_horizon:                 { meaning: 'How far into the future the effects of this decision reach.' },
  stakes_magnitude:             { meaning: 'How much is actually at stake — financially, professionally, or relationally.' },
  outcome_uncertainty:          { meaning: 'How unclear the result will be, even if you decide thoughtfully.' },
  ambiguity:                    { meaning: 'How unclear the decision itself is — what you're even choosing between.' },
  task_complexity:              { meaning: 'How many moving parts, people, and variables are involved.' },
  decision_discriminating_info: { meaning: 'How much the right information would actually change your answer.' },
  time_pressure:                { meaning: 'How much of a real deadline exists on this decision.' },
  decision_unit:                { meaning: 'How many people are making this decision together.' },
  value_conflict:               { meaning: 'How much two things you genuinely care about are pulling in opposite directions.' },
  emotional_intensity:          { meaning: 'How much emotion is active in how you're approaching this.' },
  identity_alignment:           { meaning: 'How much this decision is tied to who you are or want to be.' },
  regret_asymmetry:             { meaning: 'How much worse the downside is compared to the upside of getting it right.' },
  upstream_dependency:          { meaning: 'How much this decision depends on a bigger, unresolved one that sits behind it.' },
}

// ── Computed headline synthesis ───────────────────────────────────────────────
//
// Reads the actual top patterns and produces a plain paragraph that names
// the dominant structural reality across the user's decisions.
// No AI call — all client-side logic on the firing data.

function computeHeadline(patterns: RulePattern[], sessionsWithRules: number): string | null {
  if (patterns.length < 2 || sessionsWithRules < 5) return null

  const topIds  = patterns.slice(0, 3).map(p => p.rule_id)
  const hasR4   = topIds.includes('R4')   // Regret Asymmetry
  const hasR5   = topIds.includes('R5')   // False Urgency
  const hasR1   = topIds.includes('R1')   // Upstream Dependency
  const hasR6   = topIds.includes('R6')   // Multi-Party Alignment
  const hasR7   = topIds.includes('R7')   // Information-First
  const hasR2   = topIds.includes('R2')   // Identity-First Gate
  const hasR8   = patterns.slice(0, 5).map(p => p.rule_id).includes('R8') // Irreconcilable Values

  const flagCount = patterns.filter(p => p.type === 'FLAG').length
  const topPct    = patterns[0]?.pct ?? 0

  // Specific combinations first — most diagnostic
  if (hasR4 && hasR5) {
    return `Your most consistent pattern: you feel urgency on decisions where the cost of being wrong is much larger than the gain of being right. Almost 1 in 4 of your decisions show both signals together. The pressure you feel is real — but it's coming from emotion, not from the situation. That combination is where most consequential mistakes happen.`
  }
  if (hasR1 && hasR7) {
    return `A recurring theme: you're often working on the wrong level of question. Either the real decision sits upstream of the one you're analysing, or there's a specific piece of missing information that would change the answer. In both cases, the analysis happens before it can be useful.`
  }
  if (hasR6 && (hasR4 || hasR5)) {
    return `Your decisions frequently involve other people and high emotional stakes — a combination that makes urgency feel more real than it is. Group decisions need alignment before analysis, and emotional intensity needs to be distinguished from genuine time pressure. These two things keep showing up together.`
  }
  if (hasR2 && hasR8) {
    return `Identity and values are showing up as active forces in your decisions more than most. When who you are feels at stake, analysis alone won't resolve things — the values question has to be named first, or you'll keep going in circles.`
  }

  // General reads based on dominant type
  if (flagCount >= 3 && topPct >= 0.2) {
    return `Most of the patterns Quorum has detected are risk signals — things that are quietly shaping the outcome before you've started thinking. The analysis isn't the problem. It's the conditions around the decision that keep recurring.`
  }

  // Fallback: just describe what's repeating
  const topLabel = patterns[0]?.label
  const topFires = patterns[0]?.fire_count
  const pct      = Math.round((patterns[0]?.pct ?? 0) * 100)
  return `The most consistent signal across your decisions: ${topLabel} — appearing in ${pct}% of sessions, ${topFires} times. This is the pattern most worth understanding before you make your next significant decision.`
}

// ── Dimension synthesis ───────────────────────────────────────────────────────

function computeDimSynthesis(dims: DimPattern[]): string | null {
  if (dims.length < 3) return null
  const allHigh   = dims.slice(0, 3).every(d => d.avg_score >= 3.5)
  const hasStakes = dims.some(d => d.dim === 'stakes_magnitude' && d.avg_score >= 3.5)
  const hasUncert = dims.some(d => d.dim === 'outcome_uncertainty' && d.avg_score >= 3.5)
  const hasEmotion= dims.some(d => d.dim === 'emotional_intensity' && d.avg_score >= 3.5)

  if (allHigh && hasStakes && hasUncert) {
    return 'All your top dimensions score high. You consistently bring decisions that are genuinely difficult — high stakes, real uncertainty, meaningful complexity. This isn't anxiety or overthinking. These are the hardest category of decisions. That context matters when judging how you approach them.'
  }
  if (hasStakes && hasEmotion) {
    return 'High stakes and high emotional intensity appear together consistently. These two factors together make it harder to assess risk accurately — emotion compresses the time horizon and inflates urgency.'
  }
  if (hasUncert && dims.some(d => d.dim === 'ambiguity' && d.avg_score >= 3.0)) {
    return 'Uncertainty and ambiguity are both elevated across your decisions — meaning you often don't know what you're choosing between, and even if you did, you couldn't predict the outcome. Structured thinking helps here more than more information.'
  }
  return null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function freqPhrase(pct: number, count: number): string {
  const p = Math.round(pct * 100)
  if (p >= 80)     return `Almost every decision — ${p}%`
  if (p >= 50)     return `More often than not — ${p}%`
  if (p >= 30)     return `Recurring — ${p}% of decisions`
  if (count === 1) return `Once so far — watching for recurrence`
  return                  `${p}% of decisions`
}

function scoreLabel(score: number): string {
  if (score >= 4.5) return 'Extremely high — defines how you decide'
  if (score >= 3.5) return 'High — a dominant factor across your decisions'
  if (score >= 2.5) return 'Moderate — present but not dominant'
  return                   'Lower — not a primary driver'
}

function scoreColor(score: number): string {
  if (score >= 4)   return 'var(--gold)'
  if (score >= 2.5) return 'var(--text-3)'
  return 'var(--border-hi)'
}

// ── Rule row ──────────────────────────────────────────────────────────────────

function RuleRow({ pattern, maxCount }: { pattern: RulePattern; maxCount: number }) {
  const cfg      = TYPE_CONFIG[pattern.type]
  const barPct   = `${Math.round((pattern.fire_count / Math.max(maxCount, 1)) * 100)}%`
  const isStrong = pattern.fire_count >= 3
  const content  = RULE_CONTENT[pattern.rule_id]

  return (
    <div
      style={{
        background:   'var(--bg-card)',
        border:       '1px solid var(--border-dim)',
        borderRadius: 10,
        padding:      '16px 18px',
        transition:   'border-color 0.2s',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-mid)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-dim)')}
    >
      {/* Top row: badge + label + count */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
        <span style={{
          fontSize:      9,
          fontWeight:    700,
          letterSpacing: '0.07em',
          textTransform: 'uppercase',
          color:         cfg.color,
          background:    cfg.bg,
          border:        `1px solid ${cfg.color}30`,
          borderRadius:  4,
          padding:       '2px 7px',
          flexShrink:    0,
          marginTop:     2,
        }}>
          {cfg.label}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', flex: 1, lineHeight: 1.4 }}>
          {pattern.label}
        </span>
        <span style={{
          fontSize:           11,
          color:              isStrong ? 'var(--gold)' : 'var(--text-4)',
          fontVariantNumeric: 'tabular-nums',
          flexShrink:         0,
          paddingTop:         2,
          fontWeight:         isStrong ? 600 : 400,
        }}>
          {pattern.fire_count}×
        </span>
      </div>

      {/* Plain explanation */}
      {content ? (
        <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 12px', lineHeight: 1.65 }}>
          {content.plain}
        </p>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '0 0 12px', lineHeight: 1.65 }}>
          {pattern.description}
        </p>
      )}

      {/* Actionable insight */}
      {content && (
        <div style={{
          background:   'rgba(201,168,76,0.04)',
          border:       '1px solid var(--gold-dim)',
          borderRadius: 7,
          padding:      '9px 12px',
          marginBottom: 12,
        }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--gold)', margin: '0 0 3px', letterSpacing: '0.04em' }}>
            What to do
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0, lineHeight: 1.6 }}>
            {content.action}
          </p>
        </div>
      )}

      {/* Frequency bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          flex:         1,
          height:       3,
          background:   'var(--bg-inset)',
          borderRadius: 2,
          overflow:     'hidden',
        }}>
          <div style={{
            width:      barPct,
            height:     '100%',
            background: isStrong ? 'var(--gold)' : 'var(--border-hi)',
            borderRadius: 2,
            transition: 'width 0.5s ease',
          }} />
        </div>
        <span style={{ fontSize: 10.5, color: 'var(--text-4)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
          {freqPhrase(pattern.pct, pattern.fire_count)}
        </span>
      </div>
    </div>
  )
}

// ── Dimension row ─────────────────────────────────────────────────────────────

function DimRow({ dim, isTop, isLast }: { dim: DimPattern; isTop: boolean; isLast: boolean }) {
  const barWidth = `${Math.round((dim.avg_score / 5) * 100)}%`
  const dimInfo  = DIM_CONTENT[dim.dim]

  return (
    <div style={{
      padding:      '12px 0',
      borderBottom: isLast ? 'none' : '1px solid var(--border-dim)',
    }}>
      {/* Label + score */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <div style={{
          width:        5,
          height:       5,
          borderRadius: '50%',
          background:   isTop ? 'var(--gold)' : 'var(--border-hi)',
          flexShrink:   0,
        }} />
        <span style={{ fontSize: 13, color: isTop ? 'var(--text-1)' : 'var(--text-2)', flex: 1, fontWeight: isTop ? 500 : 400 }}>
          {dim.label}
        </span>
        <span style={{ fontSize: 11, color: scoreColor(dim.avg_score), fontVariantNumeric: 'tabular-nums', fontWeight: isTop ? 600 : 400 }}>
          {dim.avg_score.toFixed(1)}<span style={{ color: 'var(--text-4)', fontWeight: 400 }}> / 5</span>
        </span>
      </div>

      {/* What this dimension means */}
      {dimInfo && (
        <p style={{ fontSize: 11.5, color: 'var(--text-4)', margin: '0 0 7px 15px', lineHeight: 1.5, fontStyle: 'italic' }}>
          {dimInfo.meaning}
        </p>
      )}

      {/* Score bar */}
      <div style={{ height: 3, background: 'var(--bg-inset)', borderRadius: 2, overflow: 'hidden', marginBottom: 5, marginLeft: 15 }}>
        <div style={{
          width:      barWidth,
          height:     '100%',
          background: scoreColor(dim.avg_score),
          borderRadius: 2,
          transition: 'width 0.6s ease',
        }} />
      </div>

      {/* Plain score label */}
      <p style={{ fontSize: 11, color: scoreColor(dim.avg_score), margin: '0 0 0 15px', lineHeight: 1.5, fontWeight: 500 }}>
        {scoreLabel(dim.avg_score)}
      </p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PatternStore({ authToken }: { authToken: string }) {
  const [data,    setData]    = useState<PatternStoreData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    const fetchPatterns = async () => {
      try {
        const res = await fetch('/api/mirror/patterns', {
          headers: { Authorization: `Bearer ${authToken}` },
        })
        if (!res.ok) throw new Error(`${res.status}`)
        const json = await res.json() as PatternStoreData
        setData(json)
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    }
    if (authToken) fetchPatterns()
  }, [authToken])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0', color: 'var(--text-4)', fontSize: 12 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)', animation: 'blink 1.5s ease-in-out infinite' }} />
        Loading patterns…
      </div>
    )
  }

  if (error || !data) {
    return <p style={{ fontSize: 12, color: 'var(--text-4)', margin: 0 }}>Could not load your patterns. Try refreshing.</p>
  }

  if (!data.threshold_met) {
    const needed = 3 - data.session_count
    return (
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: 10, padding: '18px 20px' }}>
        <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 8px', fontWeight: 500 }}>
          {needed} more decision{needed !== 1 ? 's' : ''} needed before patterns appear.
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-4)', margin: 0, lineHeight: 1.6 }}>
          Quorum spots patterns from how your decisions are set up — not what you say about yourself.
          It takes a few sessions before anything reliably repeating becomes visible.
        </p>
      </div>
    )
  }

  if (data.patterns.length === 0) {
    return (
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: 10, padding: '18px 20px' }}>
        <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 8px', fontWeight: 500 }}>No repeating patterns yet.</p>
        <p style={{ fontSize: 12, color: 'var(--text-4)', margin: 0, lineHeight: 1.6 }}>
          Your decisions so far have each been structurally different — no single pattern has come up more than once. Keep running sessions.
        </p>
      </div>
    )
  }

  const maxCount     = data.patterns[0].fire_count
  const headline     = computeHeadline(data.patterns, data.sessions_with_rules)
  const dimSynthesis = computeDimSynthesis(data.top_dimensions)

  return (
    <div>

      {/* ── Computed headline ────────────────────────────────────────────── */}
      {headline && (
        <div style={{
          background:   'var(--bg-card)',
          border:       '1px solid var(--border-mid)',
          borderLeft:   '3px solid var(--gold)',
          borderRadius: 10,
          padding:      '16px 18px',
          marginBottom: 24,
        }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--gold)', margin: '0 0 8px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            The pattern across your decisions
          </p>
          <p style={{ fontSize: 13.5, color: 'var(--text-1)', margin: 0, lineHeight: 1.7 }}>
            {headline}
          </p>
        </div>
      )}

      {/* ── Section 1: Structural triggers ──────────────────────────────── */}
      <div style={{ marginBottom: data.top_dimensions.length > 0 ? 32 : 0 }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-4)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            What keeps coming up
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-4)', fontVariantNumeric: 'tabular-nums' }}>
            {data.sessions_with_rules} session{data.sessions_with_rules !== 1 ? 's' : ''}
          </span>
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: '0 0 12px', lineHeight: 1.65 }}>
          These signals appear in how your decisions are set up — before you get to analysis.
          Each one comes with a plain read of what it means and one thing you can do differently next time.
        </p>

        {/* Badge legend */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 16 }}>
          {(Object.entries(TYPE_CONFIG) as [RuleType, typeof TYPE_CONFIG[RuleType]][]).map(([, cfg]) => (
            <span key={cfg.label} style={{
              fontSize: 9.5, color: cfg.color, background: cfg.bg,
              border: `1px solid ${cfg.color}30`, borderRadius: 4,
              padding: '2px 7px', fontWeight: 700, letterSpacing: '0.05em',
            }}>
              {cfg.label}
            </span>
          ))}
          <span style={{ fontSize: 10.5, color: 'var(--text-4)' }}>— what kind of signal each is</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data.patterns.map(pattern => (
            <RuleRow key={pattern.rule_id} pattern={pattern} maxCount={maxCount} />
          ))}
        </div>
      </div>

      {/* ── Section 2: What your decisions are made of ───────────────────── */}
      {data.top_dimensions.length > 0 && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: 10, padding: '18px 20px' }}>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-4)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              What your decisions are made of
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-4)' }}>Top {data.top_dimensions.length}</span>
          </div>

          <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: '0 0 4px', lineHeight: 1.65 }}>
            Each decision you bring here is quietly rated across a set of qualities.
            These are the ones that score highest across your decisions — consistently.
            They tell you what kind of choices you're actually making, as opposed to how you might describe them to yourself.
          </p>

          {/* Dimension synthesis if all top scores are high */}
          {dimSynthesis && (
            <div style={{
              background:   'rgba(201,168,76,0.04)',
              border:       '1px solid var(--gold-dim)',
              borderRadius: 7,
              padding:      '10px 13px',
              margin:       '12px 0 4px',
            }}>
              <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: 0, lineHeight: 1.65 }}>
                {dimSynthesis}
              </p>
            </div>
          )}

          <div style={{ marginTop: 8 }}>
            {data.top_dimensions.map((dim, i) => (
              <DimRow
                key={dim.dim}
                dim={dim}
                isTop={i < 3}
                isLast={i === data.top_dimensions.length - 1}
              />
            ))}
          </div>

          <p style={{ fontSize: 10.5, color: 'var(--text-4)', margin: '14px 0 0', lineHeight: 1.5, fontStyle: 'italic' }}>
            Based on {data.sessions_with_vectors} session{data.sessions_with_vectors !== 1 ? 's' : ''}.
            These averages sharpen as you run more decisions.
          </p>
        </div>
      )}
    </div>
  )
}
