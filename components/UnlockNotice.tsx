'use client'
// components/UnlockNotice.tsx
// Institutional Sprint 5 (task 5) — quiet, one-time toast when a benchmark
// panel unlocks for the first time. firstUnlock comes from the benchmark
// API response (lib/unlock-notices.ts already handled the "only once, ever,
// across devices" logic server-side) — this component just renders it and
// dismisses, no state of its own to track "have I shown this before."

import { useState, useEffect } from 'react'

interface Props {
  show: boolean
  label: string   // e.g. "Product @ Acme" or "Platform"
}

export default function UnlockNotice({ show, label }: Props) {
  const [visible, setVisible] = useState(show)

  useEffect(() => {
    if (!show) return
    setVisible(true)
    const t = setTimeout(() => setVisible(false), 6000)
    return () => clearTimeout(t)
  }, [show])

  if (!visible) return null

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9200,
      maxWidth: 300, padding: '12px 16px', borderRadius: 12,
      background: 'var(--bg-card)', border: '1px solid var(--gold-dim)',
      boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
    }}>
      <p style={{ fontSize: 12, color: 'var(--gold)', margin: '0 0 2px', fontWeight: 600 }}>
        New benchmark unlocked
      </p>
      <p style={{ fontSize: 11.5, color: 'var(--text-3)', margin: 0 }}>
        Enough participants now — you can see how you compare vs. {label}.
      </p>
    </div>
  )
}
