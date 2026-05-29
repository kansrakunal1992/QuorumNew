'use client'

// components/ContradictionDetector.tsx
// ── Sprint 9: Contradiction Detector ────────────────────────────────────────
//
// Gate: requires mirror_access (paid) AND >= 40 sessions.
//
// Progressive teaser system — 4 milestones, each reveals a bit more:
//   0–9   decisions → "Detection initialising" — locked, no preview
//  10–19  decisions → Milestone 1 — one blurred principle tile visible
//  20–29  decisions → Milestone 2 — two tiles + "pattern forming" label
//  30–39  decisions → Milestone 3 — three tiles + excerpt of what's coming
//  40+    decisions → Fully unlocked — live contradiction cards
//
// Each milestone has distinct copy to build anticipation without being
// fake or misleading. Tiles stay blurred. No fabricated contradictions shown.
//
// When unlocked: contradiction cards show principle vs violation, session refs,
// severity badge, and are dismissible (stored server-side).
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'
import { formatShortDate } from '@/lib/dates'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Contradiction {
  id:                 string
  principleText:      string
  principleSessionId: string | null
  principleDecision:  string | null
  violationText:      string
  violationSessionId: string | null
  violationDecision:  string | null
  severity:           'sharp' | 'notable' | 'forming'
  category:           string
  generatedAt:        string
}

interface ContradictionData {
  contradictions:    Contradiction[]
  sessionCount:      number
  meetsThreshold:    boolean
  threshold:         number
  lastRanAt:         string | null
}

interface Props {
  authToken:    string
  sessionCount: number   // from parent — renders gate immediately, no extra fetch
}

// ── Constants ─────────────────────────────────────────────────────────────────

const UNLOCK_THRESHOLD = 40

// Milestone definitions — what copy and how many blurred tiles to show
const MILESTONES = [
  {
    min:      0,
    max:      9,
    label:    'Detection initialising',
    body:     'Contradiction detection begins reading patterns across your decisions. The system needs more signal before it can identify genuine inconsistencies — not surface-level ones.',
    tiles:    0,
    excerpt:  null,
  },
  {
    min:      10,
    max:      19,
    label:    'First patterns detected',
    body:     'Quorum has begun mapping the principles you\'ve stated across decisions. A pattern is forming — but it needs more data points before it can surface a reliable contradiction.',
    tiles:    1,
    excerpt:  'Something about how you handle urgency is starting to emerge.',
  },
  {
    min:      20,
    max:      29,
    label:    'Signal strengthening',
    body:     'Two distinct reasoning patterns are now visible across your decisions. The system is tracking whether your stated principles hold when conditions change.',
    tiles:    2,
    excerpt:  'A tension between how you said you\'d evaluate commitments and how you\'ve actually framed them is taking shape.',
  },
  {
    min:      30,
    max:      39,
    label:    'Contradiction forming',
    body:     'Three patterns are now structurally defined. The system has identified at least one area where your reasoning in one decision appears to conflict with a principle you stated in another.',
    tiles:    3,
    excerpt:  'The gap between a stated standard and an actual framing is now clear enough to name. You\'re close.',
  },
]

function getMilestone(count: number) {
  return MILESTONES.find(m => count >= m.min && count <= m.max) ?? MILESTONES[0]
}

// ── Severity display ──────────────────────────────────────────────────────────

const SEVERITY_LABEL: Record<string, string> = {
  sharp:   'Direct',
  notable: 'Tension',
  forming: 'Emerging',
}

const SEVERITY_COLOR: Record<string, string> = {
  sharp:   'rgba(200, 80, 60, 0.8)',
  notable: 'rgba(201, 168, 76, 0.9)',
  forming: 'rgba(130, 130, 150, 0.8)',
}

// ── Blurred placeholder tile ──────────────────────────────────────────────────

