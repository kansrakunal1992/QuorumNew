'use client'

// components/AppNav.tsx
// ── v15 Phase 2: two destinations and one action ─────────────────────────────
//
// Before this there was no app-level navigation at all: the only way from a record or the Mirror back to "my decisions" was
// a Back button, and the only way into the Mirror from home was a link labelled "Sign in" or "{N} decisions".
//
//   Desk     `/`   where the person's open decisions, due check-ins and recent decisions live (the home screen)
//   Mirror   `/mirror`   what Quorum has learned about how they decide
//   + Bring a decision   `/q`   the existing bookmarkable door: opens the home screen with the box focused
//
// The Council is deliberately NOT a tab. It is a room you enter from a decision or from "Bring a decision", not a place you
// return to: a Council tab would only be a second list of the same decisions.
//
// Left-aligned on purpose: the theme toggle is fixed at the top-right of every screen.

import Link from 'next/link'
import { track } from '@/lib/track'

type Current = 'desk' | 'mirror' | 'record' | 'none'

interface Props {
  current?: Current
  /** Where this nav is rendered -- analytics only (nav_clicked.surface). */
  surface:  string
}

const base: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', minHeight: 40, padding: '0 12px', borderRadius: 999,
  fontSize: 13, textDecoration: 'none', fontFamily: 'inherit', letterSpacing: '0.01em',
}

export default function AppNav({ current = 'none', surface }: Props) {
  const item = (to: 'desk' | 'mirror', href: string, label: string) => {
    const active = current === to
    return (
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        onClick={() => track('nav_clicked', { to, surface })}
        style={{
          ...base,
          color: active ? 'var(--text-1)' : 'var(--text-3)',
          background: active ? 'var(--bg-card)' : 'transparent',
          border: `1px solid ${active ? 'var(--border-mid)' : 'transparent'}`,
          fontWeight: active ? 600 : 400,
        }}
      >
        {label}
      </Link>
    )
  }

  return (
    <nav aria-label="Quorum" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, padding: '6px 16px 6px' }}>
      {item('desk', '/', 'Desk')}
      {item('mirror', '/mirror', 'Mirror')}
      <Link
        href="/q"
        onClick={() => track('nav_clicked', { to: 'new', surface })}
        style={{ ...base, color: 'var(--gold)', fontWeight: 600 }}
      >
        + Bring a decision
      </Link>
    </nav>
  )
}
