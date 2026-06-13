'use client'
// components/SessionReliabilityIndex.tsx
// ── R4: Session Reliability Index — Mirror module ─────────────────────────────
//
// Renders as a section in Mirror UnlockedView (after Confidence Calibration,
// before Peer Benchmark). Fetches from GET /api/mirror/session-score.
//
// Layout:
//   — Section header + sub-label
//   — Summary row: average score + trend delta over last 5 sessions
//   — Per-session list (last 10): decision preview | composite score bar |
//     four sub-score dots (structural / bias / council / calibration)
//   — Action plan callout: always present — targets weakest avg sub-score
//     across all sessions with a specific, non-generic improvement action.
//
// Sub-score dot colours:
//   ≥ 75  → var(--accent-pattern)  (teal-ish — good)
//   50–74 → var(--gold-dim)        (gold — caution)
//   < 50  → rgba(220,80,80,0.7)   (muted red — needs work)
//
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'
import type { SessionScoreData, MirrorTier } from '@/lib/types'
import { formatDate } from '@/lib/dates'
import AdvisoryUpsellCard from '@/components/AdvisoryUpsellCard'
import { ADVISORY_UPSELL_COPY } from '@/lib/mirror-tier-config'

// ── Sub-score dot ─────────────────────────────────────────────────────────────

const DOT_LABELS: Record<string, string> = {
  structural:        'Structural',
  biasClarity:       'Bias',
  councilConfidence: 'Council',
  calibration:       'Calibration',
}

function subScoreColor(score: number): string {
  if (score >= 75) return 'var(--accent-pattern)'
  if (score >= 50) return 'var(--gold-dim)'
  return 'rgba(220,80,80,0.72)'
}

function SubScoreDot({ label, score }: { label: string; score: number }) {
  const [hovered, setHovered] = useState(false)
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'default' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span
        style={{
          width:  10,
          height: 10,
          borderRadius: '50%',
          background: subScoreColor(score),
          display: 'block',
          flexShrink: 0,
        }}
      />
      {hovered && (
        <span style={{
          position: 'absolute',
          bottom: '100%',
          left:   '50%',
          transform: 'translateX(-50%)',
          marginBottom: 6,
          background: 'var(--bg-card-alt)',
          border:     '1px solid var(--border-dim)',
          borderRadius: 6,
          padding:    '4px 8px',
          fontSize:   11,
          color:      'var(--text-2)',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          zIndex: 10,
        }}>
          {label}: {score}/100
        </span>
      )}
    </span>
  )
}

// ── Score bar ─────────────────────────────────────────────────────────────────

