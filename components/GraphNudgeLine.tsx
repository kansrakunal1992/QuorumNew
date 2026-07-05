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
  variant:      'new-connection' | 'milestone' | 'watchlist-suggestion'
  edgeType?:    string
  edgeCount?:   number
  milestone?:   number
  gapText?:     string
  mirrorActive: boolean
  /** Required only for the watchlist-suggestion variant's Add action. */
  authToken?:   string | null
}

function copyFor(props: GraphNudgeLineProps): { text: string; showLink: boolean } {
  const { variant, edgeCount, milestone, mirrorActive, gapText } = props

  if (variant === 'watchlist-suggestion') {
    return { text: `Still open: "${gapText}"`, showLink: false }
  }

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
  const [added,     setAdded]     = useState(false)
  const [adding,    setAdding]    = useState(false)
  if (dismissed) return null

  const { text, showLink } = copyFor(props)
  const isWatchlistSuggestion = props.variant === 'watchlist-suggestion'

  const handleAddToWatchlist = async () => {
    if (!props.authToken || !props.gapText) return
    setAdding(true)
    try {
      const res = await fetch('/api/watchlist', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${props.authToken}` },
        body:    JSON.stringify({ text: props.gapText }),
      })
      if (res.ok) setAdded(true)
    } finally {
      setAdding(false)
    }
  }

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
      {isWatchlistSuggestion && (
        added ? (
          <span style={{ fontSize: 11.5, color: 'var(--gold)', flexShrink: 0, whiteSpace: 'nowrap' }}>
            Added
          </span>
        ) : (
          <button
            className="btn-ghost"
            onClick={handleAddToWatchlist}
            disabled={adding}
            style={{ fontSize: 11, padding: '5px 12px', flexShrink: 0, whiteSpace: 'nowrap' }}
          >
            {adding ? 'Adding…' : 'Add to Watchlist'}
          </button>
        )
      )}
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
