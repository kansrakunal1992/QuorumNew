// components/GraphNudgeLine.tsx
// Sprint QW-3 — the 6+ session counterpart to the sessions-1–5 pictorial
// graph teaser (S1-07). Deliberately NOT a reuse of DecisionGraph — this is
// a single line + link, no d3/force-graph overhead, because by session 6
// the graph itself already has a home (Mirror) and this only needs to say
// "something changed there," not show it again.
//
// Rendered only when the caller (SessionView) has a `show: true` result from
// GET /api/session/[id]/graph-nudge — this component itself does no
// fetching and holds no opinion on whether it SHOULD render, only how.
//
// Copy is deliberately restrained — no exclamation points, no urgency
// language — see item3-4plus-sessions-pov-plan.md section 8 for the
// reasoning (HNI-appropriate register, avoiding mass-market gamification).

import { useState } from 'react'
import Link from 'next/link'

export interface GraphNudgeLineProps {
  variant:      'new-connection' | 'milestone'
  edgeType?:    string
  edgeCount?:   number
  milestone?:   number
  mirrorActive: boolean
}

function copyFor(props: GraphNudgeLineProps): { text: string; showLink: boolean } {
  const { variant, edgeCount, milestone, mirrorActive } = props

  if (variant === 'milestone') {
    if (mirrorActive) {
      return {
        text:     `Your Decision Graph just crossed ${milestone} connections.`,
        showLink: false,
      }
    }
    return {
      text:     `Your Decision Graph has grown to ${edgeCount}+ connections. You're seeing 2 of them.`,
      showLink: true,
    }
  }

  // variant === 'new-connection'
  if (mirrorActive) {
    return {
      text:     'This decision added one new connection to your graph.',
      showLink: false,
    }
  }
  return {
    text:     'A new connection appeared in your Decision Graph.',
    showLink: true,
  }
}

export default function GraphNudgeLine(props: GraphNudgeLineProps) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  const { text, showLink } = copyFor(props)

  return (
    <div
      className="sv-fade"
      style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        gap:            12,
        marginTop:      18,
        paddingTop:     14,
        borderTop:      '1px solid var(--border-dim)',
      }}
    >
      <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0, lineHeight: 1.6 }}>
        {text}
        {showLink && (
          <>
            {'  '}
            <Link href="/mirror" style={{ color: 'var(--gold)', textDecoration: 'none' }}>
              View on Mirror
            </Link>
          </>
        )}
      </p>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        style={{
          background: 'none',
          border:     'none',
          color:      'var(--text-4)',
          fontSize:   14,
          lineHeight: 1,
          cursor:     'pointer',
          padding:    4,
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  )
}
