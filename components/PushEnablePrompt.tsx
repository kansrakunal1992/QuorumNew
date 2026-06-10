'use client'
// components/PushEnablePrompt.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Subtle notification opt-in prompt for logged-in users with ≥1 session.
//
// Behaviour matrix:
//   • Not supported (browser too old / HTTP)     → render nothing
//   • Permission already denied                  → render nothing
//   • Already subscribed                         → render nothing
//   • Dismissed within last 14 days              → render nothing
//   • iOS, not running as standalone PWA         → show "Add to Home Screen" tip
//   • Ready to subscribe (Android / Desktop)     → show "Enable notifications" button
//
// On enable click:
//   1. Register service worker (/sw.js)
//   2. Request Notification permission
//   3. Subscribe via pushManager with VAPID public key
//   4. POST subscription to /api/push/subscribe
//   5. Mark subscribed in localStorage (suppress future prompts)
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react'

const DISMISS_KEY   = 'quorum_push_dismissed_at'
const SUBSCRIBED_KEY = 'quorum_push_subscribed'
const DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000  // 14 days

type PromptState = 'idle' | 'ios-tip' | 'enable' | 'loading' | 'done' | 'hidden'

// Convert URL-safe base64 VAPID public key to Uint8Array for pushManager.subscribe()
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw     = window.atob(base64)
  const buffer  = new ArrayBuffer(raw.length)
  const output  = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

interface Props {
  authToken: string | null
}

export default function PushEnablePrompt({ authToken }: Props) {
  const [state, setState] = useState<PromptState>('idle')

  useEffect(() => {
    // Must be client-side
    if (typeof window === 'undefined') return

    // ── 1. Browser support check ─────────────────────────────────────────
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('hidden')
      return
    }

    // ── 2. Already subscribed (stored in localStorage) ───────────────────
    if (localStorage.getItem(SUBSCRIBED_KEY) === '1') {
      setState('hidden')
      return
    }

    // ── 3. Permission already denied ─────────────────────────────────────
    if (Notification.permission === 'denied') {
      setState('hidden')
      return
    }

    // ── 4. Dismissed within TTL ──────────────────────────────────────────
    const dismissedAt = localStorage.getItem(DISMISS_KEY)
    if (dismissedAt && Date.now() - parseInt(dismissedAt, 10) < DISMISS_TTL_MS) {
      setState('hidden')
      return
    }

    // ── 5. iOS: must be in standalone mode for push to work ───────────────
    const isIOS        = /iPad|iPhone|iPod/.test(navigator.userAgent)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                         // eslint-disable-next-line @typescript-eslint/no-explicit-any
                         (navigator as any).standalone === true
    if (isIOS && !isStandalone) {
      setState('ios-tip')
      return
    }

    // ── 6. Ready to prompt ────────────────────────────────────────────────
    setState('enable')
  }, [])

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
    setState('hidden')
  }

  async function handleEnable() {
    setState('loading')

    try {
      // Register SW
      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready

      // Request permission
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState('enable')  // user said no — keep the prompt visible but reset
        return
      }

      // Subscribe to push
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!vapidKey) {
        console.error('[PushEnablePrompt] NEXT_PUBLIC_VAPID_PUBLIC_KEY not set')
        setState('hidden')
        return
      }

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      })

      // Send to server
      const res = await fetch('/api/push/subscribe', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(subscription.toJSON()),
      })

      if (!res.ok) {
        console.error('[PushEnablePrompt] Server subscribe failed:', res.status)
        setState('enable')
        return
      }

      localStorage.setItem(SUBSCRIBED_KEY, '1')
      setState('done')

      // Auto-hide after 3s
      setTimeout(() => setState('hidden'), 3000)

    } catch (err) {
      console.error('[PushEnablePrompt] Subscribe error:', err)
      setState('enable')
    }
  }

  if (state === 'hidden' || state === 'idle') return null

  // ── iOS tip (not in standalone mode) ────────────────────────────────────
  if (state === 'ios-tip') {
    return (
      <div style={{
        marginTop: 16,
        padding: '14px 16px',
        background: '#0f0f0f',
        border: '1px solid #1e1e1e',
        borderRadius: 10,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        position: 'relative',
      }}>
        <span style={{ fontSize: 18, lineHeight: 1, marginTop: 1 }}>📲</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: '0 0 3px', fontSize: 13, fontWeight: 600, color: '#c0b89a', fontFamily: 'var(--font-sans, DM Sans, sans-serif)' }}>
            Enable notifications
          </p>
          <p style={{ margin: 0, fontSize: 12, color: '#666', lineHeight: 1.55 }}>
            Tap <strong style={{ color: '#888' }}>Share</strong> → <strong style={{ color: '#888' }}>Add to Home Screen</strong>, then open from there to receive nudges on open decisions.
          </p>
        </div>
        <button
          onClick={handleDismiss}
          aria-label="Dismiss"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#444', fontSize: 16, padding: '2px 4px', lineHeight: 1, flexShrink: 0 }}
        >
          ×
        </button>
      </div>
    )
  }

  // ── Success state ────────────────────────────────────────────────────────
  if (state === 'done') {
    return (
      <div style={{
        marginTop: 16,
        padding: '12px 16px',
        background: '#0c1a0e',
        border: '1px solid #1a3320',
        borderRadius: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <span style={{ color: '#4caf72', fontSize: 15 }}>✓</span>
        <p style={{ margin: 0, fontSize: 13, color: '#4caf72' }}>
          Notifications enabled — you'll be nudged when open decisions need closure.
        </p>
      </div>
    )
  }

  // ── Enable prompt (Android / Desktop) ────────────────────────────────────
  return (
    <div style={{
      marginTop: 16,
      padding: '14px 16px',
      background: '#0f0f0f',
      border: '1px solid #1e1e1e',
      borderRadius: 10,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      position: 'relative',
    }}>
      <span style={{ fontSize: 17, lineHeight: 1, flexShrink: 0 }}>🔔</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 600, color: '#c0b89a', fontFamily: 'var(--font-sans, DM Sans, sans-serif)' }}>
          Get nudged on open decisions
        </p>
        <p style={{ margin: 0, fontSize: 12, color: '#666', lineHeight: 1.5 }}>
          A single notification at 7, 14, and 30 days — nothing else.
        </p>
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          onClick={handleDismiss}
          style={{
            background: 'none',
            border: '1px solid #2a2a2a',
            borderRadius: 6,
            color: '#555',
            fontSize: 12,
            padding: '6px 10px',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Not now
        </button>
        <button
          onClick={handleEnable}
          disabled={state === 'loading'}
          style={{
            background: state === 'loading' ? '#1a1600' : '#c9a84c',
            border: 'none',
            borderRadius: 6,
            color: state === 'loading' ? '#c9a84c' : '#0a0a12',
            fontSize: 12,
            fontWeight: 700,
            padding: '6px 14px',
            cursor: state === 'loading' ? 'default' : 'pointer',
            fontFamily: 'inherit',
            letterSpacing: '0.03em',
            minWidth: 70,
          }}
        >
          {state === 'loading' ? '…' : 'Enable'}
        </button>
      </div>
    </div>
  )
}
