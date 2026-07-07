'use client'

// components/MirrorSummaryCard.tsx
// ── Sprint M1: Mirror Summary Card — above-fold digest ────────────────────────
//
// Sits at the very top of UnlockedView on every visit after the one-time
// WelcomeMirrorCard (Sprint M3) has been dismissed.
//
// Answers "what do I need to know right now?" in a single glance before
// the user scrolls any of the 12 modules below:
//
//   ◆ Since [date]: <delta line>           — what changed since last visit
//   [ score + delta ] [ patterns ] [ loops ] [ sessions ]   — 4-stat grid
//   Next move: <actionPlan>                — SRI weakest-sub-score action
//   In your own words: "<examinerQuote>"  — user's own Examiner words
//
// Fetches from /api/mirror/summary (new route, Sprint M1).
// Side-effect of that GET: updates user_preferences.last_mirror_viewed_at
// so the NEXT visit correctly computes the "since last visit" delta line.
//
// DB migration required (run once before deploying):
//   ALTER TABLE user_preferences
//   ADD COLUMN IF NOT EXISTS last_mirror_viewed_at TIMESTAMPTZ;
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────
// Exported so AttentionZone and MirrorInsightCard can share the same shape.

export interface SummaryData {
  independenceScore:     number | null
  scoreDelta:            number | null
  examinerQuote:         string | null
  confirmedPatternCount: number
  formingPatternCount:   number
  openLoopCount:         number
  nextAction:            string | null
  sessionCount:          number
  sinceLastVisit:        string | null
  newContradictions:     number          // M5 — AttentionZone
  latestSessionMode:     string | null   // M6 — module prominence
}

// ── Delta arrow ───────────────────────────────────────────────────────────────

function DeltaChip({ delta }: { delta: number | null }) {
  if (delta === null || delta === 0) return null
  const up    = delta > 0
  const color = up ? 'var(--success-text, #4caf86)' : 'rgba(220,72,60,0.9)'
  return (
    <span style={{
      fontSize: 12, fontWeight: 700, color,
      marginLeft: 4, lineHeight: 1,
    }}>
      {up ? '↑' : '↓'}{up ? '+' : ''}{delta}
    </span>
  )
}

// ── Single stat cell ──────────────────────────────────────────────────────────