function BlurredTile({ index }: { index: number }) {
  const widths = ['82%', '68%', '75%']
  const w = widths[index % widths.length]
  return (
    <div style={{
      background:   'linear-gradient(180deg, rgba(255,255,255,0.015) 0%, transparent 50%), var(--bg-card)',
      border:       '1px solid var(--border-dim)',
      borderRadius: 12,
      padding:      '18px 20px',
      boxShadow:    '0 1px 4px rgba(0,0,0,0.3)',
      marginBottom: 10,
      position:     'relative',
      overflow:     'hidden',
    }}>
      {/* Top severity bar placeholder */}
      <div style={{
        position: 'absolute', top: 0, left: 0,
        width: '100%', height: 2,
        background: 'var(--border-mid)', opacity: 0.4,
      }} />

      {/* Header placeholder */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <div style={{ width: 60, height: 7, background: 'var(--border-dim)', borderRadius: 3, opacity: 0.5 }} />
        <div style={{ width: 40, height: 7, background: 'var(--border-dim)', borderRadius: 3, opacity: 0.3 }} />
      </div>

      {/* "What you said" blurred text lines */}
      <div style={{ marginBottom: 12, filter: 'blur(4px)', userSelect: 'none' }}>
        <div style={{ width: '35%', height: 6, background: 'var(--text-4)', borderRadius: 2, marginBottom: 8, opacity: 0.4 }} />
        <div style={{ width: w, height: 10, background: 'var(--text-2)', borderRadius: 3, marginBottom: 5, opacity: 0.25 }} />
        <div style={{ width: '55%', height: 10, background: 'var(--text-2)', borderRadius: 3, opacity: 0.15 }} />
        <div style={{ width: '40%', height: 7, background: 'var(--text-4)', borderRadius: 2, marginTop: 6, opacity: 0.2 }} />
      </div>

      {/* Connector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px', opacity: 0.2 }}>
        <div style={{ flex: 1, height: 1, background: 'var(--border-mid)' }} />
        <span style={{ fontSize: 9, color: 'var(--text-4)' }}>then</span>
        <div style={{ flex: 1, height: 1, background: 'var(--border-mid)' }} />
      </div>

      {/* "What you did" blurred */}
      <div style={{ filter: 'blur(4px)', userSelect: 'none' }}>
        <div style={{ width: '32%', height: 6, background: 'var(--text-4)', borderRadius: 2, marginBottom: 8, opacity: 0.4 }} />
        <div style={{ width: '88%', height: 10, background: 'var(--text-2)', borderRadius: 3, marginBottom: 5, opacity: 0.2 }} />
        <div style={{ width: '62%', height: 10, background: 'var(--text-2)', borderRadius: 3, opacity: 0.12 }} />
      </div>

      {/* Lock overlay */}
      <div style={{
        position:       'absolute',
        inset:          0,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        background:     'rgba(var(--bg-base-rgb, 12,12,14), 0.35)',
        backdropFilter: 'blur(1px)',
      }}>
        <span style={{ fontSize: 14, opacity: 0.25 }}>🔒</span>
      </div>
    </div>
  )
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ count }: { count: number }) {
  const steps = [10, 20, 30, 40]
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        {steps.map((step, i) => {
          const filled = count >= step
          const partial = count >= (i === 0 ? 0 : steps[i - 1]) && count < step
          const pct = partial
            ? ((count - (i === 0 ? 0 : steps[i - 1])) / 10) * 100
            : filled ? 100 : 0

          return (
            <div key={step} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              {/* Segment track */}
              <div style={{
                width: '90%', height: 3, borderRadius: 2,
                background: 'var(--border-dim)',
                overflow: 'hidden',
                position: 'relative',
              }}>
                <div style={{
                  position:   'absolute',
                  top: 0, left: 0,
                  height:     '100%',
                  width:      `${pct}%`,
                  background: filled ? 'var(--gold)' : 'var(--gold-dim)',
                  borderRadius: 2,
                  transition: 'width 0.6s ease',
                }} />
              </div>
              {/* Step label */}
              <span style={{
                fontSize:   9,
                color:      filled ? 'var(--gold)' : 'var(--text-4)',
                fontWeight: filled ? 700 : 400,
                opacity:    filled ? 1 : 0.5,
              }}>
                {step}
              </span>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={{ fontSize: 9, color: 'var(--text-4)' }}>{count} decisions</span>
        <span style={{ fontSize: 9, color: 'var(--text-4)' }}>{UNLOCK_THRESHOLD - count} to unlock</span>
      </div>
    </div>
  )
}

// ── Teaser card (below threshold) ─────────────────────────────────────────────

function TeaserView({ sessionCount }: { sessionCount: number }) {
  const milestone = getMilestone(sessionCount)

  return (
    <div>
      {/* Status card */}
      <div style={{
        background:   'var(--bg-card)',
        border:       '1px solid var(--border-mid)',
        borderRadius: 12,
        padding:      '18px 20px',
        marginBottom: milestone.tiles > 0 ? 16 : 0,
        position:     'relative',
        overflow:     'hidden',
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0,
          width: '100%', height: 2,
          background: 'linear-gradient(90deg, var(--gold-dim) 0%, transparent 60%)',
        }} />

        <p style={{
          fontSize: 10, fontWeight: 700, color: 'var(--gold)',
          textTransform: 'uppercase', letterSpacing: '0.1em',
          margin: '0 0 8px',
        }}>
          {milestone.label}
        </p>

        <p style={{ fontSize: 12.5, color: 'var(--text-3)', margin: '0 0 10px', lineHeight: 1.6 }}>
          {milestone.body}
        </p>

        {milestone.excerpt && (
          <p style={{
            fontSize:    12,
            color:       'var(--text-4)',
            fontStyle:   'italic',
            margin:      '0 0 10px',
            paddingLeft: 10,
            borderLeft:  '2px solid rgba(201,168,76,0.25)',
            lineHeight:  1.55,
          }}>
            {milestone.excerpt}
          </p>
        )}

        <ProgressBar count={sessionCount} />

        {/* Run a decision CTA */}
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-dim)' }}>
          <a
            href="/"
            style={{
              display:        'inline-flex',
              alignItems:     'center',
              gap:            6,
              fontSize:       11.5,
              fontWeight:     600,
              color:          'var(--gold)',
              textDecoration: 'none',
              opacity:        0.8,
              transition:     'opacity 0.15s',
            }}
            onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.opacity = '1')}
            onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.opacity = '0.8')}
          >
            Run a decision →
          </a>
          <p style={{ fontSize: 10, color: 'var(--text-4)', margin: '4px 0 0', lineHeight: 1.4 }}>
            Each decision with Examiner responses builds the signal needed to detect contradictions.
          </p>
        </div>
      </div>

      {/* Blurred tiles — count varies by milestone */}
      {Array.from({ length: milestone.tiles }).map((_, i) => (
        <BlurredTile key={i} index={i} />
      ))}
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <>
      <style>{`
        @keyframes cd-pulse {
          0%, 100% { opacity: 0.15; }
          50%       { opacity: 0.4; }
        }
      `}</style>
      {[0, 1].map(i => (
        <div key={i} style={{
          background: 'var(--bg-card)', border: '1px solid var(--border-dim)',
          borderRadius: 12, padding: '18px 20px', marginBottom: 12,
          animation: `cd-pulse 1.8s ease-in-out infinite ${i * 0.3}s`,
        }}>
          <div style={{ height: 8, width: '35%', background: 'var(--border-dim)', borderRadius: 3, marginBottom: 14 }} />
          <div style={{ height: 11, width: '85%', background: 'var(--border-dim)', borderRadius: 4, marginBottom: 8 }} />
          <div style={{ height: 11, width: '65%', background: 'var(--border-dim)', borderRadius: 4 }} />
        </div>
      ))}
    </>
  )
}

