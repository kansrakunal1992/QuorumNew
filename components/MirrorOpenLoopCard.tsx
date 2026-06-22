'use client'

// ── MirrorOpenLoopCard ─────────────────────────────────────────────────────────
// Feature: Mirror open loop counter on the home screen.
//
// Creates an active pull rather than a passive status indicator.
// The difference: "Pattern Memory activates at 5 sessions" (passive, MemoryEngineStatus)
// vs "A pattern is forming — 1 more decision to confirm it" (active, this card).
//
// State machine:
//   mirrorUnlocked = true     → renders nothing (PatternSurfaceCard handles them)
//   sessionCount = 0          → renders nothing (parent gates on sessions.length > 0)
//   sessionCount 1–2          → countdown: "X more decisions to your first pattern"
//   sessionCount ≥ 3, teaser  → fetch /api/mirror/teaser → show pattern count + blurred
//                                bias labels + CTA to Mirror page
//
// Placement in page.tsx: between RecurringConditionCard and MemoryEngineStatus.
// Only shown when !mirrorUnlocked — the unlocked path already has PatternSurfaceCard.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'

// Keep in sync with lib/mirror-access.ts TEASER_THRESHOLD
const TEASER_THRESHOLD = 3

interface TeaserData {
  patternCount:      number
  sessionCount:      number
  calibrationDates:  string[]
  teaserBiases:      string[]
}

interface Props {
  authToken:      string | null
  sessionCount:   number
  mirrorUnlocked: boolean
}

