'use client'

// components/PredictionTally.tsx
// -- Phase 1 (retention work): running prediction record ----------------------
// "Quorum has guessed right 1 of 2 so far." One line, no card chrome. Reads the
// aggregate from /api/prediction-tally (anonymous-safe: local session ids +
// device id; linked: also user_id). Renders nothing until at least one decision
// has a recorded prediction outcome, so it never shows "0 of 0".
//
// Why it exists: the prediction reveal ("Quorum predicted you" / "You surprised
// Quorum") is the best curiosity hook in the product, but it only ever
// appeared once per decision. A running tally gives a second decision a reason
// to exist -- "will it guess me again?".

import { useEffect, useRef, useState } from 'react'
import { getStoredDeviceId, getStoredSessionIds } from '@/lib/storage'
import { getAuthHeaders } from '@/lib/auth-headers'
import { track } from '@/lib/track'

interface Props {
  /** Change this to force a refetch (e.g. right after the user locks a decision). */
  refreshKey?: string | number | boolean
  /** Include this session id even if it has not reached local storage yet. */
  sessionId?: string | null
  surface: string
}

export default function PredictionTally({ refreshKey, sessionId, surface }: Props) {
  const [tally, setTally] = useState<{ guessed: number; total: number } | null>(null)
  const tracked = useRef(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const ids = getStoredSessionIds()
        const withCurrent = sessionId && !ids.includes(sessionId) ? [sessionId, ...ids] : ids
        const res = await fetch('/api/prediction-tally', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
          body:    JSON.stringify({ ids: withCurrent, deviceId: getStoredDeviceId() }),
        })
        if (!res.ok) return
        const d = await res.json()
        if (!cancelled && typeof d?.total === 'number') setTally({ guessed: d.guessed ?? 0, total: d.total })
      } catch { /* the line just does not appear */ }
    })()
    return () => { cancelled = true }
  }, [refreshKey, sessionId])

  useEffect(() => {
    if (tally && tally.total > 0 && !tracked.current) {
      tracked.current = true
      track('tally_seen', { guessed: tally.guessed, total: tally.total, surface })
    }
  }, [tally, surface])

  if (!tally || tally.total < 1) return null

  const { guessed, total } = tally
  const line = guessed === 0
    ? `You've surprised Quorum ${total === 1 ? 'on your first one' : `${total} times out of ${total}`}.`
    : `Quorum has guessed right ${guessed} of ${total} so far.`

  return (
    <p style={{ fontSize: 12.5, color: 'var(--gold)', margin: 0, lineHeight: 1.5, textAlign: 'center' }}>
      {line}
    </p>
  )
}
