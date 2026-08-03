'use client'
// components/BiasNoteCard.tsx
// Sprint: Item A — first-session bias feedback
//
// Surfaces a single, plain-English bias note for the decision the user just
// brought — server-rendered, no Mirror subscription required, works from
// session 1. This closes the "dead zone" between the moment of peak
// engagement (right after synthesis) and the next time bias feedback would
// otherwise surface (homepage teaser pill, next visit, or Mirror unlock).
//
// Deliberately scoped:
//   - Shows at most ONE bias note (the strongest signal for this session)
//   - Only surfaces signal_type === 'distorting' detections — neutral/adaptive
//     classifications are not shown here; they aren't a "watch out" moment
//   - No detection_count threshold — this is per-session feedback, not a
//     longitudinal "confirmed pattern" claim (that's Mirror's job)
//   - Purely presentational; all data is computed server-side in
//     app/record/[id]/page.tsx and passed in as a prop

import { useState, useEffect, useRef } from 'react'

interface Props {
  note: {
    label:     string
    reasoning: string
  } | null
}

export default function BiasNoteCard({ note }: Props) {
  const [expanded, setExpanded] = useState(false)
  // Bug fix (user report: "still not showing 'See More' and is truncated"):
  // whether the 3-line clamp below actually cuts the text off used to be
  // guessed from a fixed `note.reasoning.length > 220` character count. Line
  // wrapping depends on rendered width and font size, not raw character
  // count, so reasoning text under 220 chars could still get visually
  // clamped (word wrap eating a line early) with no "Show more" button
  // available to un-clamp it. Measuring the actual rendered overflow instead
  // makes this correct regardless of viewport width or how the text wraps.
  const [isTruncated, setIsTruncated] = useState(false)
  const textRef = useRef<HTMLParagraphElement>(null)

  // Reset expand state if the note itself changes, so a stale "expanded"
  // from a previous note doesn't skip the clamped measurement below for
  // the new one.
  useEffect(() => {
    setExpanded(false)
  }, [note?.reasoning])

  useEffect(() => {
    if (expanded) return // not clamped while expanded — nothing to measure
    const el = textRef.current
    if (!el) return
    setIsTruncated(el.scrollHeight - el.clientHeight > 1)
  }, [expanded, note?.reasoning])

  if (!note) return null

  return (
    <>
      <style>{`
        @keyframes bias-pulse {
          0%   { box-shadow: 0 0 0 0   rgba(201,138,76,0.55); }
          60%  { box-shadow: 0 0 0 6px rgba(201,138,76,0.08); }
          100% { box-shadow: 0 0 0 8px rgba(201,138,76,0);    }
        }
        .bias-dot {
          animation: bias-pulse 2s ease-out infinite;
        }
      `}</style>
      <div style={{
      borderRadius: 12,
      padding:      '13px 18px',
      background:   'var(--bg-card)',
      border:       '1px solid var(--border-subtle)',
      display:      'flex',
      gap:          12,
      alignItems:   'flex-start',
    }}>
        {/* Amber pulsating dot */}
        <div
          className="bias-dot"
          style={{
        width:        7,
        height:       7,
        borderRadius: '50%',
        background:   'var(--amber-dot)',
        marginTop:    5,
        flexShrink:   0,
        }}
        />
      <div>
        {/* S3-06: intro label — makes the card's appearance feel deliberate,
            not accidental. Materializing with no framing previously read as a glitch. */}
        <p style={{
          fontSize:      10,
          fontWeight:    700,
          letterSpacing: '0.11em',
          textTransform: 'uppercase',
          color:         'var(--text-4)',
          margin:        '0 0 5px',
        }}>
          Noticed in this session
        </p>
        <p style={{
          fontSize:   12.5,
          fontWeight: 600,
          color:      'var(--text-2)',
          margin:     '0 0 3px',
          lineHeight: 1.4,
        }}>
          {note.label} was flagged in this analysis.
        </p>
        <p
          ref={textRef}
          style={expanded ? {
          fontSize:   12,
          color:      'var(--text-4)',
          margin:     0,
          lineHeight: 1.55,
        } : {
          fontSize:       12,
          color:          'var(--text-4)',
          margin:         0,
          lineHeight:     1.55,
          display:        '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical' as const,
          overflow:       'hidden',
        }}>
          {note.reasoning}
        </p>
        {isTruncated && (
          <button
            onClick={() => setExpanded(v => !v)}
            style={{
              marginTop:     4,
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
            }}
          >
            {expanded ? '↑ Show less' : '↓ Show more'}
          </button>
        )}
      </div>
    </div>
    </>
  )
}
