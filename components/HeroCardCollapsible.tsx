'use client'

// components/HeroCardCollapsible.tsx
// ── Natural Intake hero card collapse (item 6 plan, round 2) ────────────────
//
// Feedback on the first version of the hero stack: showing even 2 of the 5
// Mirror/status cards at full detail still read as crowded — the screen's
// job is "get the person typing," and two full cards above/below that
// competed with it. This wraps each card behind a single summary line
// (title + one short status phrase + a chevron) that expands in place on
// tap. Deliberately not its own bordered box in the collapsed state — a
// plain text row costs far less visual weight than a card, which is the
// actual point; the full card's own existing border/background only
// appears once it's opened.
//
// Does not touch the wrapped card components themselves — MemoryEngineStatus,
// MirrorOpenLoopCard, etc. still render exactly as they do on the classic
// home page once expanded, so nothing about their behavior on HomeClient.tsx
// changes.

import { useState } from 'react'
import type { ReactNode } from 'react'

export type HeroCardStatusDot = 'active' | 'inactive' | 'gold'

interface Props {
  title:       string
  summary:     string
  statusDot?:  HeroCardStatusDot
  defaultOpen?: boolean
  children:    ReactNode
}

const DOT_COLOR: Record<HeroCardStatusDot, string> = {
  active:   'var(--green-text)',
  inactive: 'var(--text-4)',
  gold:     'var(--gold)',
}

export default function HeroCardCollapsible({ title, summary, statusDot, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '9px 2px', background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: 'inherit', textAlign: 'left',
        }}
      >
        {statusDot && (
          <span style={{ width: 6, height: 6, borderRadius: 999, background: DOT_COLOR[statusDot], flexShrink: 0 }} />
        )}
        <span style={{
          fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
          color: 'var(--text-3)', flexShrink: 0, whiteSpace: 'nowrap',
        }}>
          {title}
        </span>
        <span style={{
          fontSize: 11.5, color: 'var(--text-4)', flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {summary}
        </span>
        <svg
          width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{
            color: 'var(--text-4)', flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s',
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div style={{ marginTop: 4 }}>{children}</div>}
    </div>
  )
}
