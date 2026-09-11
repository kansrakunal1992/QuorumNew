// components/QuorumLearnedSomething.tsx
// ── Unified Session, Tier 3 ────────────────────────────────────────────────
// Product doc item 16 ("dynamic surface... gives the user a reason to
// return even when they don't currently have a major decision"). Renders
// nothing for a new user with no calibration data yet — this is a returning-
// user surface, not something a first session needs to see.
//
// Reuses the existing calibration endpoint rather than adding a new one —
// same data isUnifiedSessionEnabled() already unlocks for free tier on
// mirror/calibration/route.ts, just surfaced here as a single line instead
// of the full calibration view.

'use client'

import { useEffect, useState } from 'react'

interface Props {
  authToken: string | null
}

export default function QuorumLearnedSomething({ authToken }: Props) {
  const [line, setLine] = useState<string | null>(null)

  useEffect(() => {
    if (!authToken) return
    let cancelled = false
    fetch('/api/mirror/calibration', {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled || !data?.summary?.pattern) return
        setLine(data.summary.pattern)
      })
      .catch(() => { /* silent — this is a nice-to-have surface, never blocks the home screen */ })
    return () => { cancelled = true }
  }, [authToken])

  if (!line) return null

  return (
    <div
      style={{
        display:      'flex',
        alignItems:   'center',
        gap:          8,
        padding:      '9px 14px',
        marginBottom: 14,
        borderRadius: 10,
        border:       '1px solid var(--border-dim)',
        background:   'var(--bg-card)',
      }}
    >
      <span style={{
        fontFamily:    'var(--font-mono)',
        fontSize:      10,
        letterSpacing: '0.05em',
        color:         'var(--gold)',
        textTransform: 'uppercase',
        whiteSpace:    'nowrap',
      }}>
        Quorum noticed
      </span>
      <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{line}</span>
    </div>
  )
}
