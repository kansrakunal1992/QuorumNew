'use client'

// components/PatternStore.tsx
// ── Mirror Module: Decision Pattern Store (Sprint 18b) ────────────────────────
//
// Surfaces /api/mirror/patterns in the Mirror unlocked view.
//
// Two sub-sections:
//   1. "How your decisions tend to be structured" — rules that fired ≥1 time,
//      sorted by frequency. Plain type badges: "Wrong question", "Pause first",
//      "Watch this". No jargon in user-facing copy.
//
//   2. "What your decisions are made of" — top ontology dimensions by avg score,
//      v2.0 sessions only. Each dim gets a plain description of what the score means.
//
// Language principle: never surface internal terms (rule engine, tagger, ontology).
// Auth: receives authToken prop — same pattern as BiasFingerprint, Independence.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'
import type { PatternStoreData, RulePattern, DimPattern, RuleType } from '@/lib/types'

// ── Type badge — plain labels ──────────────────────────────────────────────────
//
// REDIRECT → "Wrong question"  the real decision sits upstream of this one
// GATE     → "Pause first"     something needs to be resolved before analysing
// FLAG     → "Watch this"      a specific risk is quietly active here

const TYPE_CONFIG: Record<RuleType, { label: string; color: string; bg: string }> = {
  REDIRECT: { label: 'Wrong question', color: '#7eb8e0', bg: 'rgba(126,184,224,0.08)' },
  GATE:     { label: 'Pause first',    color: '#c9a84c', bg: 'rgba(201,168,76,0.08)'  },
  FLAG:     { label: 'Watch this',     color: '#e09070', bg: 'rgba(224,144,112,0.08)' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function freqPhrase(pct: number, count: number): string {
  const p = Math.round(pct * 100)
  if (p >= 80)     return `Almost every decision — ${p}%`
  if (p >= 50)     return `More often than not — ${p}%`
  if (p >= 30)     return `Recurring — ${p}% of decisions`
  if (count === 1) return `Once so far — too early to call a pattern`
  return                  `${p}% of decisions`
}

function scoreDesc(score: number): string {
  if (score >= 4.5) return 'Extremely high — this defines how you decide'
  if (score >= 3.5) return 'High — a dominant factor across your decisions'
  if (score >= 2.5) return 'Moderate — present, but not dominant'
  return                   'Lower — not a primary driver in your decisions'
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

  return (
    <div
      style={{
        background:   'var(--bg-card)',
        border:       '1px solid var(--border-dim)',
        borderRadius: 10,
        padding:      '14px 16px',
        transition:   'border-color 0.2s',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-mid)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-dim)')}
    >
      {/* Top row: badge + label + count */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
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
        <span style={{
          fontSize:   12.5,
          fontWeight: 600,
          color:      'var(--text-2)',
          flex:       1,
          lineHeight: 1.4,
        }}>
          {pattern.label}
        </span>
        <span style={{
          fontSize:           10.5,
          color:              isStrong ? 'var(--gold)' : 'var(--text-4)',
          fontVariantNumeric: 'tabular-nums',
          flexShrink:         0,
          paddingTop:         2,
          fontWeight:         isStrong ? 600 : 400,
        }}>
          {pattern.fire_count}×
        </span>
      </div>

      {/* Plain-language description */}
      <p style={{ fontSize: 12.5, color: 'var(--text-3)', margin: '0 0 10px', lineHeight: 1.6 }}>
        {pattern.description}
      </p>

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
            width:        barPct,
            height:       '100%',
            background:   isStrong ? 'var(--gold)' : 'var(--border-hi)',
            borderRadius: 2,
            transition:   'width 0.5s ease',
          }} />
        </div>
        <span style={{
          fontSize:   10.5,
          color:      'var(--text-4)',
          flexShrink: 0,
          textAlign:  'right',
          maxWidth:   220,
          lineHeight: 1.4,
        }}>
          {freqPhrase(pattern.pct, pattern.fire_count)}
        </span>
      </div>
    </div>
  )
}

// ── Dimension row ─────────────────────────────────────────────────────────────

function DimRow({ dim, isTop, isLast }: { dim: DimPattern; isTop: boolean; isLast: boolean }) {
  const barWidth = `${Math.round((dim.avg_score / 5) * 100)}%`

  return (
    <div style={{
      padding:      '11px 0',
      borderBottom: isLast ? 'none' : '1px solid var(--border-dim)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <div style={{
          width:        5,
          height:       5,
          borderRadius: '50%',
          background:   isTop ? 'var(--gold)' : 'var(--border-hi)',
          flexShrink:   0,
        }} />
        <span style={{
          fontSize:   12.5,
          color:      isTop ? 'var(--text-2)' : 'var(--text-3)',
          flex:       1,
          fontWeight: isTop ? 500 : 400,
        }}>
          {dim.label}
        </span>
        <span style={{
          fontSize:           10.5,
          color:              scoreColor(dim.avg_score),
          fontVariantNumeric: 'tabular-nums',
          fontWeight:         isTop ? 600 : 400,
        }}>
          {dim.avg_score.toFixed(1)}<span style={{ color: 'var(--text-4)', fontWeight: 400 }}> / 5</span>
        </span>
      </div>

      {/* Score bar */}
      <div style={{
        height:       3,
        background:   'var(--bg-inset)',
        borderRadius: 2,
        overflow:     'hidden',
        marginBottom: 5,
        marginLeft:   15,
      }}>
        <div style={{
          width:        barWidth,
          height:       '100%',
          background:   scoreColor(dim.avg_score),
          borderRadius: 2,
          transition:   'width 0.6s ease',
        }} />
      </div>

      {/* Plain description */}
      <p style={{ fontSize: 11, color: 'var(--text-4)', margin: '0 0 0 15px', lineHeight: 1.5 }}>
        {scoreDesc(dim.avg_score)}
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

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0', color: 'var(--text-4)', fontSize: 12 }}>
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: 'var(--gold)',
          animation: 'blink 1.5s ease-in-out infinite',
        }} />
        Loading patterns…
      </div>
    )
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error || !data) {
    return (
      <p style={{ fontSize: 12, color: 'var(--text-4)', margin: 0 }}>
        Could not load your patterns. Try refreshing.
      </p>
    )
  }

  // ── Threshold not met ──────────────────────────────────────────────────────
  if (!data.threshold_met) {
    const needed = 3 - data.session_count
    return (
      <div style={{
        background:   'var(--bg-card)',
        border:       '1px solid var(--border-dim)',
        borderRadius: 10,
        padding:      '18px 20px',
      }}>
        <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '0 0 8px', fontWeight: 500 }}>
          {needed} more decision{needed !== 1 ? 's' : ''} needed before patterns appear.
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-4)', margin: 0, lineHeight: 1.6 }}>
          Quorum spots patterns from how your decisions are set up — not what you say about yourself.
          It takes a few sessions before anything reliably repeating becomes visible.
        </p>
      </div>
    )
  }

  // ── No patterns fired yet ──────────────────────────────────────────────────
  if (data.patterns.length === 0) {
    return (
      <div style={{
        background:   'var(--bg-card)',
        border:       '1px solid var(--border-dim)',
        borderRadius: 10,
        padding:      '18px 20px',
      }}>
        <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '0 0 8px', fontWeight: 500 }}>
          No repeating patterns yet.
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-4)', margin: 0, lineHeight: 1.6 }}>
          Your decisions so far have each been structurally different from the others — no single pattern has come up more than once.
          Keep running sessions and this will fill in.
        </p>
      </div>
    )
  }

  const maxCount = data.patterns[0].fire_count

  return (
    <div>

      {/* ── Section 1: How your decisions tend to be structured ─────────── */}
      <div style={{ marginBottom: data.top_dimensions.length > 0 ? 32 : 0 }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-4)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            How your decisions tend to be structured
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-4)', fontVariantNumeric: 'tabular-nums' }}>
            {data.sessions_with_rules} session{data.sessions_with_rules !== 1 ? 's' : ''}
          </span>
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: '0 0 12px', lineHeight: 1.65 }}>
          These signals show up in how your decisions are set up — before you even get to analysis.
          Things like: are you asking the right question, do you have enough to go on yet,
          or is a quiet risk already shaping the outcome? Sorted by how often they appeared.
        </p>

        {/* Badge legend */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 14 }}>
          {(Object.entries(TYPE_CONFIG) as [RuleType, typeof TYPE_CONFIG[RuleType]][]).map(([, cfg]) => (
            <span key={cfg.label} style={{
              fontSize:      9.5,
              color:         cfg.color,
              background:    cfg.bg,
              border:        `1px solid ${cfg.color}30`,
              borderRadius:  4,
              padding:       '2px 7px',
              fontWeight:    700,
              letterSpacing: '0.05em',
            }}>
              {cfg.label}
            </span>
          ))}
          <span style={{ fontSize: 10.5, color: 'var(--text-4)' }}>— what kind of signal each is</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.patterns.map(pattern => (
            <RuleRow key={pattern.rule_id} pattern={pattern} maxCount={maxCount} />
          ))}
        </div>
      </div>

      {/* ── Section 2: What your decisions are made of ───────────────────── */}
      {data.top_dimensions.length > 0 && (
        <div style={{
          background:   'var(--bg-card)',
          border:       '1px solid var(--border-dim)',
          borderRadius: 10,
          padding:      '18px 20px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-4)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              What your decisions are made of
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-4)' }}>
              Top {data.top_dimensions.length}
            </span>
          </div>

          <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: '0 0 4px', lineHeight: 1.65 }}>
            Each decision you bring here is quietly rated across a set of qualities —
            how much is at stake, how reversible it is, how much uncertainty is involved, and so on.
            The list below shows which of those qualities score highest across your decisions, consistently.
            It tells you what kind of choices you're actually making — as opposed to how you might describe them to yourself.
          </p>

          <div style={{ marginTop: 10 }}>
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
