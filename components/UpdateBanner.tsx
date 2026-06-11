'use client'
// components/UpdateBanner.tsx
// ─────────────────────────────────────────────────────────────────────────────
// "New version available — Refresh" banner.
//
// WHY THIS APPROACH (vs. service-worker cache versioning):
// Quorum's sw.js deliberately caches nothing — it only handles push events.
// The classic "SW detects new cache, shows update prompt" flow doesn't apply
// here because there's no cached app shell to go stale.
//
// What CAN go stale: a long-lived tab/PWA window keeps running the JS bundle
// from whenever it was loaded. If the backend API changes shape in a new
// deploy, that old bundle can start hitting endpoints in unexpected ways.
//
// THE FIX: on mount, record the server's current build version (from
// /api/version). Poll periodically + on tab focus. If the server's version
// changes, a new deploy has gone live — show a banner. User taps Refresh →
// hard reload → browser fetches the new HTML + new hashed JS/CSS bundle paths
// (Next.js changes these on every build), so the new code loads cleanly.
//
// Non-intrusive by design: never auto-reloads (would interrupt an in-progress
// decision/voice session). Purely informational until the user acts.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react'

const POLL_INTERVAL_MS = 5 * 60 * 1000  // 5 minutes

export default function UpdateBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const baselineRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function checkVersion() {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json() as { version?: string }
        if (cancelled || !data.version) return

        if (baselineRef.current === null) {
          // First check this page-load — record baseline, don't compare yet
          baselineRef.current = data.version
          return
        }

        if (data.version !== baselineRef.current) {
          setUpdateAvailable(true)
        }
      } catch {
        // Network error / offline — silently retry next interval
      }
    }

    // Initial check on mount
    checkVersion()

    // Periodic poll
    const interval = setInterval(checkVersion, POLL_INTERVAL_MS)

    // Re-check when the tab/PWA regains focus — catches updates that
    // happened while the device was asleep or the app was backgrounded
    function onVisibility() {
      if (document.visibilityState === 'visible') checkVersion()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', checkVersion)

    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', checkVersion)
    }
  }, [])

  if (!updateAvailable) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        padding: '10px 16px',
        paddingTop: 'calc(10px + env(safe-area-inset-top, 0px))',
        background: '#15130a',
        borderBottom: '1px solid #2a2410',
        fontFamily: 'var(--font-sans, DM Sans, sans-serif)',
      }}
      role="status"
    >
      <span style={{ fontSize: 13, color: '#c0b89a' }}>
        A new version of Quorum is available.
      </span>
      <button
        onClick={() => window.location.reload()}
        style={{
          background: '#c9a84c',
          border: 'none',
          borderRadius: 6,
          color: '#0a0a12',
          fontSize: 12,
          fontWeight: 700,
          padding: '5px 14px',
          cursor: 'pointer',
          fontFamily: 'inherit',
          letterSpacing: '0.03em',
          flexShrink: 0,
        }}
      >
        Refresh
      </button>
    </div>
  )
}
