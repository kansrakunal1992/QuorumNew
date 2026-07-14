'use client'
// components/BiasParameterBenchmarkTag.tsx
// Institutional Sprint 6 — PatternTile's analog of BenchmarkScopeTag.
// Renders nothing while loading, when institutional mode is off, or when
// there's no cleared benchmark for this bias parameter — same "absent, not
// empty" pattern as everywhere else.

import { useState, useEffect } from 'react'
import { isInstitutionalModeEnabled } from '@/lib/feature-flags'

interface BiasParameterBenchmarkResponse {
  biasParameter: string
  memberCount: number | null
  avgConfidenceWeight: number | null
  scope: { type: 'institution' | 'platform'; label: string; n: number } | { type: 'insufficient' }
  progress?: { current: number; needed: number }
}

export default function BiasParameterBenchmarkTag({ biasKey, authToken }: { biasKey: string; authToken: string }) {
  const [data, setData] = useState<BiasParameterBenchmarkResponse | null>(null)

  useEffect(() => {
    if (!isInstitutionalModeEnabled() || !authToken) return
    let cancelled = false
    fetch(`/api/institutions/bias-parameter-benchmark?biasKey=${encodeURIComponent(biasKey)}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(res => (res.ok ? res.json() : null))
      .then((json: BiasParameterBenchmarkResponse | null) => { if (!cancelled) setData(json) })
      .catch(() => { if (!cancelled) setData(null) })
    return () => { cancelled = true }
  }, [biasKey, authToken])

  if (!isInstitutionalModeEnabled() || !data) return null

  if (data.scope.type === 'insufficient') {
    if (!data.progress) return null
    return (
      <span style={{
        display: 'inline-flex', padding: '2px 9px', borderRadius: 20,
        border: '1px dashed var(--border-mid)', color: 'var(--text-4)',
        fontSize: 10, fontFamily: 'var(--font-mono)',
      }}>
        {data.progress.current} of {data.progress.needed} needed
      </span>
    )
  }

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 9px', borderRadius: 20,
      border: '1px solid var(--border-dim)', background: 'transparent',
      color: 'var(--text-4)', fontSize: 10, fontFamily: 'var(--font-mono)',
      whiteSpace: 'nowrap',
    }}>
      vs {data.scope.label} (n={data.scope.n})
    </span>
  )
}
