'use client'
// components/PlanBadge.tsx
// ── Global plan identifier (Free / Elite) ────────────────────────────────────
//
// Request: "there should be some identifier on each page telling me as user
// if I am on free or paid Elite plan."
//
// Mounted in the root layout (app/layout.tsx) so it appears on every route —
// same "mount globally, render null when irrelevant" pattern as
// CookieConsent/UpdateBanner/InstitutionModeBadge already use in that file,
// not a new pattern. Renders null for signed-out visitors (gateState
// 'auth') — there's no "plan" to show someone who isn't signed in yet.
//
// Reuses GET /api/mirror/status rather than a new endpoint — it already
// resolves gateState (locked/teaser = free, unlocked = paid) from a single
// source of truth (lib/mirror-access.ts), so this can't drift out of sync
// with what the Mirror page itself shows for the same user.
//
// In-flow strip, not a floating pill — same reasoning as
// InstitutionModeBadge's own layout fix (see that file's doc comment):
// every page has a different top structure, so nothing reserved space for a
// floating badge and it would end up overlapping page content on some
// routes. This reserves its own document height instead.

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import type { MirrorStatus } from '@/lib/types'

async function getAuthToken(): Promise<string | null> {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

export default function PlanBadge() {
  const pathname = usePathname()
  const [status, setStatus] = useState<MirrorStatus | null>(null)

  const load = useCallback(async () => {
    if (pathname === '/') return
    const token = await getAuthToken()
    if (!token) return
    try {
      const res = await fetch('/api/mirror/status', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) setStatus(await res.json() as MirrorStatus)
    } catch {
      // Non-blocking — badge just doesn't render this load
    }
  }, [pathname])

  useEffect(() => {
    load()
    // Bug fix: without this, activating Elite (code or payment) on /mirror
    // left this badge showing "Free plan" until a hard refresh, since this
    // component's own fetch only ever ran once on mount.
    window.addEventListener('quorum:mirror-status-changed', load)
    return () => window.removeEventListener('quorum:mirror-status-changed', load)
  }, [load])

  // UX fix: the home page renders its own plan badge inline in its nav row
  // (see app/page.tsx) instead of this global in-flow strip — as a separate
  // stacked strip above the page's own header, it read as "two header bars"
  // once styled in high-contrast gold for Elite. Every other route is
  // unchanged.
  if (pathname === '/') return null

  // Not signed in, or status hasn't resolved yet → render nothing.
  if (!status || status.gateState === 'auth') return null

  const isPaid = status.gateState === 'unlocked'

  return (
    <div className="plan-badge-strip" style={{
      background:   'var(--bg-card)',
      borderBottom: '1px solid var(--border-dim)',
    }}>
      <Link
        // Bug fix: this always linked to a bare /mirror, which did nothing
        // when the badge is already rendered on the Mirror page itself — no
        // route change means no remount, so nothing scrolled. From any other
        // page, the hash still gets a real navigation + mount, which now
        // scrolls correctly (see useScrollToMirrorCTA in app/mirror/page.tsx).
        // Same isPaid-conditional hash pattern already used elsewhere (see
        // SynthesisCard.tsx). Paid users have nothing to pay for, so their
        // link is unchanged.
        href={isPaid ? '/mirror' : '/mirror#mirror-cta'}
        onClick={e => {
          // Already on /mirror: same fix LockedBadge uses for its own
          // same-page CTA button — scroll directly instead of relying on a
          // route change that won't happen.
          if (!isPaid && pathname === '/mirror') {
            e.preventDefault()
            document.getElementById('mirror-cta')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        }}
        style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          gap:            6,
          width:          '100%',
          padding:        '6px 16px',
          fontSize:       11,
          fontFamily:     'var(--font-mono)',
          fontWeight:     600,
          letterSpacing:  '0.06em',
          textTransform:  'uppercase',
          textDecoration: 'none',
          color:          isPaid ? 'var(--gold)' : 'var(--text-4)',
        }}
      >
        <span style={{
          width:        6,
          height:       6,
          borderRadius: '50%',
          background:   isPaid ? 'var(--gold)' : 'var(--text-4)',
          flexShrink:   0,
        }} />
        <span>{isPaid ? 'Quorum Elite' : 'Free plan'}</span>
        {!isPaid && <span style={{ opacity: 0.6, textTransform: 'none', letterSpacing: 'normal' }}>· Upgrade →</span>}
      </Link>
    </div>
  )
}