function StatCell({
  value,
  label,
  sub,
  gold,
}: {
  value: React.ReactNode
  label: string
  sub?:  string
  gold?: boolean
}) {
  return (
    <div style={{
      display:       'flex',
      flexDirection: 'column',
      alignItems:    'flex-start',
      padding:       '10px 14px',
      background:    gold ? 'rgba(201,168,76,0.07)' : 'var(--bg-card)',
      border:        `1px solid ${gold ? 'rgba(201,168,76,0.28)' : 'var(--border-dim)'}`,
      borderRadius:  8,
      minWidth:      0,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline' }}>
        <span style={{
          fontSize:           22,
          fontWeight:         700,
          color:              gold ? 'var(--gold)' : 'var(--text-1)',
          fontVariantNumeric: 'tabular-nums',
          lineHeight:         1,
        }}>
          {value}
        </span>
      </div>
      <span style={{
        fontSize:      10,
        color:         'var(--text-4)',
        marginTop:     4,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        lineHeight:    1.3,
      }}>
        {label}
      </span>
      {sub && (
        <span style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 2, lineHeight: 1.3 }}>
          {sub}
        </span>
      )}
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SummarySkeleton() {
  return (
    <>
      <style>{`
        @keyframes smc-pulse { 0%,100%{opacity:0.12} 50%{opacity:0.35} }
      `}</style>
      <div style={{
        background:   'rgba(201,168,76,0.03)',
        border:       '1px solid var(--gold-dim)',
        borderRadius: 12,
        padding:      '20px 22px',
        marginBottom: 28,
        position:     'relative',
        overflow:     'hidden',
      }}>
        <div style={{
          position:   'absolute', top: 0, left: 0,
          width:      '100%',    height: 2,
          background: 'linear-gradient(90deg, var(--gold-dim) 0%, transparent 60%)',
        }} />
        <div className="mirror-summary-stats" style={{
          display:             'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap:                 8,
          marginBottom:        12,
        }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{
              height:     60,
              background: 'var(--bg-card)',
              borderRadius: 8,
              animation:  `smc-pulse 1.8s ease-in-out infinite ${i * 0.15}s`,
            }} />
          ))}
        </div>
        <div style={{
          height: 40, background: 'var(--bg-card)', borderRadius: 8,
          animation: 'smc-pulse 1.8s ease-in-out infinite 0.6s',
        }} />
      </div>
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MirrorSummaryCard({ authToken, onData }: {
  authToken: string
  onData?:   (d: SummaryData) => void
}) {
  const [data,    setData]    = useState<SummaryData | null>(null)
  const [loading, setLoading] = useState(true)

  // QC fix (audit pass, July 2026): onData was called directly inside the
  // fetch effect but wasn't in its dependency array. If the parent passes a
  // new inline onData on re-render (common — it's not memoized upstream),
  // the effect would still hold the STALE onData captured at mount, since it
  // only re-runs when authToken changes. Routing through a ref (same pattern
  // used for onComplete/onPersonaComplete in PersonaPanel.tsx) always calls
  // the current onData without needing it in the effect's deps.
  const onDataRef = useRef(onData)
  useEffect(() => { onDataRef.current = onData }, [onData])

  useEffect(() => {
    if (!authToken) return
    let cancelled = false

    fetch('/api/mirror/summary', {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!cancelled) {
          const typed = d as SummaryData | null
          setData(typed)
          if (typed) onDataRef.current?.(typed)
          setLoading(false)
        }
      })
      .catch(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [authToken])

  if (loading) return <SummarySkeleton />
  if (!data)   return null   // silent fail — modules still render below

  const {
    independenceScore,
    scoreDelta,
    examinerQuote,
    confirmedPatternCount,
    formingPatternCount,
    openLoopCount,
    nextAction,
    sessionCount,
    sinceLastVisit,
  } = data

  // Pattern display: show confirmed count with forming as sub-label
  const hasConfirmed   = confirmedPatternCount > 0
  const patternValue   = hasConfirmed ? confirmedPatternCount : (formingPatternCount || '—')
  const patternLabel   = hasConfirmed ? 'patterns' : formingPatternCount > 0 ? 'forming' : 'patterns'
  const patternSub     = hasConfirmed && formingPatternCount > 0
    ? `+${formingPatternCount} forming`
    : undefined

  // Score display: "building" while still thin (null score)
  const scoreNode: React.ReactNode = independenceScore !== null
    ? (
        <span style={{ display: 'inline-flex', alignItems: 'baseline' }}>
          {independenceScore}
          <DeltaChip delta={scoreDelta} />
        </span>
      )
    : <span style={{ fontSize: 15, color: 'var(--text-4)', fontWeight: 500 }}>building</span>

  return (
    <div style={{
      background:   'rgba(201,168,76,0.03)',
      border:       '1px solid var(--gold-dim)',
      borderRadius: 12,
      padding:      '20px 22px',
      marginBottom: 28,
      position:     'relative',
      overflow:     'hidden',
    }}>
      {/* Gold top accent */}
      <div style={{
        position:   'absolute', top: 0, left: 0,
        width:      '100%',    height: 2,
        background: 'linear-gradient(90deg, var(--gold) 0%, transparent 70%)',
      }} />

      {/* "Since last visit" line — only when a delta was detected */}
      {sinceLastVisit && (
        <p style={{
          fontSize:   11,
          color:      'var(--gold)',
          margin:     '0 0 12px',
          lineHeight: 1.4,
          fontWeight: 500,
        }}>
          ◆ {sinceLastVisit}
        </p>
      )}

      {/* 4-stat grid */}
      <div
        className="mirror-summary-stats"
        style={{
          display:             'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap:                 8,
          marginBottom:        nextAction || examinerQuote ? 12 : 0,
        }}
      >
        <StatCell
          value={scoreNode}
          label="independence"
          gold={independenceScore !== null}
        />
        <StatCell
          value={patternValue}
          label={patternLabel}
          sub={patternSub}
        />
        <StatCell
          value={openLoopCount > 0 ? openLoopCount : '—'}
          label="open loops"
          gold={openLoopCount > 0}
        />
        <StatCell
          value={sessionCount}
          label="decisions"
        />
      </div>

      {/* Next action — sourced from SRI weakest sub-score actionPlan */}
      {nextAction && (
        <div style={{
          background:   'var(--bg-card)',
          border:       '1px solid var(--border-dim)',
          borderRadius: 8,
          padding:      '10px 14px',
          marginBottom: examinerQuote ? 10 : 0,
          display:      'flex',
          alignItems:   'flex-start',
          gap:          10,
        }}>
          <span style={{
            fontSize:      9,
            fontWeight:    700,
            color:         'var(--gold)',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            whiteSpace:    'nowrap',
            marginTop:     2,
            flexShrink:    0,
          }}>
            Next move
          </span>
          <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: 0, lineHeight: 1.55 }}>
            {nextAction}
          </p>
        </div>
      )}

      {/* Examiner quote — user's own words, most personal element on the page */}
      {examinerQuote && (
        <div style={{
          paddingTop: nextAction ? 10 : 4,
          borderTop:  nextAction ? '1px solid var(--border-dim)' : 'none',
          marginTop:  nextAction ? 0 : 4,
        }}>
          <p style={{
            fontSize:      10,
            color:         'var(--text-4)',
            fontWeight:    700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            margin:        '0 0 5px',
          }}>
            In your own words
          </p>
          <p style={{
            fontSize:    12.5,
            color:       'var(--text-3)',
            margin:      0,
            lineHeight:  1.55,
            fontStyle:   'italic',
            paddingLeft: 10,
            borderLeft:  '2px solid rgba(201,168,76,0.2)',
          }}>
            &ldquo;{examinerQuote}&rdquo;
          </p>
        </div>
      )}
    </div>
  )
}
