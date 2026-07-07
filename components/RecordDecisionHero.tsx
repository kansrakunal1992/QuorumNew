'use client'
// components/RecordDecisionHero.tsx
//
// Bug fix: the record page rendered decision_text/context_text in full, with
// no expand/collapse at all — unlike SessionView (app's session/[id] page),
// which clamps long decision/context text and offers a "↓ Show more" toggle.
// The CSS scaffolding for this was already sitting in app/record/[id]/page.tsx
// (.rec-hero-decision, the "no overflow:hidden — same Android WebKit
// line-clamp sibling clipping bug as sv-hero" comment) but the actual
// clamp + toggle was never wired up — the record page is an async Server
// Component, so it can't hold the expanded/collapsed useState itself. This
// extracts just that interactive piece into a small client component, using
// the exact same thresholds and line-clamp values as SessionView.tsx
// (decision: 4 lines / 220 chars, context: 2 lines / 120 chars) so long
// decisions look and behave identically on both pages.

import { useState } from 'react'

interface Props {
  decisionText: string
  contextText:  string | null
}

const toggleButtonStyle: React.CSSProperties = {
  marginTop:     6,
  display:       'block',
  minHeight:     28,
  fontSize:      11,
  color:         'var(--text-4)',
  background:    'none',
  border:        'none',
  cursor:        'pointer',
  padding:       '4px 0',
  fontFamily:    'var(--font-mono)',
  letterSpacing: '0.05em',
}

export default function RecordDecisionHero({ decisionText, contextText }: Props) {
  const [decisionExpanded, setDecisionExpanded] = useState(false)
  const [contextExpanded,  setContextExpanded]  = useState(false)

  return (
    <>
      <p
        className="rec-hero-decision"
        style={decisionExpanded ? {} : {
          display: '-webkit-box',
          WebkitLineClamp: 4,
          WebkitBoxOrient: 'vertical' as const,
          overflow: 'hidden',
        }}
      >
        {decisionText}
      </p>
      {decisionText.length > 220 && (
        <button onClick={() => setDecisionExpanded(v => !v)} style={toggleButtonStyle}>
          {decisionExpanded ? '↑ Show less' : '↓ Show more'}
        </button>
      )}

      {contextText && (
        <>
          <div className="gold-rule" style={{ margin: '14px 0' }} />
          <p style={{
            fontFamily:    'var(--font-mono)',
            fontSize:      9.5,
            letterSpacing: '0.13em',
            textTransform: 'uppercase',
            color:         'var(--text-4)',
            marginBottom:  6,
          }}>
            Context
          </p>
          <p
            className="rec-hero-context"
            style={contextExpanded ? {} : {
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical' as const,
              overflow: 'hidden',
            }}
          >
            {contextText}
          </p>
          {contextText.length > 120 && (
            <button onClick={() => setContextExpanded(v => !v)} style={toggleButtonStyle}>
              {contextExpanded ? '↑ Show less' : '↓ Show more'}
            </button>
          )}
        </>
      )}
    </>
  )
}
