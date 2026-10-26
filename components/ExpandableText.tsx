'use client'
// components/ExpandableText.tsx
// Shows text clipped by the app (e.g. a stored answer cut at 160 characters, ending in "…") and, when the unclipped
// wording is known, lets the person expand it in place. Nothing is invented: `full` must be the person's own words.

import { useState } from 'react'

interface Props {
  /** What is shown by default (possibly clipped, ending in "…"). */
  text:       string
  /** The unclipped wording, when known. Without it (or if identical) no control is shown. */
  full?:      string | null
  moreLabel?: string
  lessLabel?: string
}

export default function ExpandableText({ text, full, moreLabel = 'Show full answer', lessLabel = 'Show less' }: Props) {
  const [open, setOpen] = useState(false)
  const expandable = !!full && full.trim() !== text.trim()
  return (
    <>
      {open && full ? full : text}
      {expandable && (
        <>
          {' '}
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(o => !o)}
            style={{ background: 'none', border: 'none', padding: '4px 2px', minHeight: 32, fontSize: 13, color: 'var(--text-3)', textDecoration: 'underline', cursor: 'pointer' }}
          >
            {open ? lessLabel : moreLabel}
          </button>
        </>
      )}
    </>
  )
}
