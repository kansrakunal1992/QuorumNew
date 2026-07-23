'use client'

// components/MirrorEchoCard.tsx
// ── In-session live Mirror signal, sessions 5+ ─────────────────────────────
//
// Fills a gap found while tracing the cross-session-learning roadmap item:
// EarlyEchoCard (second-use signal) explicitly hides at session 5+ and hands
// off to the homepage's MemoryEngineStatus/MindChangeTile/RecurringConditionCard.
// But those live on app/page.tsx and app/mirror/page.tsx — never inside the
// live session — so returning users with the richest cross-session data were
// getting LESS live in-session signal than brand-new users on sessions 2-4.
//
// This does not compute anything new. It's a second, better-timed doorway
// onto data that's already fully live:
//   - Unlocked users → app/api/mirror/mind-change (same route MindChangeTile
//     uses on the Mirror page). Renders one line, picking the stronger of
//     the two signals it returns (persuasiveCount over rate — same
//     precedence rule getMindChangePattern itself already applies).
//   - Teaser users (3+ sessions, no subscription) → app/api/mirror/teaser,
//     the shape-only preview route (counts/labels, no interpretation) —
//     doubling as an upgrade nudge at the moment it's most relevant, same
//     spirit as MirrorOpenLoopCard's teaser state on the homepage.
//   - Anonymous / <5 sessions / no signal yet → renders nothing.
//
// Copy discipline carried over from MindChangeTile.tsx (the source of truth
// for this data's wording): persuasiveness is worded as a count of outcomes,
// never a verdict on whose read was "right." Line-building logic is
// duplicated from MindChangeTile rather than imported — same precedent as
// EarlyEchoCard's PATTERN_MEMORY_THRESHOLD duplication (small, stable
// constant/logic; not worth a shared-module refactor as a side effect of
// this change).

import { useState, useEffect } from 'react'
import type { MindChangePattern }        from '@/lib/mind-change-patterns'
import type { AdvisorDivergencePattern } from '@/lib/advisor-divergence'

// Bug-safety note (same as EarlyEchoCard): keep in sync with
// MemoryEngineStatus / lib/mirror-access.ts. Not imported — duplicating one
// small constant is a smaller diff than introducing a shared-constants
// module as a side effect of this change. If either threshold changes,
// update both places.
const PATTERN_MEMORY_THRESHOLD = 5   // EarlyEchoCard hides at this point — we pick up from here
const TEASER_THRESHOLD          = 3   // matches lib/mirror-access.ts TEASER_THRESHOLD

interface MindChangeData {
  mindChangePattern:        MindChangePattern | null
  advisorDivergencePattern: AdvisorDivergencePattern | null
}

interface TeaserData {
  patternCount:  number
  teaserBiases:  string[]
}

interface Props {
  sessionId:     string
  authToken:     string | null
  sessionCount:  number   // real DB count — pass totalSessionCount ?? getStoredSessionIds().length, same convention as RecordReceipt/GraphNudgeLine
  mirrorActive:  boolean  // server-resolved getMirrorAccessState() === 'unlocked', same prop already threaded into SessionView
}

// Duplicated verbatim from MindChangeTile.tsx's persuasivenessLine/divergenceLine —
// see file header for why this isn't imported instead.
function persuasivenessLine(p: MindChangePattern): string {
  return `${p.personaLabel} has shifted your final read in ${p.persuasiveCount} of your last ${p.totalCount} challenges to it — the advisor whose pushback most often moves where you land.`
}

function divergenceLine(p: AdvisorDivergencePattern): string {
  return `You've landed against ${p.personaLabel}'s final read in ${p.divergentCount} decisions — more than any other advisor.`
}

