'use client'

// ── CalibrationRevealCard ─────────────────────────────────────────────────────
// Feature 6: Calibration reveal on home screen (Sprint addictive-pull).
//
// Shows for: mirrorUnlocked = true AND summary.dataReady = true (≥3 paired points)
// Renders nothing otherwise — gate is strict so this only appears when there is
// a real insight to surface, never a placeholder.
//
// The pull: a number the user can't ignore about themselves.
// "Last 3 times you felt this confident, you were right twice." Every new outcome
// logged shifts the delta — there is always a reason to return.
//
// Data: fetches /api/mirror/calibration (already exists, Mirror-gated).
// Placement: page.tsx Chunk 4a block, right after PatternSurfaceCard.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'
import type { CalibrationSummary } from '@/app/api/mirror/calibration/route'

interface Props {
  authToken:      string | null
  mirrorUnlocked: boolean
}

function TrendBadge({ trend }: { trend: CalibrationSummary['trend'] }) {
  if (trend === 'insufficient_data') return null
  const cfg = {
    improving: { glyph: '↑', color: '#4ade80', text: 'improving' },
    declining:  { glyph: '↓', color: '#f87171', text: 'declining'  },
    stable:     { glyph: '→', color: 'var(--text-4)', text: 'stable' },
  }[trend]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontSize: 10.5, color: cfg.color,
      fontFamily: 'var(--font-mono)', letterSpacing: '0.06em',
    }}>
      <span style={{ fontSize: 12 }}>{cfg.glyph}</span>{cfg.text}
    </span>
  )
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) return null
  const color  = delta > 1 ? '#4ade80' : delta < -1 ? '#f87171' : 'var(--text-3)'
  const signed = (delta >= 0 ? '+' : '') + delta.toFixed(1)
  const sub    = delta > 0
    ? 'you gain confidence in hindsight'
    : delta < 0
    ? 'you enter more confident than outcomes warrant'
    : 'well-calibrated entry confidence'
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 600,
        color, letterSpacing: '-0.02em', lineHeight: 1,
      }}>
        {signed}
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-4)', lineHeight: 1.4, maxWidth: 180 }}>
        {sub}
      </span>
    </div>
  )
}

export default function CalibrationRevealCard({ authToken, mirrorUnlocked }: Props) {
  const [summary, setSummary] = useState<CalibrationSummary | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!mirrorUnlocked || !authToken) return
    setLoading(true)
    fetch('/api/mirror/calibration', { headers: { Authorization: `Bearer ${authToken}` } })
      .then(r => r.json())
      .then(d => { if (d?.summary) setSummary(d.summary) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [mirrorUnlocked, authToken])

  if (!mirrorUnlocked || loading || !summary?.dataReady) return null

  return (
    <>
      <style>{`
        @keyframes calibFadeUp {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-dim)',
        borderRadius: 12, padding: '16px 20px', marginTop: 16, marginBottom: 20,
        animation: 'calibFadeUp 0.35s ease',
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.16em',
            textTransform: 'uppercase', color: 'var(--text-4)', margin: 0,
          }}>
            Confidence Calibration · {summary.pairedCount} outcome{summary.pairedCount !== 1 ? 's' : ''} logged
          </p>
          <TrendBadge trend={summary.trend} />
        </div>

        {/* Delta */}
        <div style={{ marginBottom: 12 }}>
          <DeltaBadge delta={summary.avg_delta} />
        </div>

        {/* Pattern — the hook */}
        {summary.pattern && (
          <p style={{
            fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6,
            margin: '0 0 14px', fontStyle: 'italic',
          }}>
            &ldquo;{summary.pattern}&rdquo;
          </p>
        )}

        {/* Supporting numbers */}
        {(summary.avg_pre !== null || summary.avg_retro !== null) && (
          <div style={{ display: 'flex', gap: 20, marginBottom: 14 }}>
            {summary.avg_pre !== null && (
              <div>
                <p style={{
                  fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em',
                  textTransform: 'uppercase', color: 'var(--text-4)', margin: '0 0 2px',
                }}>Avg entry</p>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--text-3)', margin: 0 }}>
                  {summary.avg_pre.toFixed(1)}<span style={{ fontSize: 10, color: 'var(--text-4)' }}>/10</span>
                </p>
              </div>
            )}
            {summary.avg_retro !== null && (
              <div>
                <p style={{
                  fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em',
                  textTransform: 'uppercase', color: 'var(--text-4)', margin: '0 0 2px',
                }}>Avg hindsight</p>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--text-3)', margin: 0 }}>
                  {summary.avg_retro.toFixed(1)}<span style={{ fontSize: 10, color: 'var(--text-4)' }}>/10</span>
                </p>
              </div>
            )}
          </div>
        )}

        {/* CTA */}
        <a href="/mirror#msec-calibration" style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          fontSize: 11.5, color: 'var(--text-4)', textDecoration: 'none',
          fontFamily: 'var(--font-mono)', letterSpacing: '0.06em',
          opacity: 0.7, transition: 'opacity 0.2s',
        }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '0.7')}
        >
          View calibration record →
        </a>

      </div>
    </>
  )
}
