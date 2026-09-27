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
//
// Bug fix (reported): expanding a card took 3-4 seconds every single time,
// including the second time. Cause: `{open && children}` unmounts the
// wrapped component whenever it collapses — three of the five cards
// (PatternSurfaceCard, MirrorOpenLoopCard, CalibrationRevealCard) fetch
// their own data in a mount-time useEffect, so collapsing threw that fetch
// away, and the next expand started a brand-new one from scratch, with
// nothing shown in between (all three render null while loading — no
// spinner). children are now always mounted, just hidden with `display`
// when collapsed, so: the fetch fires once, as soon as this card is picked
// for the hero (often finished before the person even taps it open), and
// re-opening after a collapse reveals the same already-fetched instance
// instead of re-running its effect. Trade-off worth knowing: this means
// each picked card's fetch now runs whether or not the person ever opens
// it — with at most 2 cards on screen at once, that's a small, worthwhile
// cost for a near-instant expand.

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
      {/* Always mounted (not `{open && ...}`) so the wrapped card's own
          data-fetching effect runs once, the moment this component mounts,
          instead of restarting every time the person re-opens it. Hidden
          with `display: none` rather than left unrendered — that keeps the
          component instance (and whatever it already fetched) alive
          underneath, and `aria-hidden` keeps it out of the accessibility
          tree while collapsed. */}
      <div style={{ display: open ? 'block' : 'none', marginTop: open ? 4 : 0 }} aria-hidden={!open}>
        {children}
      </div>
    </div>
  )
}