export default function MirrorEchoCard({ sessionId, authToken, sessionCount, mirrorActive }: Props) {
  const [mindData,   setMindData]   = useState<MindChangeData | null>(null)
  const [teaserData, setTeaserData] = useState<TeaserData | null>(null)
  const [loading,    setLoading]    = useState(true)

  const eligible = sessionCount >= PATTERN_MEMORY_THRESHOLD && !!authToken

  useEffect(() => {
    let cancelled = false
    if (!eligible) { setLoading(false); return }

    const run = async () => {
      try {
        if (mirrorActive) {
          const res = await fetch('/api/mirror/mind-change', {
            headers: { Authorization: `Bearer ${authToken}` },
          })
          if (res.ok) {
            const json = await res.json() as MindChangeData
            if (!cancelled) setMindData(json)
          }
        } else if (sessionCount >= TEASER_THRESHOLD) {
          const res = await fetch('/api/mirror/teaser', {
            headers: { Authorization: `Bearer ${authToken}` },
          })
          if (res.ok) {
            const json = await res.json()
            if (!cancelled) {
              setTeaserData({
                // Same fallback MirrorOpenLoopCard uses: bias_library and the
                // rule engine are separate detection systems — show whichever
                // one actually has data for this user.
                patternCount: json?.patternCount > 0
                  ? json.patternCount
                  : (json?.teaserBiases?.length ?? 0),
                teaserBiases: json?.teaserBiases ?? [],
              })
            }
          }
        }
      } catch {
        // fail silent — same convention as MindChangeTile/MirrorOpenLoopCard.
        // Absence of this card is a fully valid, expected state.
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, mirrorActive, authToken, sessionId])

  if (!eligible || loading) return null

  // ── Unlocked: real insight ────────────────────────────────────────────
  if (mirrorActive) {
    if (!mindData) return null
    const { mindChangePattern, advisorDivergencePattern } = mindData
    if (!mindChangePattern && !advisorDivergencePattern) return null

    // Same precedence getMindChangePattern() itself documents: a stronger
    // persuasiveCount is a more actionable signal than a bare rate, and
    // mind-change (what moves you) reads as more useful in-session than
    // divergence (what you tend to override) — so it takes priority when
    // both are present, rather than showing both lines like the Mirror
    // page's fuller tile does.
    const line = mindChangePattern
      ? persuasivenessLine(mindChangePattern)
      : divergenceLine(advisorDivergencePattern as AdvisorDivergencePattern)

    return (
      <div className="sv-fade sv-fade-2" style={{
        background:     'rgba(201,168,76,0.03)',
        border:         '1px solid rgba(201,168,76,0.18)',
        borderLeft:     '3px solid rgba(201,168,76,0.5)',
        borderRadius:   10,
        padding:        '14px 16px',
        marginBottom:   20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--gold)', flexShrink: 0 }} />
          <span style={{
            fontSize: 9, fontWeight: 700, color: 'var(--gold)',
            textTransform: 'uppercase', letterSpacing: '0.1em',
          }}>
            Mirror signal
          </span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0, lineHeight: 1.65 }}>
          {line}
        </p>
      </div>
    )
  }

  // ── Teaser: shape-only preview + upgrade nudge ───────────────────────
  if (!teaserData || teaserData.patternCount === 0) return null
  const { patternCount } = teaserData
  const patternWord = patternCount === 1 ? 'pattern' : 'patterns'

  return (
    <div className="sv-fade sv-fade-2" style={{
      background:    'var(--bg-card)',
      border:        '1px solid var(--border-dim)',
      borderRadius:  12,
      padding:       '13px 18px',
      display:       'flex',
      alignItems:    'center',
      gap:           13,
      marginBottom:  20,
    }}>
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--gold)', flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <p style={{
          fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--text-4)', margin: '0 0 3px',
        }}>
          Mirror · Tracking
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0, lineHeight: 1.5 }}>
          <span style={{ color: 'var(--gold)', fontWeight: 600 }}>{patternCount} {patternWord}</span>
          {' '}identified across your decisions so far
        </p>
      </div>
      <a
        href="/mirror"
        style={{
          fontSize: 10.5, color: 'var(--text-4)', textDecoration: 'none',
          fontFamily: 'var(--font-mono)', letterSpacing: '0.08em',
          flexShrink: 0, opacity: 0.6, transition: 'opacity 0.2s', whiteSpace: 'nowrap',
        }}
        onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
        onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}
      >
        See Mirror →
      </a>
    </div>
  )
}
