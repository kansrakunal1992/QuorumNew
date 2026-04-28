'use client'
// components/AuthPanel.tsx
// ── Sprint 6: Magic Link Auth Panel ──────────────────────────────────────────
//
// Rendered in home page in the decision history section.
// Shows if the user has no user_email stored (i.e. never authenticated).
// Compact — doesn't dominate the page. Positioned after history.
//
// UX intent: not a gate — a gentle upgrade prompt.
// "Your sessions live on this device only. Add an email to access them anywhere."
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'

interface Props {
  userEmail: string | null
  onAuthenticated?: (email: string) => void
}

type AuthState = 'idle' | 'sending' | 'sent' | 'error'

export default function AuthPanel({ userEmail, onAuthenticated }: Props) {
  const [email,     setEmail]     = useState('')
  const [authState, setAuthState] = useState<AuthState>('idle')
  const [errMsg,    setErrMsg]    = useState('')

  // Already authenticated — show compact identity pill
  if (userEmail) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        background: 'rgba(74,222,128,0.06)',
        border: '1px solid rgba(74,222,128,0.2)',
        borderRadius: 10,
        marginTop: 12,
      }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', flexShrink: 0 }} />
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
          Sessions linked to <span style={{ color: 'var(--text-2)', fontWeight: 600 }}>{userEmail}</span>
          {' · '}cross-device history active
        </span>
      </div>
    )
  }

  const handleSend = async () => {
    if (!email.trim() || !email.includes('@')) {
      setErrMsg('Enter a valid email address.')
      return
    }
    setErrMsg('')
    setAuthState('sending')

    try {
      const res  = await fetch('/api/auth', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      if (!res.ok) throw new Error()
      setAuthState('sent')
      onAuthenticated?.(email.trim().toLowerCase())
    } catch {
      setAuthState('error')
      setErrMsg('Failed to send link. Try again.')
    }
  }

  if (authState === 'sent') {
    return (
      <div style={{
        padding: '14px 18px',
        background: 'rgba(201,168,76,0.06)',
        border: '1px solid var(--gold-dim)',
        borderRadius: 12,
        marginTop: 12,
      }}>
        <p style={{ fontSize: 13, color: 'var(--gold)', fontWeight: 600, marginBottom: 4 }}>
          Check your email
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5, margin: 0 }}>
          A sign-in link was sent to <span style={{ color: 'var(--text-2)' }}>{email}</span>.
          Click it to link your sessions across devices.
        </p>
      </div>
    )
  }

  return (
    <div style={{
      padding: '14px 18px',
      background: 'var(--bg-card)',
      border: '1px solid var(--border-dim)',
      borderRadius: 12,
      marginTop: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
          <rect x="2" y="3" width="20" height="14" rx="2"/><polyline points="8,21 12,17 16,21"/>
        </svg>
        <div>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 3 }}>
            Make your history cross-device
          </p>
          <p style={{ fontSize: 11, color: 'var(--text-4)', lineHeight: 1.5, margin: 0 }}>
            Sessions currently live on this device only. Add an email to access them anywhere — no password, just a link.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          style={{
            flex: 1,
            background: 'var(--bg-inset)',
            border: '1px solid var(--border-mid)',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 12,
            color: 'var(--text-1)',
            fontFamily: 'inherit',
            outline: 'none',
          }}
          disabled={authState === 'sending'}
        />
        <button
          onClick={handleSend}
          disabled={authState === 'sending' || !email.trim()}
          style={{
            padding: '8px 16px',
            background: 'rgba(201,168,76,0.12)',
            border: '1px solid var(--gold-dim)',
            borderRadius: 8,
            color: 'var(--gold)',
            fontSize: 12,
            fontWeight: 600,
            fontFamily: 'inherit',
            cursor: authState === 'sending' ? 'not-allowed' : 'pointer',
            opacity: authState === 'sending' || !email.trim() ? 0.5 : 1,
            whiteSpace: 'nowrap',
            transition: 'opacity 0.15s',
          }}
        >
          {authState === 'sending' ? 'Sending…' : 'Send link →'}
        </button>
      </div>

      {errMsg && (
        <p style={{ fontSize: 11, color: '#e05050', marginTop: 6, margin: '6px 0 0' }}>{errMsg}</p>
      )}
    </div>
  )
}
