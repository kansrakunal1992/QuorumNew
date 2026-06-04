'use client'
// components/MonthlyJudgmentReview.tsx
// ── Mirror: Monthly Judgment Review (Chunk 2) ─────────────────────────────────
//
// Shows a rolling 30-day (or all-time for early users) snapshot of loop closure.
// Four metric tiles + open loops list. Matches existing Mirror module design.
//
// Silently returns null while loading or on fetch error — non-blocking.
// Returns null when decisions_total = 0 (nothing to show yet).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react'
import type { MonthlyReviewData, OpenLoop } from '@/app/api/mirror/monthly-review/route'

interface Props {
  authToken: string
}

// ── Metric tile ───────────────────────────────────────────────────────────────
function MetricTile({
  label,
  value,
  sub,
  highlight,
}: {
  label:     string
  value:     string | number
  sub?:      string
  highlight?: boolean
}) {
  return (
    <div style={{
      background:   'var(--bg-card)',
      border:       `1px solid ${highlight ? 'var(--gold-dim)' : 'var(--border-dim)'}`,
      borderRadius: 10,
      padding:      '14px 16px',
      textAlign:    'center',
    }}>
      <div style={{
        fontSize:   22,
        fontWeight: 700,
        color:      highlight ? 'var(--gold)' : 'var(--text-1)',
        marginBottom: 4,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </div>
      <div style={{
        fontSize:      10,
        color:         'var(--text-4)',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        lineHeight:    1.4,
      }}>
        {label}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  )
}

// ── Open loop row ─────────────────────────────────────────────────────────────
function OpenLoopRow({ loop }: { loop: OpenLoop }) {
  const isOverdue = loop.days_overdue !== null

  return (
    <a
      href={`/session/${loop.session_id}`}
      style={{
        display:        'block',
        padding:        '12px 16px',
        borderBottom:   '1px solid var(--border-dim)',
        textDecoration: 'none',
        transition:     'background 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-inset)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <p style={{
          fontSize:   13,
          color:      'var(--text-2)',
          margin:     0,
          lineHeight: 1.45,
          flex:       1,
        }}>
          {loop.decision_text || 'Untitled decision'}
        </p>
        <span style={{
          flexShrink:    0,
          fontSize:      10,
          padding:       '3px 10px',
          borderRadius:  20,
          fontFamily:    'var(--font-mono)',
          letterSpacing: '0.04em',
          whiteSpace:    'nowrap',
          background:    isOverdue ? 'rgba(224,80,80,0.08)' : 'var(--bg-inset)',
          border:        `1px solid ${isOverdue ? 'rgba(224,80,80,0.3)' : 'var(--border-dim)'}`,
          color:         isOverdue ? '#e05050'              : 'var(--text-4)',
        }}>
          {isOverdue
            ? `${loop.days_overdue}d overdue`
            : `${loop.days_open}d open`
          }
        </span>
      </div>
      {loop.review_date && (
        <p style={{ fontSize: 11, color: 'var(--text-4)', margin: '4px 0 0', fontStyle: 'italic' }}>
          Review date: {new Date(loop.review_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </p>
      )}
    </a>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function MonthlyJudgmentReview({ authToken }: Props) {
  const [data,    setData]    = useState<MonthlyReviewData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!authToken) { setLoading(false); return }

    fetch('/api/mirror/monthly-review', {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => setData(d as MonthlyReviewData ?? null))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [authToken])

  if (loading || !data || data.decisions_total === 0) return null

  const windowLabel = data.window === 'last_30_days' ? 'Last 30 days' : 'All time'
  const loopPct     = data.loops_closed_pct

  // Colour the loop closure % by health threshold
  const loopColor = loopPct >= 60
    ? 'var(--gold)'
    : loopPct >= 30
      ? 'var(--text-2)'
      : '#e05050'

  return (
    <div style={{ marginBottom: 28 }}>

      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h3
          className="mirror-section-h3"
          style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}
        >
          Loop Closure
        </h3>
        <span style={{ fontSize: 10, color: 'var(--text-4)' }}>
          {windowLabel}
        </span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-4)', margin: '0 0 14px', lineHeight: 1.55 }}>
        Of the decisions you&apos;ve recorded, how many loops have you closed — returned to, assessed the outcome, and moved on from.
      </p>

      {/* ── 4 metric tiles ─────────────────────────────────────────────────── */}
      <div style={{
        display:             'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap:                 10,
        marginBottom:        data.open_loops.length > 0 ? 16 : 0,
      }}
        className="mjr-grid"
      >
        <MetricTile
          label="Decisions recorded"
          value={data.decisions_total}
        />
        <MetricTile
          label="Loops closed"
          value={`${loopPct}%`}
          sub={`${data.loops_closed} of ${data.decisions_total}`}
          highlight={loopPct >= 60}
        />
        <MetricTile
          label="Rules applied"
          value={data.rule_recall_applied}
        />
        <MetricTile
          label="Patterns confirmed"
          value={data.confirmed_patterns}
        />
      </div>

      {/* ── Open loops list ─────────────────────────────────────────────────── */}
      {data.open_loops.length > 0 && (
        <div style={{
          background:   'var(--bg-card)',
          border:       '1px solid var(--border-dim)',
          borderRadius: 10,
          overflow:     'hidden',
        }}>

          <div style={{
            padding:      '12px 16px 10px',
            borderBottom: '1px solid var(--border-dim)',
            display:      'flex',
            alignItems:   'center',
            justifyContent: 'space-between',
          }}>
            <span style={{
              fontSize:      10,
              fontWeight:    700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color:         'var(--text-4)',
            }}>
              Open loops
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-4)', fontVariantNumeric: 'tabular-nums' }}>
              {data.open_loops.length} decision{data.open_loops.length !== 1 ? 's' : ''} awaiting closure
            </span>
          </div>

          {data.open_loops.map(loop => (
            <OpenLoopRow key={loop.session_id} loop={loop} />
          ))}
        </div>
      )}

      {/* Empty state for open loops */}
      {data.open_loops.length === 0 && data.decisions_total > 0 && (
        <div style={{
          background:   'var(--bg-card)',
          border:       '1px solid var(--border-dim)',
          borderRadius: 10,
          padding:      '16px 18px',
          textAlign:    'center',
        }}>
          <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: 0 }}>
            No open loops. All recorded decisions have outcomes filed or are within their review window.
          </p>
        </div>
      )}

      {/* Inline responsive style for the 4-col grid */}
      <style>{`
        @media (max-width: 600px) {
          .mjr-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
    </div>
  )
}