export default function MirrorOpenLoopCard({ authToken, sessionCount, mirrorUnlocked }: Props) {
  const [teaser,  setTeaser]  = useState<TeaserData | null>(null)
  const [loading, setLoading] = useState(false)

  const isTeaserState    = sessionCount >= TEASER_THRESHOLD && !mirrorUnlocked && !!authToken
  const isCountdownState = sessionCount >= 1 && sessionCount < TEASER_THRESHOLD && !mirrorUnlocked

  useEffect(() => {
    if (!isTeaserState) return
    setLoading(true)
    fetch('/api/mirror/teaser', {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && typeof d.patternCount === 'number') setTeaser(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [isTeaserState, authToken])

  // Never render for unlocked users or users with no sessions
  if (mirrorUnlocked || sessionCount === 0) return null

  const sharedStyles = `
    @keyframes mirrorPulse {
      0%, 100% { opacity: 0.3; transform: scale(0.85); }
      50%       { opacity: 1;   transform: scale(1.15); }
    }
    @keyframes mirrorFadeUp {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0);   }
    }
  `

  // ── State A: Countdown (1–2 sessions) ────────────────────────────────────
  if (isCountdownState) {
    const remaining = TEASER_THRESHOLD - sessionCount

    return (
      <>
        <style>{sharedStyles}</style>
        <div
          style={{
            background:    'var(--bg-card)',
            border:        '1px solid var(--border-dim)',
            borderRadius:  12,
            padding:       '13px 18px',
            display:       'flex',
            alignItems:    'center',
            gap:           13,
            animation:     'mirrorFadeUp 0.35s ease',
          }}
        >
          {/* Pulsing dot */}
          <div style={{
            width:      7,
            height:     7,
            borderRadius: '50%',
            background: 'var(--gold)',
            flexShrink: 0,
            animation:  'mirrorPulse 2.2s ease-in-out infinite',
          }} />

          <div style={{ flex: 1 }}>
            <p style={{
              fontFamily:    'var(--font-mono)',
              fontSize:      9.5,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color:         'var(--text-4)',
              margin:        '0 0 3px',
            }}>
              Mirror · Building
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0, lineHeight: 1.5 }}>
              <span style={{ color: 'var(--gold)', fontWeight: 600 }}>
                {remaining} more decision{remaining !== 1 ? 's' : ''}
              </span>
              {' '}to confirm your first pattern
            </p>
          </div>

          <a
            href="/mirror"
            style={{
              fontSize:      10.5,
              color:         'var(--text-4)',
              textDecoration:'none',
              fontFamily:    'var(--font-mono)',
              letterSpacing: '0.08em',
              flexShrink:    0,
              opacity:       0.6,
              transition:    'opacity 0.2s',
              whiteSpace:    'nowrap',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}
          >
            Preview →
          </a>
        </div>
      </>
    )
  }

  // ── State B: Teaser (3+ sessions, not unlocked) ───────────────────────────
  if (isTeaserState) {
    // Hold render until data arrives — don't flash empty
    if (loading || !teaser) return null
    // bias_library (teaserBiases) and rule engine are separate detection systems.
    // Mirror page shows bias_library patterns. Use whichever has data.
    const patternCount = teaser.patternCount > 0
      ? teaser.patternCount
      : (teaser.teaserBiases?.length ?? 0)

    if (patternCount === 0) return null

    const { teaserBiases } = teaser
    const patternWord = patternCount === 1 ? 'pattern' : 'patterns'

    return (
      <>
        <style>{sharedStyles}</style>
        <div
          style={{
            background:   'var(--bg-card)',
            border:       '1px solid var(--gold-dim)',
            borderLeft:   '2px solid var(--gold)',
            borderRadius: 12,
            padding:      '16px 20px',
            animation:    'mirrorFadeUp 0.4s ease',
          }}
        >
          {/* ── Header ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 11 }}>
            <div style={{
              width:      7,
              height:     7,
              borderRadius: '50%',
              background: 'var(--gold)',
              flexShrink: 0,
              animation:  'mirrorPulse 2.2s ease-in-out infinite',
            }} />
            <p style={{
              fontFamily:    'var(--font-mono)',
              fontSize:      9.5,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color:         'var(--gold)',
              margin:        0,
              opacity:       0.85,
            }}>
              Mirror · {patternCount} {patternWord} forming
            </p>
          </div>

          {/* ── Hook copy ── */}
          <p style={{
            fontFamily:    'var(--font-display)',
            fontSize:      17,
            fontWeight:    400,
            color:         'var(--text-1)',
            margin:        '0 0 5px',
            lineHeight:    1.35,
            letterSpacing: '-0.01em',
          }}>
            {patternCount === 1
              ? 'A pattern is confirmed in your record'
              : `${patternCount} patterns confirmed in your record`}
          </p>

          <p style={{
            fontSize:   12.5,
            color:      'var(--text-3)',
            margin:     '0 0 14px',
            lineHeight: 1.65,
          }}>
            Your Mirror has been watching every decision you&apos;ve brought here.
            The {patternWord} {patternCount === 1 ? 'is' : 'are'} locked — activate Mirror to see {patternCount === 1 ? 'it' : 'them'}.
          </p>

          {/* ── Blurred bias labels — the tease ── */}
          {teaserBiases.length > 0 && (
            <div style={{
              display:       'flex',
              gap:           7,
              flexWrap:      'wrap',
              marginBottom:  14,
              alignItems:    'center',
            }}>
              {teaserBiases.map(bias => (
                <span
                  key={bias}
                  style={{
                    fontSize:    11,
                    padding:     '3px 11px',
                    borderRadius: 20,
                    background:  'rgba(201,168,76,0.08)',
                    border:      '1px solid var(--gold-dim)',
                    color:       'var(--text-4)',
                    fontFamily:  'var(--font-mono)',
                    letterSpacing: '0.05em',
                    filter:      'blur(4.5px)',
                    userSelect:  'none',
                    cursor:      'default',
                    WebkitUserSelect: 'none',
                  }}
                >
                  {bias}
                </span>
              ))}
              <span style={{
                fontSize:    10.5,
                color:       'var(--text-4)',
                fontFamily:  'var(--font-mono)',
                letterSpacing: '0.04em',
                opacity:     0.65,
              }}>
                + unlock to reveal
              </span>
            </div>
          )}

          {/* ── CTA ── */}
          <a
            href="/mirror"
            style={{
              display:        'inline-flex',
              alignItems:     'center',
              gap:            5,
              fontSize:       12,
              fontWeight:     600,
              color:          'var(--gold)',
              textDecoration: 'none',
              fontFamily:     'var(--font-mono)',
              letterSpacing:  '0.06em',
              opacity:        0.9,
              transition:     'opacity 0.2s',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '0.9')}
          >
            Open your Mirror →
          </a>
        </div>
      </>
    )
  }

  return null
}
