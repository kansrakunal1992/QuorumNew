'use client'

// components/IndependenceScore.tsx
// ── Mirror Module: Decision Independence Score Display (Sprint 7c) ────────────
//
// Shows the user's current independence score, delta, and a one-sentence
// interpretation of what the score means.
//
// States:
//   loading   → skeleton pulse
//   null      → empty state: no sessions scored yet, CTA to run a decision
//   scored    → number + delta + band interpretation + session count
//   error     → graceful fallback, does not break page
//
// Design rules (from handover):
//   - Number centered, large (52px), gold
//   - Delta: ↑ green / → muted / ↓ muted-red
//   - One-sentence band interpretation in italic
//   - "Based on N sessions" muted footer
//   - No progress bar, no gauge, no streaks
//   - Explanation of what the score measures below the card (first-time context)
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'
import { formatShortDate } from '@/lib/dates'

interface ScoreData {
  score:          number | null
  delta:          number | null
  band:           string | null
  interpretation: string | null
  sessionCount:   number
  calculatedAt:   string | null
  examinerQuote:  string | null
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function ScoreSkeleton() {
  return (
    <>
      <style>{`
        @keyframes is-pulse {
          0%, 100% { opacity: 0.2; }
          50%       { opacity: 0.5; }
        }
      `}</style>
      <div style={{
        background:   'var(--bg-card)',
        border:       '1px solid var(--border-dim)',
        borderRadius: 12,
        padding:      '28px 24px',
        display:      'flex',
        flexDirection:'column',
        alignItems:   'center',
        gap:          12,
      }}>
        {/* Number placeholder */}
        <div style={{
          width: 80, height: 52,
          background:   'var(--border-dim)',
          borderRadius: 8,
          animation:    'is-pulse 1.8s ease-in-out infinite',
        }} />
        {/* Delta placeholder */}
        <div style={{
          width: 120, height: 14,
          background:   'var(--border-dim)',
          borderRadius: 4,
          animation:    'is-pulse 1.8s ease-in-out infinite 0.2s',
        }} />
        {/* Interpretation placeholder */}
        <div style={{
          width: '80%', height: 14,
          background:   'var(--border-dim)',
          borderRadius: 4,
          animation:    'is-pulse 1.8s ease-in-out infinite 0.4s',
        }} />
      </div>
    </>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div style={{
      background:   'var(--bg-card)',
      border:       '1px solid var(--border-dim)',
      borderRadius: 12,
      padding:      '22px 22px',
    }}>
      <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: '0 0 12px', lineHeight: 1.65 }}>
        Your independence score starts calculating once you've completed the Examiner
        phase in at least one session. It tracks whether Quorum's reasoning frameworks
        are showing up in your own thinking — unprompted.
      </p>
      <a
        href="/"
        style={{
          display:        'inline-flex',
          alignItems:     'center',
          gap:            5,
          fontSize:       12.5,
          color:          'var(--gold)',
          fontWeight:     600,
          textDecoration: 'none',
        }}
        onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.opacity = '0.75')}
        onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.opacity = '1')}
      >
        Run a decision →
      </a>
    </div>
  )
}

// ── Delta display ─────────────────────────────────────────────────────────────

function DeltaLabel({ delta }: { delta: number | null }) {
  if (delta === null) {
    return (
      <span style={{ fontSize: 11, color: 'var(--text-4)', fontStyle: 'italic' }}>
        First session — baseline set
      </span>
    )
  }

  if (delta === 0) {
    return (
      <span style={{ fontSize: 12, color: 'var(--text-4)' }}>
        → No change from previous sessions
      </span>
    )
  }

  const positive = delta > 0
  const color     = positive ? '#4ade80' : 'var(--text-3)'
  const arrow     = positive ? '↑' : '↓'

  return (
    <span style={{ fontSize: 12, color, fontWeight: 600 }}>
      {arrow} {positive ? '+' : ''}{delta} from previous sessions
    </span>
  )
}