function ScoreBar({ score }: { score: number }) {
  const color =
    score >= 75 ? 'var(--accent-pattern)' :
    score >= 50 ? 'var(--gold-dim)' :
    'rgba(220,80,80,0.72)'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      <div style={{
        width: 64, height: 4, borderRadius: 2,
        background: 'var(--border-dim)',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${score}%`, height: '100%',
          background: color, borderRadius: 2,
          transition: 'width 0.5s ease',
        }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 28, textAlign: 'right' }}>
        {score}
      </span>
    </div>
  )
}

// ── Session row ───────────────────────────────────────────────────────────────

function SessionRow({ row, isLatest }: { row: SessionScoreData; isLatest?: boolean }) {
  const preview = row.decisionPreview.length >= 90
    ? row.decisionPreview + '…'
    : row.decisionPreview

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr auto auto',
      alignItems: 'center',
      gap: 12,
      padding: '10px 0',
      borderBottom: '1px solid var(--border-dim)',
      // Sprint M4: highlight the most recent session
      borderLeft:   isLatest ? '2px solid rgba(201,168,76,0.5)' : '2px solid transparent',
      paddingLeft:  isLatest ? 8 : 0,
    }}>
      {/* Decision preview + date */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          {isLatest && (
            <span style={{
              fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
              color: 'var(--gold)', background: 'rgba(201,168,76,0.1)',
              border: '1px solid rgba(201,168,76,0.25)', borderRadius: 3, padding: '1px 5px', flexShrink: 0,
            }}>Latest</span>
          )}
        </div>
        <p style={{
          margin: 0, fontSize: 12, color: 'var(--text-2)',
          lineHeight: 1.45, overflow: 'hidden',
          display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}>
          {preview}
        </p>
        <span style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 2, display: 'block' }}>
          {formatDate(row.createdAt)}
        </span>
      </div>

      {/* Sub-score dots */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
        <SubScoreDot label={DOT_LABELS.structural}        score={row.structural} />
        <SubScoreDot label={DOT_LABELS.biasClarity}       score={row.biasClarity} />
        <SubScoreDot label={DOT_LABELS.councilConfidence} score={row.councilConfidence} />
        <SubScoreDot label={DOT_LABELS.calibration}       score={row.calibration} />
      </div>

      {/* Composite score + bar */}
      <ScoreBar score={row.score} />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SessionReliabilityIndex({ authToken, tier }: { authToken: string; tier: MirrorTier }) {
  const [scores,  setScores]  = useState<SessionScoreData[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    if (!authToken) return
    fetch('/api/mirror/session-score', {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => {
        setScores(data.scores ?? [])
        setLoading(false)
      })
      .catch(() => {
        setError(true)
        setLoading(false)
      })
  }, [authToken])

  // ── Loading state ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: '20px 0', color: 'var(--text-4)', fontSize: 12 }}>
        Computing session scores…
      </div>
    )
  }

  // ── Error / empty ────────────────────────────────────────────────────────
  if (error || !scores || scores.length === 0) return null

  // ── Derived stats ────────────────────────────────────────────────────────
  const displayed     = scores.slice(0, 10)
  const avg           = Math.round(scores.reduce((s, r) => s + r.score, 0) / scores.length)

  // Trend: avg of most-recent 5 vs prior 5
  const recent5       = scores.slice(0, 5)
  const prior5        = scores.slice(5, 10)
  const avgRecent     = recent5.length > 0
    ? Math.round(recent5.reduce((s, r) => s + r.score, 0) / recent5.length) : avg
  const avgPrior      = prior5.length >= 3
    ? Math.round(prior5.reduce((s, r) => s + r.score, 0) / prior5.length)  : null

  const trendDelta    = avgPrior !== null ? avgRecent - avgPrior : null
  const trendLabel    =
    trendDelta === null       ? null :
    trendDelta >  3           ? `↑ ${trendDelta} pts` :
    trendDelta < -3           ? `↓ ${Math.abs(trendDelta)} pts` :
    '→ stable'

  const trendColor    =
    trendDelta === null       ? 'var(--text-4)' :
    trendDelta >  3           ? 'var(--accent-pattern)' :
    trendDelta < -3           ? 'rgba(220,80,80,0.8)' :
    'var(--text-3)'

  // Global action plan — from first row (same value on all rows — set in lib/session-score.ts)
  const actionPlan = scores[0]?.actionPlan ?? null

  return (
    <div>
      {/* Summary row */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 32, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1 }}>
          {avg}
        </span>
        <span style={{ fontSize: 13, color: 'var(--text-3)' }}>/ 100 avg</span>
        {trendLabel && (
          <span style={{ fontSize: 12, fontWeight: 600, color: trendColor, marginLeft: 4 }}>
            {trendLabel} over last 5 sessions
          </span>
        )}
      </div>

      {/* Sub-score legend */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 14 }}>
        {Object.entries(DOT_LABELS).map(([key, label]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--text-3)', display: 'block', flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: 'var(--text-4)', letterSpacing: '0.04em' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Session list */}
      <div>
        {displayed.map((row, i) => (
          <SessionRow key={row.sessionId} row={row} isLatest={i === 0} />
        ))}
      </div>

      {/* Action plan callout — Mirror Advisory only (Phase 5) */}
      {tier === 'advisory' ? (
        actionPlan && (
          <div style={{
            marginTop: 20,
            padding: '14px 16px',
            background: 'var(--bg-card-alt)',
            border: '1px solid var(--border-dim)',
            borderLeft: '3px solid var(--gold-dim)',
            borderRadius: 8,
          }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
              Your next move
            </p>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
              {actionPlan}
            </p>
          </div>
        )
      ) : (
        <div style={{ marginTop: 20 }}>
          <AdvisoryUpsellCard {...ADVISORY_UPSELL_COPY.sriNextMove} />
        </div>
      )}

      {/* Interpretive note */}
      <p style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 14, lineHeight: 1.55 }}>
        Dot colours: <span style={{ color: 'var(--accent-pattern)' }}>●</span> strong &nbsp;
        <span style={{ color: 'var(--gold-dim)' }}>●</span> moderate &nbsp;
        <span style={{ color: 'rgba(220,80,80,0.72)' }}>●</span> needs work.
        Hover any dot for the exact sub-score. A rising index means your decisions are entering analysis with cleaner information, fewer active distortions, and clearer structural conditions.
      </p>
    </div>
  )
}
