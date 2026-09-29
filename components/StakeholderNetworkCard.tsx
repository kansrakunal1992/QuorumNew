'use client'

// components/StakeholderNetworkCard.tsx
// ── Stakeholder network summary (Phase 5, v3) ─────────────────────────────────
//
// Plan section 16: "You consulted Sarah in 8 major decisions, and her input
// was reflected in your final decision in 5" — observable history only, no
// psychological framing. Not wired into app/mirror/page.tsx in this drop
// (see docs/CHANGELOG_v3.md) — a standalone component ready to drop in
// wherever the other Mirror cards (PatternSurfaceCard, CalibrationRevealCard)
// are composed, once you've seen it against real data.

import { useEffect, useState } from 'react'

interface Entry {
  stakeholderId:   string
  name:            string
  consultedCount:  number
  reflectedCount:  number
}

export default function StakeholderNetworkCard({ authToken }: { authToken: string | null }) {
  const [entries, setEntries] = useState<Entry[] | null>(null)

  useEffect(() => {
    if (!authToken) return
    fetch('/api/stakeholder-network/summary', { headers: { Authorization: `Bearer ${authToken}` } })
      .then(r => r.json())
      .then(d => setEntries(d.entries ?? []))
      .catch(() => setEntries([]))
  }, [authToken])

  if (!entries?.length) return null

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: 18, padding: 20 }}>
      <div style={{ fontSize: 15, color: 'var(--text-1)', marginBottom: 14 }}>Who you consult</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {entries.slice(0, 6).map(e => (
          <div key={e.stakeholderId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
            <span style={{ color: 'var(--text-2)' }}>{e.name}</span>
            <span style={{ color: 'var(--text-4)' }}>
              {e.consultedCount === 1 ? 'consulted once' : `consulted ${e.consultedCount} times`}
              {e.reflectedCount > 0 ? ` · reflected in ${e.reflectedCount}` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
