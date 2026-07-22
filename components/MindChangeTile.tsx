'use client'

// components/MindChangeTile.tsx
// ── Phase 4 — Mind-Change / Advisor-Divergence Mirror tile ────────────────────
//
// Surfaces the two cross-session personalization signals computed by
// lib/mind-change-patterns.ts (which advisor most often changes the user's
// mind) and lib/advisor-divergence.ts (which advisor's final lean the user
// most often ends up going against). Same boosts already feed
// lib/persona-relevance.ts's council weighting — this tile is the
// human-readable surface of that same data, not a new computation.
//
// Styled as a compact single-insight card, modeled on MirrorInsightCard.tsx
// (the closest existing analog) rather than a full SectionWrapper module —
// this is a small cross-module observation, not its own deep-dive section.
// Self-fetching via authToken, same convention as BiasFingerprint/PatternStore.
//
// Copy discipline (per both source modules' own docblocks): persuasiveness
// is "a count of classification outcomes, not a claim about decision
// quality" — worded as an outcome count, not a verdict on whose read is
// better. Divergence is framed as "you tend to go against X's read," never
// "X is wrong" or "you are wrong." Renders nothing if neither pattern has
// cleared its MINIMUM_EVENTS gate yet — that's the common, expected state
// for most users, not an error.
//
// Design note: when BOTH patterns are present, both are shown as separate
// lines in one tile rather than picking one — they're independent signals
// (which advisor persuades you vs. which one you tend to override), and
// showing both avoided an arbitrary tie-break rule with no real basis in
// the data. Revisit if user feedback suggests otherwise.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'
import type { MindChangePattern }        from '@/lib/mind-change-patterns'
import type { AdvisorDivergencePattern } from '@/lib/advisor-divergence'

interface MindChangeData {
  mindChangePattern:        MindChangePattern | null
  advisorDivergencePattern: AdvisorDivergencePattern | null
}

interface Props { authToken: string }

function persuasivenessLine(p: MindChangePattern): string {
  return `${p.personaLabel} has shifted your final read in ${p.persuasiveCount} of your last ${p.totalCount} challenges to it — the advisor whose pushback most often moves where you land. A count of outcomes, not a verdict on whose read is better.`
}

function divergenceLine(p: AdvisorDivergencePattern): string {
  return `You've landed against ${p.personaLabel}'s final read in ${p.divergentCount} decisions — more than any other advisor. Not a sign either of you is wrong, just a pattern in where you two tend to part ways.`
}

export default function MindChangeTile({ authToken }: Props) {
  const [data,    setData]    = useState<MindChangeData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const res = await fetch('/api/mirror/mind-change', {
          headers: { Authorization: `Bearer ${authToken}` },
        })
        if (!res.ok) return
        const json = await res.json() as MindChangeData
        if (!cancelled) setData(json)
      } catch {
        // fail silent — same convention as MirrorInsightCard/PatternSurfaceCard
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [authToken])

  if (loading || !data) return null
  const { mindChangePattern, advisorDivergencePattern } = data
  if (!mindChangePattern && !advisorDivergencePattern) return null

  return (
    <div style={{
      background:     'rgba(201,168,76,0.03)',
      border:         '1px solid rgba(201,168,76,0.18)',
      borderLeft:     '3px solid rgba(201,168,76,0.5)',
      borderRadius:   10,
      padding:        '14px 16px',
      marginBottom:   28,
      animation:      'secFadeIn 0.4s ease both',
      animationDelay: '30ms',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
        <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--gold)', flexShrink: 0 }} />
        <span style={{
          fontSize: 9, fontWeight: 700, color: 'var(--gold)',
          textTransform: 'uppercase', letterSpacing: '0.1em',
        }}>
          Advisor patterns
        </span>
      </div>

      {mindChangePattern && (
        <p style={{
          fontSize: 13, color: 'var(--text-2)', lineHeight: 1.65,
          margin: advisorDivergencePattern ? '0 0 10px' : 0,
        }}>
          {persuasivenessLine(mindChangePattern)}
        </p>
      )}

      {advisorDivergencePattern && (
        <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0, lineHeight: 1.65 }}>
          {divergenceLine(advisorDivergencePattern)}
        </p>
      )}
    </div>
  )
}
