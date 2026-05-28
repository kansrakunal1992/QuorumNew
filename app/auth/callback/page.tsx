'use client'
// app/auth/callback/page.tsx
// ── Sprint 6 + 6b: Magic Link Callback ───────────────────────────────────────
//
// Supabase redirects here after the user clicks the magic link.
//
// Sprint 6b: Cross-browser session recovery.
// The magic link URL now carries ?xd=<deviceId>&xs=<sessionIds> params embedded
// by /api/auth at send time. When the link is clicked in a different browser
// (email client, mobile WebView, etc.), localStorage is empty — but these URL
// params carry the originating browser's identity. The callback merges both
// sources and passes the combined payload to link-sessions so ALL prior anonymous
// sessions are linked regardless of which browser the link is opened in.
//
// Identity merge priority:
//   1. Explicit session IDs from URL params (?xs=...)  ← cross-browser recovery
//   2. Session IDs from localStorage                   ← same-browser, most common
//   3. Device ID from URL params (?xd=...)             ← cross-browser recovery
//   4. Device ID from localStorage                     ← same-browser fallback
// ─────────────────────────────────────────────────────────────────────────────

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { getStoredSessionIds, storeUserEmail, getStoredDeviceId } from '@/lib/storage'

// ── Inner component — reads URL params (requires Suspense parent) ─────────────
function CallbackHandler() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<'processing' | 'linking' | 'done' | 'error'>('processing')

  useEffect(() => {
    const run = async () => {
      try {
        const supabase = createClient()

        // ── Step 1: Exchange PKCE code for a session ──────────────────────────
        const code  = searchParams.get('code')
        const error = searchParams.get('error')

        if (error) {
          console.error('[AuthCallback] URL error param:', error, searchParams.get('error_description'))
          setStatus('error')
          setTimeout(() => router.replace('/'), 3000)
          return
        }

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) {
            console.error('[AuthCallback] Code exchange failed:', exchangeError)
            setStatus('error')
            setTimeout(() => router.replace('/'), 3000)
            return
          }
        }

        // ── Step 2: Read the now-valid session ────────────────────────────────
        const { data: { session }, error: sessionError } = await supabase.auth.getSession()
        if (sessionError || !session?.user) {
          console.error('[AuthCallback] No session after exchange:', sessionError)
          setStatus('error')
          setTimeout(() => router.replace('/'), 3000)
          return
        }

        const user = session.user
        setStatus('linking')

        // Persist email for bias library pre-auth context
        storeUserEmail(user.email ?? '')

        // ── Step 3: Build merged identity payload ─────────────────────────────
        // Source A: localStorage (populated when magic link opened in SAME browser)
        const localSessionIds = getStoredSessionIds()
        const localDeviceId   = getStoredDeviceId()

        // Source B: URL params embedded by /api/auth at send time
        // These are present when the link is opened in a DIFFERENT browser
        // (email client, mobile WebView) where localStorage is empty.
        const urlDeviceId      = searchParams.get('xd') ?? null
        const urlSessionIdsRaw = searchParams.get('xs') ?? ''
        const urlSessionIds    = urlSessionIdsRaw
          ? urlSessionIdsRaw.split(',').filter(s => s.length > 10) // basic sanity check
          : []

        // Merge: deduplicated union of both sources
        const allSessionIds = [...new Set([...localSessionIds, ...urlSessionIds])]

        // For device_id: URL param is the originating browser's device — use it
        // even if localStorage has a different (or no) device ID.
        // Pass both so link-sessions can update sessions rows for either device.
        const deviceIds = [...new Set([localDeviceId, urlDeviceId].filter(Boolean))] as string[]

        console.log(`[AuthCallback] Linking: ${allSessionIds.length} sessions, deviceIds=[${deviceIds.join(',')}]`)
        console.log(`[AuthCallback]   local: ${localSessionIds.length} sessions, device=${localDeviceId}`)
        console.log(`[AuthCallback]   url:   ${urlSessionIds.length} sessions, device=${urlDeviceId}`)

        // ── Step 4: Link all recovered sessions to the authenticated user ─────
        await fetch('/api/auth/link-sessions', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionIds: allSessionIds,   // explicit IDs to link via RPC
            userId:     user.id,
            userEmail:  user.email,
            deviceIds,                   // device IDs for DB-level session lookup
          }),
        })

        setStatus('done')
        router.replace('/')

      } catch (err) {
        console.error('[AuthCallback] Error:', err)
        setStatus('error')
        setTimeout(() => router.replace('/'), 3000)
      }
    }

    run()
  }, [router, searchParams])

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-void)', padding: 20 }}>
      <div style={{ textAlign: 'center', maxWidth: 360 }}>
        <div style={{ fontSize: 28, marginBottom: 16 }}>
          {status === 'error' ? '✕' : '⟳'}
        </div>
        <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 8 }}>
          {status === 'processing' && 'Verifying your link…'}
          {status === 'linking'    && 'Linking your sessions…'}
          {status === 'done'       && 'Authenticated. Redirecting…'}
          {status === 'error'      && 'Something went wrong. Redirecting to home…'}
        </p>
        {status !== 'error' && (
          <p style={{ fontSize: 11, color: 'var(--text-4)' }}>
            Your decision history is being connected across devices.
          </p>
        )}
      </div>
    </main>
  )
}

// ── Loading shell shown while CallbackHandler hydrates ───────────────────────
function CallbackLoading() {
  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-void)', padding: 20 }}>
      <div style={{ textAlign: 'center', maxWidth: 360 }}>
        <div style={{ fontSize: 28, marginBottom: 16 }}>⟳</div>
        <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 8 }}>
          Verifying your link…
        </p>
      </div>
    </main>
  )
}

// ── Default export — wraps in Suspense (required by Next.js 15) ───────────────
export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<CallbackLoading />}>
      <CallbackHandler />
    </Suspense>
  )
}
