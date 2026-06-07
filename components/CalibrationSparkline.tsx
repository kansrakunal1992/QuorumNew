'use client'

import { formatShortDate } from '@/lib/dates'

// components/CalibrationSparkline.tsx
// ── Mirror: Calibration Sparkline (Sprint 15) ─────────────────────────────────
//
// Renders the user's pre-decision vs. retrospective confidence over time.
//
// Three visual layers:
//   1. Summary card — avg delta with colour-coding + trend label + pattern text
//   2. Dual-line SVG sparkline — pre confidence (muted) vs retro confidence (gold)
//   3. Delta bar row — per-session delta as signed bars (+green / -red)
//
// Data threshold: needs >= 3 paired points to render chart. Below that,
// renders a progress state explaining what will appear.
//
// Auth: receives authToken prop (same pattern as BiasFingerprint, IndependenceScore).
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'
import type { CalibrationPoint, CalibrationSummary, CalibrationResponse } from '@/app/api/mirror/calibration/route'

// ── Helpers ───────────────────────────────────────────────────────────────────

const CHART_W = 580
const CHART_H = 120
const PAD     = { top: 12, right: 16, bottom: 24, left: 32 }
const MIN_CONF = 1
const MAX_CONF = 10

function confToY(value: number): number {
  const range = MAX_CONF - MIN_CONF
  return PAD.top + ((MAX_CONF - value) / range) * (CHART_H - PAD.top - PAD.bottom)
}

function indexToX(i: number, total: number): number {
  const inner = CHART_W - PAD.left - PAD.right
  if (total <= 1) return PAD.left + inner / 2
  return PAD.left + (i / (total - 1)) * inner
}

function polylinePoints(values: (number | null)[], total: number): string {
  return values
    .map((v, i) => v !== null ? `${indexToX(i, total)},${confToY(v)}` : null)
    .filter(Boolean)
    .join(' ')
}

function deltaColor(delta: number | null): string {
  if (delta === null) return 'var(--border-mid)'
  if (delta > 0)      return '#4ade80'
  if (delta < 0)      return '#f87171'
  return 'var(--border-hi)'
}

function avgDeltaColor(delta: number | null): string {
  if (delta === null)       return 'var(--text-4)'
  if (delta > 1)            return '#4ade80'
  if (delta < -1)           return '#f87171'
  return 'var(--gold)'
}

function trendLabel(trend: CalibrationSummary['trend']): string {
  switch (trend) {
    case 'improving':         return '↑ Improving'
    case 'declining':         return '↓ Declining'
    case 'stable':            return '→ Stable'
    case 'insufficient_data': return '—'
  }
}

function trendColor(trend: CalibrationSummary['trend']): string {
  switch (trend) {
    case 'improving':         return '#4ade80'
    case 'declining':         return '#f87171'
    case 'stable':            return 'var(--gold)'
    case 'insufficient_data': return 'var(--text-4)'
  }
}

// formatDate → formatShortDate from lib/dates

// ── Tooltip state ─────────────────────────────────────────────────────────────
interface TooltipState {
  x: number
  y: number
  point: CalibrationPoint
}

