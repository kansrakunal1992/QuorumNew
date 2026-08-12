'use client'
// components/VisitorCounter.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Small persistent "N people already here" social-proof pill. Real count,
// backed by supabase/add_visitor_counter.sql, seeded at 150. Each browser
// increments the shared total exactly once, on its very first-ever load
// (guarded by a localStorage flag) — every load after that just reads it.
//
// POSITIONING — deliberately bottom-left, chosen to avoid every other fixed
// element already in this app:
//   - NOT top-right: .theme-toggle owns that (globals.css, top:18/right:20)
//   - NOT bottom-right: UnlockNotice owns that (bottom:24/right:24)
//   - z-index 500: above normal page/nav content (z-index up to ~200) but
//     below every modal/drawer/overlay in the app (all >= 9000 — cookie
//     consent, onboarding tour, session drawers, etc.), so those always
//     correctly render on top of this, never the reverse.
//   - pointer-events: none (see globals.css) — purely informational, so it
//     can never intercept a tap/click even if it visually sits near
//     something interactive.
//   - Auto-hides whenever the app footer scrolls into view (see the
//     IntersectionObserver below) — the footer is in-flow, not fixed, so on
//     short pages it can scroll up into this pill's bottom-left corner;
//     hiding on intersection means it never visually overlaps a footer link,
//     on any screen size, without hardcoding a footer height that would
//     drift out of sync the moment the footer's content changes.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'quorum_visitor_counted'

export default function VisitorCounter() {
  const [count, setCount] = useState<number | null>(null)
  const [footerVisible, setFooterVisible] = useState(false)

  // ── Load / increment the count ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    async function load() {
      let alreadyCounted = true
      try { alreadyCounted = localStorage.getItem(STORAGE_KEY) === '1' } catch { /* ignore */ }

      try {
        const res = await fetch('/api/visitor-count', {
          method: alreadyCounted ? 'GET' : 'POST',
          cache: 'no-store',
        })
        if (!res.ok) return
        const data = (await res.json()) as { count?: number }
        if (cancelled || typeof data.count !== 'number') return

        setCount(data.count)
        if (!alreadyCounted) {
          try { localStorage.setItem(STORAGE_KEY, '1') } catch { /* ignore */ }
        }
      } catch {
        // Network error / offline — render nothing rather than a wrong number
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  // ── Hide while the app footer is in view, so this never overlaps it ────
  useEffect(() => {
    const footer = document.querySelector('footer')
    if (!footer || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      ([entry]) => setFooterVisible(entry.isIntersecting),
      { threshold: 0 },
    )
    observer.observe(footer)
    return () => observer.disconnect()
  }, [])

  if (count === null) return null

  return (
    <div
      className="visitor-counter"
      style={{ opacity: footerVisible ? 0 : 1 }}
      role="status"
      aria-hidden={footerVisible}
      aria-label={`${count.toLocaleString('en-IN')} people have used Quorum`}
    >
      <span className="visitor-counter-dot" />
      <span>{count.toLocaleString('en-IN')} people already here</span>
    </div>
  )
}