// ── Score display ─────────────────────────────────────────────────────────────

function ScoreDisplay({ data }: { data: ScoreData }) {
  const score = data.score!

  // Visual fill: arc or simple ring — keeping it just the number per design spec
  return (
    <div style={{
      background:    'linear-gradient(160deg, rgba(201,168,76,0.03) 0%, var(--bg-card) 50%)',
      border:        '1px solid var(--border-mid)',
      borderRadius:  12,
      padding:       '28px 24px 20px',
      position:      'relative',
      overflow:      'hidden',
      textAlign:     'center',
      boxShadow:     '0 2px 12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(201,168,76,0.06)',
    }}>
      {/* Subtle top accent */}
      <div style={{
        position:  'absolute',
        top: 0, left: 0,
        width:     '100%',
        height:    2,
        background:'linear-gradient(90deg, var(--gold-dim) 0%, transparent 60%)',
      }} />

      {/* Score number with radial glow */}
      <div style={{ position: 'relative', display: 'inline-block', marginBottom: 6 }}>
        <div style={{
          position:   'absolute',
          top: '50%', left: '50%',
          transform:  'translate(-50%, -50%)',
          width:      160,
          height:     160,
          background: 'radial-gradient(ellipse at center, rgba(201,168,76,0.11) 0%, transparent 70%)',
          borderRadius: '50%',
          pointerEvents: 'none',
        }} />
        <div style={{
          fontSize:   52,
          fontWeight: 700,
          color:      'var(--gold)',
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.02em',
          position:   'relative',
        }}>
          {score}
          <span style={{ fontSize: 18, color: 'var(--text-4)', fontWeight: 400 }}>/100</span>
        </div>
      </div>

      {/* Delta */}
      <div style={{ marginBottom: 12 }}>
        <DeltaLabel delta={data.delta} />
      </div>

      {/* Band interpretation */}
      {data.interpretation && (
        <p style={{
          fontSize:   13,
          color:      'var(--text-2)',
          lineHeight: 1.6,
          margin:     '0 0 14px',
          fontStyle:  'italic',
          maxWidth:   380,
          marginLeft: 'auto',
          marginRight:'auto',
        }}>
          "{data.interpretation}"
        </p>
      )}

      {/* Band label */}
      {data.band && (
        <div style={{
          display:        'inline-block',
          background:     'rgba(201,168,76,0.07)',
          border:         '1px solid var(--gold-dim)',
          borderRadius:   20,
          padding:        '3px 12px',
          fontSize:       10.5,
          fontWeight:     600,
          color:          'var(--gold)',
          letterSpacing:  '0.06em',
          textTransform:  'uppercase',
          marginBottom:   14,
        }}>
          {data.band}
        </div>
      )}

      {/* Examiner quote — from the most recent scored session */}
      {data.examinerQuote && (
        <div style={{
          borderLeft:   '2px solid var(--gold-dim)',
          paddingLeft:  12,
          marginBottom: 14,
          textAlign:    'left',
        }}>
          <p style={{
            fontSize:   11.5,
            color:      'var(--text-3)',
            lineHeight: 1.6,
            margin:     0,
            fontStyle:  'italic',
          }}>
            "{data.examinerQuote}"
          </p>
          <span style={{
            fontSize:      10,
            color:         'var(--text-4)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            fontStyle:     'normal',
            marginTop:     4,
            display:       'block',
          }}>
            From your last Examiner session
          </span>
        </div>
      )}

      {/* Coaching tip — what to do differently to raise the score */}
      <CoachingTip band={data.band} />

      {/* Session count */}
      <div style={{ fontSize: 10, color: 'var(--text-4)', fontVariantNumeric: 'tabular-nums' }}>
        Based on {data.sessionCount} session{data.sessionCount !== 1 ? 's' : ''}
        {data.calculatedAt && (
          <> · Last updated {formatShortDate(data.calculatedAt)}</>
        )}
      </div>
    </div>
  )
}