// ── Contradiction card ────────────────────────────────────────────────────────

function ContradictionCard({
  item, onDismiss,
}: {
  item: Contradiction
  onDismiss: (id: string) => void
}) {
  const [dismissing, setDismissing] = useState(false)

  return (
    <div style={{
      background:   'var(--bg-card)',
      border:       '1px solid var(--border-mid)',
      borderRadius: 12,
      padding:      '18px 20px',
      marginBottom: 12,
      position:     'relative',
      overflow:     'hidden',
      opacity:      dismissing ? 0.3 : 1,
      transition:   'opacity 0.35s',
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0,
        width: '100%', height: 2,
        background: SEVERITY_COLOR[item.severity], opacity: 0.65,
      }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={{
          fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.1em', color: SEVERITY_COLOR[item.severity],
        }}>
          {SEVERITY_LABEL[item.severity] ?? item.severity}
          {item.category ? ` · ${item.category.replace(/_/g, ' ')}` : ''}
        </span>
        <button
          onClick={() => { setDismissing(true); onDismiss(item.id) }}
          disabled={dismissing}
          style={{
            background: 'none', border: 'none', color: 'var(--text-4)',
            cursor: 'pointer', fontSize: 16, lineHeight: 1,
            padding: '0 2px', opacity: 0.45, transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.opacity = '1')}
          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.opacity = '0.45')}
        >×</button>
      </div>

      {/* Principle */}
      <div style={{ marginBottom: 12 }}>
        <p style={{
          fontSize: 9, fontWeight: 700, color: 'var(--text-4)',
          textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 5px',
        }}>What you said</p>
        <p style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.55, margin: 0, fontStyle: 'italic' }}>
          "{item.principleText}"
        </p>
        {item.principleDecision && (
          <p style={{ fontSize: 10, color: 'var(--text-4)', margin: '4px 0 0', lineHeight: 1.4 }}>
            From: {item.principleDecision}{item.principleDecision.length >= 80 ? '…' : ''}
          </p>
        )}
      </div>

      {/* Connector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px', opacity: 0.35 }}>
        <div style={{ flex: 1, height: 1, background: 'var(--border-mid)' }} />
        <span style={{ fontSize: 9, color: 'var(--text-4)', letterSpacing: '0.06em' }}>then</span>
        <div style={{ flex: 1, height: 1, background: 'var(--border-mid)' }} />
      </div>

      {/* Violation */}
      <div>
        <p style={{
          fontSize: 9, fontWeight: 700, color: 'var(--text-4)',
          textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 5px',
        }}>What you did</p>
        <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.55, margin: 0 }}>
          {item.violationText}
        </p>
        {item.violationDecision && (
          <p style={{ fontSize: 10, color: 'var(--text-4)', margin: '4px 0 0', lineHeight: 1.4 }}>
            From: {item.violationDecision}{item.violationDecision.length >= 80 ? '…' : ''}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ContradictionDetector({ authToken, sessionCount }: Props) {
  const [data,      setData]      = useState<ContradictionData | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(false)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  // If below threshold, show teaser immediately without fetching
  const belowThreshold = sessionCount < UNLOCK_THRESHOLD

  useEffect(() => {
    if (belowThreshold) { setLoading(false); return }

    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/mirror/contradictions', {
          headers: { Authorization: `Bearer ${authToken}` },
        })
        if (!res.ok) { if (!cancelled) setError(true); return }
        const json = await res.json() as ContradictionData
        if (!cancelled) setData(json)
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [authToken, belowThreshold])

  const handleDismiss = async (id: string) => {
    setDismissed(prev => new Set([...prev, id]))
    try {
      await fetch(`/api/mirror/contradictions?id=${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      })
    } catch { /* dismissed locally regardless */ }
  }

  // ── Below threshold — progressive teaser ─────────────────────────────────
  if (belowThreshold) return <TeaserView sessionCount={sessionCount} />

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) return <Skeleton />

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.015) 0%, transparent 50%), var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: 12, padding: '16px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }}>
        <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: 0, lineHeight: 1.6 }}>
          Contradiction detection temporarily unavailable. Your data is intact.
        </p>
      </div>
    )
  }

  const active = (data?.contradictions ?? []).filter(c => !dismissed.has(c.id))

  // ── No contradictions yet ─────────────────────────────────────────────────
  if (active.length === 0) {
    return (
      <div style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.015) 0%, transparent 50%), var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: 12, padding: '16px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }}>
        <p style={{ fontSize: 12.5, color: 'var(--text-4)', margin: 0, lineHeight: 1.6 }}>
          {data?.lastRanAt
            ? 'No structural contradictions detected yet. This updates as you add more decisions and deepen your Examiner responses.'
            : 'Contradiction analysis runs after each session. Your data is building — check back after a few more decisions.'}
        </p>
      </div>
    )
  }

  // ── Live contradictions ───────────────────────────────────────────────────
  return (
    <div>
      {active.map(item => (
        <ContradictionCard key={item.id} item={item} onDismiss={handleDismiss} />
      ))}
      <p style={{ fontSize: 10, color: 'var(--text-4)', margin: '4px 0 0', lineHeight: 1.5 }}>
        Extracted from your Examiner responses and pushbacks — your own words, not an assessment.
        {data?.lastRanAt && ` Last updated ${formatShortDate(data.lastRanAt)}.`}
      </p>
    </div>
  )
}
