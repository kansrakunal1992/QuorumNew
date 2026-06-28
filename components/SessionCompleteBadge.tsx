'use client'
// SessionCompleteBadge — replaces the disappearing CouncilStatusBar with
// a permanent one-line session timestamp after synthesis completes.

import { DECISION_TYPE_LABELS } from '@/lib/session-labels'

interface Props {
  decisionTypePrimary?: string | null
  completedAt?: Date
}

export default function SessionCompleteBadge({ decisionTypePrimary, completedAt }: Props) {
  const timeStr = (completedAt ?? new Date()).toLocaleTimeString('en-IN', {
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   true,
    timeZone: 'Asia/Kolkata',
  })

  const typeLabel = decisionTypePrimary
    ? (DECISION_TYPE_LABELS[decisionTypePrimary] ?? null)
    : null

  const parts = ['Council complete', typeLabel, '6 advisors', timeStr].filter(Boolean)

  return (
    <p style={{
      fontSize:      11,
      color:         'var(--text-4)',
      letterSpacing: '0.04em',
      margin:        '0 0 10px',
      paddingLeft:   2,
      fontFamily:    'var(--font-mono)',
    }}>
      {parts.join(' · ')}
    </p>
  )
}