// ── Empty / loading states ────────────────────────────────────────────────────
function InsufficientState({ pairedCount }: { pairedCount: number }) {
  const needed = 3 - pairedCount
  return (
    <div style={{
      background:   'linear-gradient(180deg, rgba(255,255,255,0.015) 0%, transparent 50%), var(--bg-card)',
      border:       '1px solid var(--border-dim)',
      borderRadius: 12,
      padding:      '24px 22px',
      boxShadow:    '0 1px 6px rgba(0,0,0,0.35)',
    }}>
      <p style={{
        fontSize:      11,
        fontWeight:    700,
        color:         'var(--text-4)',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        margin:        '0 0 10px',
      }}>
        Calibration Trend
      </p>
      <p style={{ fontSize: 13.5, color: 'var(--text-2)', margin: '0 0 6px', lineHeight: 1.6 }}>
        {pairedCount === 0
          ? 'No calibration data yet.'
          : `${pairedCount} data point${pairedCount !== 1 ? 's' : ''} recorded.`}
      </p>
      <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: 0, lineHeight: 1.55 }}>
        {needed === 1
          ? 'One more decision with an outcome logged will unlock your calibration chart.'
          : `${needed} more outcomes needed to render your calibration trend.`}
        {' '}Log outcomes in the session record after a decision plays out.
      </p>

      {/* Progress dots */}
      <div style={{ display: 'flex', gap: 6, marginTop: 16, alignItems: 'center' }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width:        10,
            height:       10,
            borderRadius: '50%',
            background:   i < pairedCount ? 'var(--gold)' : 'transparent',
            border:       `1.5px solid ${i < pairedCount ? 'var(--gold)' : 'var(--border-mid)'}`,
            transition:   'all 0.3s',
          }} />
        ))}
        <span style={{ fontSize: 11, color: 'var(--text-4)', marginLeft: 4 }}>
          {pairedCount} / 3 to activate
        </span>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function CalibrationSparkline({ authToken }: { authToken: string }) {
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(false)
  const [data,     setData]     = useState<CalibrationResponse | null>(null)
  const [tooltip,  setTooltip]  = useState<TooltipState | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/mirror/calibration', {
          headers: { Authorization: `Bearer ${authToken}` },
        })
        if (!res.ok) throw new Error()
        const json = await res.json() as CalibrationResponse
        setData(json)
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [authToken])

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{
        background:   'var(--bg-card)',
        border:       '1px solid var(--border-dim)',
        borderRadius: 12,
        padding:      '24px 22px',
        boxShadow:    '0 1px 6px rgba(0,0,0,0.35)',
        color:        'var(--text-4)',
        fontSize:     12.5,
      }}>
        Loading calibration data…
      </div>
    )
  }

  // ── Error ───────────────────────────────────────────────────────────────────
  if (error || !data) {
    return (
      <div style={{
        background:   'var(--bg-card)',
        border:       '1px solid var(--border-dim)',
        borderRadius: 12,
        padding:      '24px 22px',
        boxShadow:    '0 1px 6px rgba(0,0,0,0.35)',
        color:        'var(--text-4)',
        fontSize:     12.5,
      }}>
        Could not load calibration data.
      </div>
    )
  }

  const { points, summary } = data

  // ── Insufficient data ───────────────────────────────────────────────────────
  if (!summary.dataReady) {
    return <InsufficientState pairedCount={summary.pairedCount} />
  }

  // ── Points for chart rendering ───────────────────────────────────────────────
  // Use all points that have retro filled; pre line only where pre is non-null
  const paired = points.filter(p => p.retrospective_confidence !== null)
  const total    = paired.length
  const preVals  = paired.map(p => p.pre_decision_confidence)   // may contain nulls
  const retroVals= paired.map(p => p.retrospective_confidence)

  // Y-axis labels (1, 5, 10)
  const yLabels = [10, 5, 1]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── Summary card ────────────────────────────────────────────────────── */}
      <div style={{
        background:    'var(--bg-card)',
        border:        '1px solid var(--border-dim)',
        borderRadius:  12,
        padding:       '18px 20px',
        display:       'flex',
        gap:           24,
        flexWrap:      'wrap',
        alignItems:    'flex-start',
      }}>

        {/* Avg delta */}
        <div style={{ minWidth: 100 }}>
          <p style={{ fontSize: 10, color: 'var(--text-4)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 4px' }}>
            Avg. Δ Confidence
          </p>
          <p style={{
            fontSize:          26,
            fontWeight:        700,
            color:             avgDeltaColor(summary.avg_delta),
            margin:            0,
            fontFamily:        'var(--font-mono)',
            fontVariantNumeric:'tabular-nums',
            lineHeight:        1.1,
          }}>
            {summary.avg_delta !== null
              ? (summary.avg_delta >= 0 ? '+' : '') + summary.avg_delta.toFixed(1)
              : '—'}
          </p>
          <p style={{ fontSize: 10, color: 'var(--text-4)', margin: '3px 0 0', lineHeight: 1.4 }}>
            {summary.avg_delta !== null ? 'retro − pre' : 'no pre scores yet'}
          </p>
        </div>

        {/* Avg pre — only shown when pre data exists */}
        {summary.avg_pre !== null && (
          <div style={{ minWidth: 80 }}>
            <p style={{ fontSize: 10, color: 'var(--text-4)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 4px' }}>
              Avg. Pre
            </p>
            <p style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-3)', margin: 0, fontFamily: 'var(--font-mono)' }}>
              {summary.avg_pre.toFixed(1)}
            </p>
            <p style={{ fontSize: 10, color: 'var(--text-4)', margin: '3px 0 0' }}>/ 10</p>
          </div>
        )}

        {/* Avg retro */}
        <div style={{ minWidth: 80 }}>
          <p style={{ fontSize: 10, color: 'var(--text-4)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 4px' }}>
            Avg. Retro
          </p>
          <p style={{ fontSize: 20, fontWeight: 600, color: 'var(--gold)', margin: 0, fontFamily: 'var(--font-mono)' }}>
            {summary.avg_retro?.toFixed(1) ?? '—'}
          </p>
          <p style={{ fontSize: 10, color: 'var(--text-4)', margin: '3px 0 0' }}>/ 10</p>
        </div>

        {/* Trend */}
        <div style={{ minWidth: 100 }}>
          <p style={{ fontSize: 10, color: 'var(--text-4)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 4px' }}>
            Trend
          </p>
          <p style={{
            fontSize:   15,
            fontWeight: 600,
            color:      trendColor(summary.trend),
            margin:     0,
          }}>
            {trendLabel(summary.trend)}
          </p>
          <p style={{ fontSize: 10, color: 'var(--text-4)', margin: '3px 0 0' }}>over time</p>
        </div>

        {/* Pattern */}
        {summary.pattern && (
          <div style={{ flex: 1, minWidth: 180 }}>
            <p style={{ fontSize: 10, color: 'var(--text-4)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 6px' }}>
              Pattern
            </p>
            <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: 0, lineHeight: 1.55 }}>
              {summary.pattern}
            </p>
          </div>
        )}
      </div>

      {/* ── Sparkline chart ──────────────────────────────────────────────────── */}
      <div style={{
        background:   'linear-gradient(180deg, rgba(255,255,255,0.015) 0%, transparent 50%), var(--bg-card)',
        border:       '1px solid var(--border-dim)',
        borderRadius: 12,
        padding:      '16px 16px 8px',
        overflowX:    'auto',
        boxShadow:    '0 1px 6px rgba(0,0,0,0.35)',
      }}>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 18, marginBottom: 10, paddingLeft: PAD.left }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 20, height: 2, background: 'var(--text-4)', borderRadius: 1 }} />
            <span style={{ fontSize: 10, color: 'var(--text-4)', letterSpacing: '0.06em' }}>Pre-decision</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 20, height: 2, background: 'var(--gold)', borderRadius: 1 }} />
            <span style={{ fontSize: 10, color: 'var(--text-4)', letterSpacing: '0.06em' }}>Retrospective</span>
          </div>
        </div>

        {/* SVG chart */}
        <div style={{ position: 'relative', minWidth: Math.max(total * 48, 300) }}>
          <svg
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
          >
            {/* Y-axis grid lines */}
            {yLabels.map(v => (
              <g key={v}>
                <line
                  x1={PAD.left} y1={confToY(v)}
                  x2={CHART_W - PAD.right} y2={confToY(v)}
                  stroke="var(--border-dim)" strokeWidth="0.5" strokeDasharray="3 4"
                />
                <text
                  x={PAD.left - 6} y={confToY(v) + 3.5}
                  textAnchor="end"
                  fill="var(--text-4)"
                  fontSize="8"
                  fontFamily="var(--font-mono)"
                >
                  {v}
                </text>
              </g>
            ))}

            {/* Shaded area between lines */}
            {total >= 2 && (() => {
              const topPath = paired
                .map((p, i) => `${i === 0 ? 'M' : 'L'} ${indexToX(i, total)} ${confToY(p.retrospective_confidence!)}`)
                .join(' ')
              const bottomPath = paired
                .slice()
                .reverse()
                .map((p, i) => `L ${indexToX(total - 1 - i, total)} ${confToY(p.pre_decision_confidence!)}`)
                .join(' ')

              return (
                <path
                  d={`${topPath} ${bottomPath} Z`}
                  fill="var(--gold)"
                  fillOpacity={0.04}
                />
              )
            })()}

            {/* Pre-decision line */}
            <polyline
              points={polylinePoints(preVals, total)}
              fill="none"
              stroke="var(--text-4)"
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {/* Retro line */}
            <polyline
              points={polylinePoints(retroVals, total)}
              fill="none"
              stroke="var(--gold)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {/* Dots + hover targets */}
            {paired.map((p, i) => {
              const x    = indexToX(i, total)
              const preY = confToY(p.pre_decision_confidence!)
              const retY = confToY(p.retrospective_confidence!)
              return (
                <g key={p.session_id}>
                  {/* Pre dot */}
                  <circle cx={x} cy={preY} r={3} fill="var(--bg-card)" stroke="var(--text-4)" strokeWidth={1.5} />
                  {/* Retro dot */}
                  <circle cx={x} cy={retY} r={3.5} fill="var(--gold)" stroke="var(--bg-card)" strokeWidth={1.5} />
                  {/* Invisible hover target */}
                  <rect
                    x={x - 18} y={PAD.top}
                    width={36} height={CHART_H - PAD.top - PAD.bottom}
                    fill="transparent"
                    style={{ cursor: 'default' }}
                    onMouseEnter={() => setTooltip({ x, y: Math.min(preY, retY) - 6, point: p })}
                    onMouseLeave={() => setTooltip(null)}
                  />
                </g>
              )
            })}

            {/* Tooltip */}
            {tooltip && (() => {
              const p    = tooltip.point
              const tx   = Math.min(Math.max(tooltip.x, 60), CHART_W - 70)
              const ty   = Math.max(tooltip.y - 44, PAD.top)
              const dStr = p.calibration_delta !== null
                ? (p.calibration_delta >= 0 ? '+' : '') + p.calibration_delta.toFixed(1)
                : '—'
              return (
                <g>
                  <rect x={tx - 54} y={ty} width={108} height={42} rx={5}
                    fill="var(--bg-inset)" stroke="var(--border-mid)" strokeWidth={0.8} />
                  <text x={tx} y={ty + 13} textAnchor="middle"
                    fill="var(--text-3)" fontSize="8.5" fontFamily="var(--font-mono)">
                    {formatShortDate(p.created_at)}
                  </text>
                  <text x={tx} y={ty + 26} textAnchor="middle"
                    fill="var(--text-4)" fontSize="8" fontFamily="var(--font-mono)">
                    {`Pre: ${p.pre_decision_confidence}  →  Retro: ${p.retrospective_confidence}`}
                  </text>
                  <text x={tx} y={ty + 38} textAnchor="middle"
                    fill={deltaColor(p.calibration_delta)} fontSize="8.5" fontFamily="var(--font-mono)"
                    fontWeight="700">
                    {`Δ ${dStr}`}
                  </text>
                </g>
              )
            })()}
          </svg>
        </div>

        {/* ── Delta bar row ───────────────────────────────────────────────── */}
        <div style={{
          display:     'grid',
          gridTemplateColumns: `repeat(${total}, 1fr)`,
          gap:         2,
          marginTop:   8,
          paddingLeft: PAD.left,
          paddingRight:PAD.right,
        }}>
          {paired.map((p, i) => {
            const delta = p.calibration_delta
            const absH  = delta !== null ? Math.min(Math.abs(delta) * 5, 24) : 3
            const color = deltaColor(delta)
            const label = delta !== null
              ? (delta >= 0 ? '+' : '') + delta.toFixed(0)
              : '—'
            return (
              <div key={p.session_id} style={{
                display:       'flex',
                flexDirection: 'column',
                alignItems:    'center',
                gap:           3,
              }}>
                <div style={{
                  width:        '100%',
                  maxWidth:     28,
                  height:       absH,
                  background:   color,
                  borderRadius: 2,
                  opacity:      0.75,
                  minHeight:    2,
                }} />
                <span style={{
                  fontSize:          8,
                  color,
                  fontFamily:        'var(--font-mono)',
                  fontVariantNumeric:'tabular-nums',
                }}>
                  {label}
                </span>
              </div>
            )
          })}
        </div>

        {/* X-axis date labels — show first, middle, last */}
        <div style={{
          display:     'flex',
          justifyContent:'space-between',
          paddingLeft: PAD.left,
          paddingRight:PAD.right,
          marginTop:   6,
        }}>
          <span style={{ fontSize: 9, color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>
            {formatShortDate(paired[0].created_at)}
          </span>
          {total >= 5 && (
            <span style={{ fontSize: 9, color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>
              {formatShortDate(paired[Math.floor(total / 2)].created_at)}
            </span>
          )}
          <span style={{ fontSize: 9, color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>
            {formatShortDate(paired[total - 1].created_at)}
          </span>
        </div>
      </div>

      {/* ── Footnote ─────────────────────────────────────────────────────────── */}
      <p style={{ fontSize: 11, color: 'var(--text-4)', margin: 0, lineHeight: 1.5 }}>
        Based on {summary.pairedCount} decision{summary.pairedCount !== 1 ? 's' : ''} with a retrospective confidence score logged.
        {summary.avg_delta !== null && ' Delta (retro − pre) shown where pre-decision confidence was also recorded.'}
      </p>
    </div>
  )
}
