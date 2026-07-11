// components/ReferralLink.tsx
// Item #17 — plain referral link, no rewards/incentive mechanics yet (per
// the working decision on this item). Deliberately small and low-key —
// placed at the very end of the home page, not competing with anything.

'use client'

import { useState } from 'react'

export default function ReferralLink({ userId }: { userId: string }) {
  const [copied, setCopied] = useState(false)
  const link = typeof window !== 'undefined'
    ? `${window.location.origin}/?ref=${userId}`
    : ''

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  return (
    <div style={{
      marginTop: 28, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12, flexWrap: 'wrap', padding: '14px 16px', borderRadius: 10,
      border: '1px solid var(--border-dim)', background: 'var(--bg-card-alt)',
    }}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-3)' }}>
        Know someone this would help? Share your link.
      </p>
      <button
        onClick={copy}
        className="btn-ghost"
        style={{ fontSize: 12, padding: '6px 14px', flexShrink: 0 }}
      >
        {copied ? 'Copied' : 'Copy invite link'}
      </button>
    </div>
  )
}
