'use client'

// components/EarlyEchoCard.tsx
// Sprint: Second-use early signal
// Sprint: Item C — structural dimension upgrade at session 3+
//
// Shows a lightweight session-count signal at decisions 2–4 on the record page.
// Purpose: prove that Quorum is accumulating something *before* the full pattern
// memory loop activates at session 5 — making return visits feel meaningful
// from session 2, not session 5.
//
// Deliberately lightweight:
//   - Count-only copy (session 2–4) renders immediately, client-only, from
//     localStorage — no network call, no loading state, no layout shift.
//   - At session count 3+, a single optional fetch to
//     /api/record/[id]/echo-hint asks for one abstracted structural dimension
//     name. If it resolves with a match, the sub-line is upgraded in place.
//     If it doesn't resolve (no identity linked, no qualifying match, or the
//     request fails), the original count-only copy stays exactly as it was —
//     this is progressive enhancement, never a blocking or required step.
//   - Hides at session 5+ (MemoryEngineStatus on the homepage handles that)
//   - Hides if user dismisses (sessionStorage flag per record page)
//
// IMPORTANT: this component does NOT touch MIN_SESSIONS or structural-retrieval
// injection. The Council's structural memory gate remains at 5 sessions.
// The echo-hint endpoint is a separate, read-only, uncached lightweight path —
// see app/api/record/[id]/echo-hint/route.ts for the full boundary explanation.

import { useState, useEffect } from 'react'
import { getStoredSessionIds } from '@/lib/storage'

interface Props {
  /** The ID of the session the user is currently viewing */
  sessionId: string
}

// Bug fix (cross-device count mismatch): must match MemoryEngineStatus's
// own PATTERN_MEMORY_THRESHOLD. Not imported from there — that file doesn't
// export it, and duplicating one small constant here is a smaller diff than
// introducing a shared-constants module as a side effect of a bug fix. If
// that threshold ever changes, update both places.
const PATTERN_MEMORY_THRESHOLD = 5

function getSignal(count: number): { headline: string; sub: string } | null {
  if (count < 2 || count >= 5) return null
  const remaining = 5 - count
  switch (count) {
    case 2:
      return {
        headline: 'Second decision recorded.',
        sub:      `${remaining} more and Quorum begins recognising structural patterns across your decisions.`,
      }
    case 3:
      return {
        headline: 'Three decisions in.',
        sub:      `${remaining} more to activate pattern memory. Your judgment record is building.`,
      }
    case 4:
      return {
        headline: 'Four decisions recorded.',
        sub:      'One more to unlock structural pattern recognition — the Council will start connecting your decisions.',
      }
    default:
      return null
  }
}

export default function EarlyEchoCard({ sessionId }: Props) {
  const [signal,  setSignal]  = useState<{ headline: string; sub: string } | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      const dismissKey = `quorum_echo_dismissed_${sessionId}`
      if (sessionStorage.getItem(dismissKey)) return

      const stored = getStoredSessionIds()
      // Include current session even if not yet pushed
      const ids = stored.includes(sessionId) ? stored : [sessionId, ...stored]
      const count  = ids.length
      const result = getSignal(count)
      if (!result) return

      setSignal(result)
      setVisible(true)

      // Item C (dimension upgrade, session 3+) + bug fix (count verification,
      // session 2+): fire-and-forget in both cases — failure leaves count-only
      // copy in place, which is already a complete, correct message *for a
      // device with no server-linked history*. For an identified user, the
      // route also returns trueSessionCount, the real account-wide total —
      // used below to catch the case this component was built to avoid
      // (a returning user on a new device, local count 1-2, real count 200+)
      // and hide the stale milestone instead of showing it.
      if (count >= 2) {
        fetch(`/api/record/${sessionId}/echo-hint`)
          .then(res => res.ok ? res.json() : null)
          .then((data: { available?: boolean; dimensionLabel?: string; matchDate?: string | null; trueSessionCount?: number | null } | null) => {
            // Bug fix: server-verified count wins over local-device count
            // whenever it disagrees and shows the milestone has already
            // passed. Anonymous sessions never get trueSessionCount back
            // (no identity to look up), so this never fires for them — the
            // local count-only copy remains their correct, only source.
            if (typeof data?.trueSessionCount === 'number' && data.trueSessionCount >= PATTERN_MEMORY_THRESHOLD) {
              setVisible(false)
              return
            }
            if (data?.available && data.dimensionLabel) {
              const dateClause = data.matchDate ? ` in ${data.matchDate}` : ''
              setSignal({
                headline: result.headline,
                sub: `This decision shares ${data.dimensionLabel} with one you brought${dateClause}. ${5 - count} more to let the Council connect these directly.`,
              })
            }
          })
          .catch(() => {
            // Silent — count-only copy already rendered, nothing to fix
          })
      }
    } catch {
      // localStorage/sessionStorage unavailable — stay hidden
    }
  }, [sessionId])

  if (!visible || !signal) return null

  const handleDismiss = () => {
    try { sessionStorage.setItem(`quorum_echo_dismissed_${sessionId}`, '1') } catch {}
    setVisible(false)
  }

  return (
    <div style={{
      borderRadius:  12,
      padding:       '13px 18px',
      background:    'var(--bg-card)',
      border:        '1px solid var(--border-subtle)',
      display:       'flex',
      alignItems:    'flex-start',
      justifyContent:'space-between',
      gap:           12,
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {/* Pulse indicator */}
        <div style={{
          width:        7,
          height:       7,
          borderRadius: '50%',
          background:   'var(--gold-dim)',
          marginTop:    5,
          flexShrink:   0,
          boxShadow:    '0 0 0 3px rgba(201,168,76,0.12)',
        }} />
        <div>
          <p style={{
            fontSize:     12.5,
            fontWeight:   600,
            color:        'var(--text-2)',
            margin:       '0 0 3px',
            lineHeight:   1.4,
          }}>
            {signal.headline}
          </p>
          <p style={{
            fontSize:   12,
            color:      'var(--text-4)',
            margin:     0,
            lineHeight: 1.55,
          }}>
            {signal.sub}
          </p>
        </div>
      </div>

      <button
        onClick={handleDismiss}
        aria-label="Dismiss"
        style={{
          background: 'none',
          border:     'none',
          padding:    0,
          fontSize:   15,
          color:      'var(--text-4)',
          cursor:     'pointer',
          flexShrink: 0,
          marginTop:  -1,
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  )
}
