'use client'
// components/BenchmarkScopeTag.tsx
// Institutional Sprint 5 (tasks 3+4+5, consolidated) — the one component
// CalibrationSparkline/BiasFingerprint/PatternTile each drop in next to a
// per-dimension personal stat. Self-contained: does its own fetch, decides
// for itself whether to render the scope tag, the not-enough-yet state, or
// nothing at all (institutional mode off, or no institutional context for
// this user — same "absent, not empty" pattern as every other institutional
// UI piece in this build).

import { useState, useEffect } from 'react'
import { isInstitutionalModeEnabled } from '@/lib/feature-flags'
import NotEnoughParticipantsYet from '@/components/NotEnoughParticipantsYet'
import UnlockNotice from '@/components/UnlockNotice'

interface BenchmarkResponse {
  dim: string
  gap: number
  isSignal: boolean
  buckets: { bucket: 'high' | 'low'; avgDelta: number; n: number }[]
  scope:
    | { type: 'institution' | 'platform' | 'rollup'; label: string; n: number }
    | { type: 'insufficient' }
  progress?: { bucket: 'high' | 'low'; current: number; needed: number }[]
  firstUnlock?: boolean
}

export default function BenchmarkScopeTag({ dim, authToken }: { dim: string; authToken: string }) {
  const [data, setData] = useState<BenchmarkResponse | null>(null)

  useEffect(() => {
    if (!isInstitutionalModeEnabled() || !authToken) return
    let cancelled = false
    fetch(`/api/institutions/benchmark?dim=${encodeURIComponent(dim)}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(res => (res.ok ? res.json() : null))
      .then((json: BenchmarkResponse | null) => { if (!cancelled) setData(json) })
      .catch(() => { if (!cancelled) setData(null) })
    return () => { cancelled = true }
  }, [dim, authToken])

  if (!isInstitutionalModeEnabled() || !data) return null

  if (data.scope.type === 'insufficient') {
    return data.progress ? <NotEnoughParticipantsYet progress={data.progress} /> : null
  }

  return (
    <>
      <UnlockNotice show={!!data.firstUnlock} label={data.scope.label} />
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 9px', borderRadius: 20,
        border: '1px solid var(--border-dim)', background: 'transparent',
        color: 'var(--text-4)', fontSize: 10, fontFamily: 'var(--font-mono)',
        whiteSpace: 'nowrap',
      }}>
        vs {data.scope.label} (n={data.scope.n})
      </span>
    </>
  )
}