// ── Coaching tip (shown inside the card, below examiner quote) ───────────────
// Static per band — abstracts the signal logic into plain language.
// Not shown for 'Judgment compounding' (score ≥ 75).

const COACHING: Record<string, { tip: string; example: string }> = {
  'Using Quorum as a report generator': {
    tip:     'Name one thing that could go wrong, and one person this decision affects beyond yourself. Even a sentence on each shifts how your thinking is read.',
    example: 'e.g. "If this doesn\'t land, my co-founder carries the reputational cost too — and I haven\'t thought through what walking it back would look like."',
  },
  'Frameworks starting to appear': {
    tip:     'Question whether the timeline is real. Ask what you\'d regret looking back in two years. These patterns — when they appear in your Examiner answers — move the score.',
    example: 'e.g. "I\'m not sure the Q3 deadline is a hard constraint — it was set internally. If it\'s flexible, the whole framing changes."',
  },
  'Reasoning visibly shifting': {
    tip:     'Connect this decision to a past one. Name a pattern you\'ve noticed in your own thinking before. Cross-session awareness is what pushes the score above 75.',
    example: 'e.g. "This feels like the expansion decision last year — I notice I anchor on upside and underweight operational drag. Same pull here."',
  },
}

function CoachingTip({ band }: { band: string | null }) {
  if (!band || !COACHING[band]) return null
  const { tip, example } = COACHING[band]
  return (
    <div style={{
      borderLeft:   '2px solid var(--border-mid)',
      paddingLeft:  12,
      marginBottom: 14,
      textAlign:    'left',
    }}>
      <p style={{
        fontSize:      9.5,
        fontWeight:    700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color:         'var(--text-4)',
        margin:        '0 0 5px',
      }}>
        What raises your score
      </p>
      <p style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.6, margin: '0 0 6px' }}>
        {tip}
      </p>
      <p style={{ fontSize: 11, color: 'var(--text-4)', lineHeight: 1.55, margin: 0, fontStyle: 'italic' }}>
        {example}
      </p>
    </div>
  )
}

// ── Explanation (shown below the card) ───────────────────────────────────────

function ScoreExplanation() {
  return (
    <p style={{
      fontSize:   11.5,
      color:      'var(--text-4)',
      lineHeight: 1.65,
      margin:     '12px 0 0',
    }}>
      This score tracks whether you're asking better questions — surfacing stakeholders,
      questioning constraints, naming worst cases — before any AI analysis begins.
      It rises when those habits show up in your Examiner answers unprompted.
      At 75+, the frameworks have become yours.
    </p>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  authToken: string
}

export default function IndependenceScore({ authToken }: Props) {
  const [data,    setData]    = useState<ScoreData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    let cancelled = false

    const fetchScore = async () => {
      try {
        const res = await fetch('/api/mirror/independence', {
          headers: { Authorization: `Bearer ${authToken}` },
        })

        if (!res.ok) {
          setError(true)
          return
        }

        const json = await res.json() as ScoreData
        if (!cancelled) setData(json)
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchScore()
    return () => { cancelled = true }
  }, [authToken])

  if (loading) return <ScoreSkeleton />

  if (error) {
    return (
      <div style={{
        background:   'var(--bg-card)',
        border:       '1px solid var(--border-dim)',
        borderRadius: 12,
        padding:      '18px 20px',
      }}>
        <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: 0, lineHeight: 1.6 }}>
          Score temporarily unavailable. Your data is intact — try refreshing in a moment.
        </p>
      </div>
    )
  }

  if (!data || data.score === null) {
    return (
      <>
        <EmptyState />
        <ScoreExplanation />
      </>
    )
  }

  return (
    <>
      <ScoreDisplay data={data} />
      <ScoreExplanation />
    </>
  )
}
