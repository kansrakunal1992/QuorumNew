'use client'
// app/auth/callback/page.tsx
// ── Sprint 6: Magic Link Callback ────────────────────────────────────────────
//
// Supabase redirects here after the user clicks the magic link.
// We:
//   1. Exchange the token for a session
//   2. Link any localStorage session IDs to the authenticated user
//   3. Redirect back to home
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { getStoredSessionIds, storeUserEmail } from '@/lib/storage'

export default function AuthCallback() {
  const router  = useRouter()
  const [status, setStatus] = useState<'processing' | 'linking' | 'done' | 'error'>('processing')

  useEffect(() => {
    const run = async () => {
      try {
        const supabase = createClient()

        // Exchange the auth code/token in the URL hash
        const { data: { session }, error } = await supabase.auth.getSession()
        if (error || !session?.user) {
          setStatus('error')
          setTimeout(() => router.replace('/'), 3000)
          return
        }

        const user = session.user
        setStatus('linking')

        // Persist email for bias library pre-auth context
        storeUserEmail(user.email ?? '')

        // Link any pre-auth session IDs from localStorage
        const storedIds = getStoredSessionIds()
        if (storedIds.length > 0) {
          await fetch('/api/auth/link-sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionIds: storedIds,
              userId:     user.id,
              userEmail:  user.email,
            }),
          })
        }

        setStatus('done')
        router.replace('/')

      } catch (err) {
        console.error('[AuthCallback] Error:', err)
        setStatus('error')
        setTimeout(() => router.replace('/'), 3000)
      }
    }

    run()
  }, [router])

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
