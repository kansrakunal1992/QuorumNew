// components/PendingOutcomesCTA.tsx
// ── Shared "Log Outcomes" CTA (Sprint OUT) ────────────────────────────────────
//
// Fetches GET /api/mirror/pending-outcomes and renders a compact list of the
// user's own oldest open decisions, each linking straight to /record/{id}
// where OutcomeTracker lives. Replaces generic "log outcomes somewhere"
// copy with concrete, personal, one-tap targets.
//
// Used by: components/CalibrationSparkline.tsx (InsufficientState),
//          components/BiasFingerprint.tsx (PersonalTriggerSection empty state)
//
// Self-contained: handles its own loading/empty/error states and renders
// nothing on error or when there's truly nothing pending (caller doesn't
// need to branch on that — this is a "render and forget" CTA).
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { formatShortDate } from '@/lib/dates'
import type { PendingOutcomesResponse, PendingOutcomeSession } from '@/app/api/mirror/pending-outcomes/route'

function daysAgoLabel(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

function PendingRow({ session }: { session: PendingOutcomeSession }) {
  return (
    <Link
      href={`/record/${session.session_id}`}
      style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        gap:            10,
        textDecoration: 'none',
        padding:        '8px 10px',
        marginTop:      5,
        background:     'var(--bg-inset)',
        border:         '1px solid var(--border-dim)',
        borderRadius:   7,
      }}
    >
      <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.4, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        "{session.decision_text}{session.decision_text.length >= 90 ? '…' : ''}"
      </span>
      <span style={{ fontSize: 9.5, color: 'var(--text-4)', whiteSpace: 'nowrap' }}>
        {daysAgoLabel(session.days_ago)}
      </span>
      <span style={{ fontSize: 9.5, color: 'var(--gold)', fontWeight: 600, whiteSpace: 'nowrap' }}>
        Log outcome →
      </span>
    </Link>
  )
}

interface Props {
  authToken: string
  /** Optional intro line shown above the list — caller controls the framing per-module. */
  introText?: string
}

export default function PendingOutcomesCTA({ authToken, introText }: Props) {
  const [data, setData]       = useState<PendingOutcomesResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!authToken) { setLoading(false); return }
    let cancelled = false

    fetch('/api/mirror/pending-outcomes', {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(res => res.ok ? res.json() as Promise<PendingOutcomesResponse> : null)
      .then(json => { if (!cancelled) setData(json) })
      .catch(() => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [authToken])

  if (loading || !data || data.sessions.length === 0) return null

  const shown    = data.sessions.slice(0, 3)
  const moreCount = data.totalPending - shown.length

  return (
    <div style={{ marginTop: 14 }}>
      <p style={{ fontSize: 11.5, color: 'var(--text-3)', margin: '0 0 2px', lineHeight: 1.5, fontWeight: 600 }}>
        {introText ?? 'Pick one and log what actually happened:'}
      </p>
      {shown.map(s => <PendingRow key={s.session_id} session={s} />)}
      {moreCount > 0 && (
        <p style={{ fontSize: 10.5, color: 'var(--text-4)', margin: '6px 0 0' }}>
          +{moreCount} more decision{moreCount !== 1 ? 's' : ''} waiting on an outcome.
        </p>
      )}
    </div>
  )
}
