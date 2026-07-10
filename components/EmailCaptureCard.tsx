'use client'

// components/EmailCaptureCard.tsx
// Sprint: Second-use email capture
//
// Shown on the record page immediately after BriefCTA for users who haven't
// linked an email yet. Framed around the specific decision just made, not
// generic account creation. Calls the existing /api/auth magic-link endpoint.
//
// Hidden automatically if:
//   - quorum_user_email already in localStorage (user is linked)
//   - user dismissed during this session (sessionStorage flag)
//   - a link was already sent this session and is awaiting click (sessionStorage flag)
//
// Bug fix (2026-07): this card used to write quorum_user_email to localStorage
// as soon as the magic link was *sent*, not once it was actually clicked and
// verified. quorum_user_email is documented everywhere else (lib/storage.ts,
// app/auth/callback/page.tsx) as a post-auth-only signal — app/page.tsx reads
// it to decide whether to show the "Sessions linked to X" badge and whether to
// send the auth token to /api/history. Setting it early made the home page
// claim the account was linked (and only show local-device sessions) while
// the Watchlist teaser — correctly gated on the real authToken — still showed
// "Unlock", producing a contradictory UI. Only app/auth/callback/page.tsx
// (via storeUserEmail(), after Supabase verifies the session) should ever
// write that key. This card now uses its own session-scoped "pending" flag
// instead, so it still avoids re-prompting within the same session.

import { useState, useEffect } from 'react'
import { getStoredSessionIds, getStoredDeviceId } from '@/lib/storage'

interface Props {
  sessionId: string
}

type State = 'idle' | 'sending' | 'sent'

export default function EmailCaptureCard({ sessionId }: Props) {
  const [visible, setVisible] = useState(false)
  const [email,   setEmail]   = useState('')
  const [state,   setState]   = useState<State>('idle')
  const [error,   setError]   = useState('')

  // Check localStorage/sessionStorage on mount — hide if already linked,
  // dismissed, or a link was already sent this session and hasn't been
  // clicked yet (avoids re-nagging without falsely claiming linkage).
  useEffect(() => {
    try {
      const linked   = !!localStorage.getItem('quorum_user_email')
      const dismissed = !!sessionStorage.getItem('quorum_brief_email_dismissed')
      const pending   = !!sessionStorage.getItem('quorum_brief_email_pending')
      if (!linked && !dismissed && !pending) setVisible(true)
    } catch {
      // localStorage unavailable — don't show
    }
  }, [])

  if (!visible) return null

  const handleDismiss = () => {
    try { sessionStorage.setItem('quorum_brief_email_dismissed', '1') } catch {}
    setVisible(false)
  }

  const handleSend = async () => {
    const trimmed = email.trim()
    if (!trimmed || !trimmed.includes('@')) {
      setError('Enter a valid email address.')
      return
    }
    setState('sending')
    setError('')
    try {
      const sessionIds = getStoredSessionIds()
      // Include current session in case it wasn't pushed to localStorage yet
      const ids = sessionIds.includes(sessionId)
        ? sessionIds
        : [sessionId, ...sessionIds]

      const res = await fetch('/api/auth', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          email:      trimmed,
          deviceId:   getStoredDeviceId() ?? undefined,
          sessionIds: ids.slice(0, 40),
        }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok || data.error) {
        setState('idle')
        setError(data.error ?? 'Something went wrong. Try again.')
        return
      }
      setState('sent')
      // Mark pending (NOT linked) so this card doesn't re-prompt for the rest
      // of this session while the link is unclicked. The actual
      // quorum_user_email key is only ever set post-verification, in
      // app/auth/callback/page.tsx.
      try { sessionStorage.setItem('quorum_brief_email_pending', '1') } catch {}
    } catch {
      setState('idle')
      setError('Something went wrong. Try again.')
    }
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSend()
  }

  return (
    <div
      data-tour-id="record-email-link"
      style={{
        borderRadius:   14,
        padding:        '18px 22px',
        background:     'var(--bg-card)',
        border:         '1px solid var(--border-mid)',
        position:       'relative',
        overflow:       'hidden',
      }}
    >
      {/* Subtle left accent */}
      <div style={{
        position:   'absolute',
        top: 0, left: 0,
        width:      2,
        height:     '100%',
        background: 'linear-gradient(180deg, var(--gold-dim) 0%, transparent 100%)',
      }} />

      {state === 'sent' ? (
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', margin: '0 0 4px' }}>
            Check your inbox
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-4)', margin: 0, lineHeight: 1.55 }}>
            We sent a link to <span style={{ color: 'var(--text-2)' }}>{email.trim()}</span>.
            Click it to link your decisions and activate pattern memory.
          </p>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <p style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-2)', margin: '0 0 3px' }}>
                Want us to check back on this?
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-4)', margin: 0, lineHeight: 1.55 }}>
                Leave your email and we&apos;ll bring this decision back to you in two weeks with a fresh perspective.
              </p>
            </div>
            <button
              onClick={handleDismiss}
              aria-label="Dismiss"
              style={{
                background: 'none', border: 'none', padding: '0 0 0 12px',
                fontSize: 16, color: 'var(--text-4)', cursor: 'pointer', lineHeight: 1,
                flexShrink: 0, marginTop: -2,
              }}
            >
              ×
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); if (error) setError('') }}
              onKeyDown={handleKey}
              placeholder="your@email.com"
              disabled={state === 'sending'}
              autoComplete="email"
              style={{
                flex:        1,
                background:  'var(--bg-inset)',
                border:      `1px solid ${error ? 'rgba(220,80,60,0.5)' : 'var(--border-mid)'}`,
                borderRadius: 8,
                padding:     '9px 13px',
                fontSize:    13,
                color:       'var(--text-1)',
                outline:     'none',
              }}
            />
            <button
              onClick={handleSend}
              disabled={state === 'sending' || !email.trim()}
              style={{
                background:   'rgba(201,168,76,0.1)',
                border:       '1px solid rgba(201,168,76,0.3)',
                borderRadius: 8,
                padding:      '9px 16px',
                fontSize:     12,
                fontWeight:   700,
                color:        'var(--gold)',
                cursor:       state === 'sending' || !email.trim() ? 'not-allowed' : 'pointer',
                whiteSpace:   'nowrap',
                opacity:      state === 'sending' || !email.trim() ? 0.55 : 1,
              }}
            >
              {state === 'sending' ? 'Sending…' : 'Send link'}
            </button>
          </div>

          {error && (
            <p style={{ fontSize: 11, color: 'rgba(220,80,60,0.9)', margin: '7px 0 0', lineHeight: 1.5 }}>
              {error}
            </p>
          )}

          <p style={{ fontSize: 10.5, color: 'var(--text-4)', margin: '8px 0 0', lineHeight: 1.5 }}>
            No password. No spam. One link to link your decisions.
          </p>
        </>
      )}
    </div>
  )
}
