'use client'
// app/auth/callback/page.tsx
// ── Sprint 6: Magic Link Callback ────────────────────────────────────────────
//
// Supabase redirects here after the user clicks the magic link.
// We:
//   1. Exchange the PKCE code from ?code= query param for a session
//   2. Link any localStorage session IDs to the authenticated user
//   3. Redirect back to home
//
// FIX (Sprint 6 bug): Supabase v2 uses PKCE by default. The magic link
// redirects to /auth/callback?code=PKCE_CODE. getSession() alone returns null
// because the code hasn't been exchanged yet. Must call
// exchangeCodeForSession(code) first, then getSession().
//
// Also: useSearchParams() requires a Suspense boundary in Next.js 15 — the
// inner component reads params; the default export wraps it.
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
        // Supabase PKCE flow delivers ?code=... (not a hash token).
        // exchangeCodeForSession() must be called before getSession() has anything.
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

        // ── Step 3: Link any pre-auth session IDs from localStorage ──────────
        const storedIds = getStoredSessionIds()
        const deviceId  = getStoredDeviceId()   // ← needed to retro-link device_id bias rows

        // Always call link-sessions after auth — even if storedIds is empty.
        // The deviceId retro-link in link-sessions upgrades anonymous bias rows
        // (device_id-keyed, no email) to the authenticated user_id lane.
        await fetch('/api/auth/link-sessions', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionIds: storedIds,
            userId:     user.id,
            userEmail:  user.email,
            deviceId:   deviceId,   // ← new: triggers device_id bias retro-link
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
