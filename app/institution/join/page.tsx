'use client'
// app/institution/join/page.tsx
// Tier 1 — the "enter your unlock code" UI. Previously this was the only
// institutional action with zero UI path at all: POST /api/institutions/redeem
// existed since Sprint 1, but nothing in the product could reach it.
//
// A standalone, linkable page (not a modal) deliberately — an admin
// distributing a code needs something shareable ("go to
// quorum.app/institution/join and enter this"), not an instruction to find
// a buried settings toggle first.

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { isInstitutionalModeEnabled } from '@/lib/feature-flags'
import AuthPanel from '@/components/AuthPanel'

type Phase = 'checking-auth' | 'signed-out' | 'form' | 'submitting' | 'success' | 'error'

export default function JoinInstitutionPage() {
  const router = useRouter()
  const [phase, setPhase]         = useState<Phase>('checking-auth')
  const [authToken, setAuthToken] = useState<string | null>(null)
  const [code, setCode]           = useState('')
  const [errorMsg, setErrorMsg]   = useState('')
  const [joinedName, setJoinedName] = useState('')

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) {
        setAuthToken(session.access_token)
        setPhase('form')
      } else {
        setPhase('signed-out')
      }
    })
  }, [])

  const submit = async () => {
    if (!code.trim() || !authToken) return
    setPhase('submitting')
    setErrorMsg('')
    try {
      const res = await fetch('/api/institutions/redeem', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      })
      const json = await res.json()
      if (!res.ok) {
        setErrorMsg(json.error === 'Invalid unlock code' ? 'That code isn\u2019t valid — check it and try again.' : (json.error ?? 'Something went wrong.'))
        setPhase('error')
        return
      }
      setJoinedName(json.institutionId ? 'your institution' : '')
      setPhase('success')
    } catch {
      setErrorMsg('Network error — try again.')
      setPhase('error')
    }
  }

  if (!isInstitutionalModeEnabled()) {
    return (
      <PageShell>
        <p style={{ color: 'var(--text-4)', fontSize: 13 }}>This feature isn&apos;t available right now.</p>
      </PageShell>
    )
  }

  if (phase === 'checking-auth') {
    return <PageShell><p style={{ color: 'var(--text-4)', fontSize: 13 }}>Loading…</p></PageShell>
  }

  if (phase === 'signed-out') {
    return (
      <PageShell>
        <h1 style={titleStyle}>Join an institution</h1>
        <p style={{ color: 'var(--text-3)', fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
          Sign in below, then come back to this exact page (bookmark or re-type the URL) to enter
          your code — the sign-in link takes a moment and won&apos;t bring you back here automatically.
        </p>
        <AuthPanel userEmail={null} />
      </PageShell>
    )
  }

  if (phase === 'success') {
    return (
      <PageShell>
        <h1 style={titleStyle}>You&apos;re in</h1>
        <p style={{ color: 'var(--text-3)', fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
          You&apos;ve joined {joinedName || 'your institution'}. Nothing about your existing decisions changed,
          and no data is shared until you choose to turn something on — head to Privacy settings whenever
          you&apos;re ready to look at that.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => router.push('/settings/privacy#institutional-sharing')} style={buttonStyle}>
            Go to sharing settings
          </button>
          <button onClick={() => router.push('/mirror')} style={secondaryButtonStyle}>
            Go to Mirror
          </button>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <h1 style={titleStyle}>Join an institution</h1>
      <p style={{ color: 'var(--text-3)', fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
        Enter the code your institution admin gave you. This only connects your account — nothing
        is shared with anyone until you separately turn on sharing, which stays off by default.
      </p>

      <input
        value={code}
        onChange={e => setCode(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') void submit() }}
        placeholder="e.g. 7K2P-9XQ1-M4TN"
        autoFocus
        style={inputStyle}
      />

      {phase === 'error' && (
        <p style={{ color: '#f87171', fontSize: 12.5, margin: '10px 0 0' }}>{errorMsg}</p>
      )}

      <button
        onClick={submit}
        disabled={!code.trim() || phase === 'submitting'}
        style={{ ...buttonStyle, marginTop: 16, opacity: !code.trim() || phase === 'submitting' ? 0.5 : 1 }}
      >
        {phase === 'submitting' ? 'Joining…' : 'Join'}
      </button>
    </PageShell>
  )
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 440, margin: '0 auto', padding: '64px 20px 80px' }}>
      {children}
    </div>
  )
}

const titleStyle: React.CSSProperties = {
  fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 400,
  color: 'var(--text-1)', margin: '0 0 10px',
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '11px 14px', borderRadius: 10,
  border: '1px solid var(--border-mid)', background: 'var(--bg-card)',
  color: 'var(--text-1)', fontSize: 14, fontFamily: 'var(--font-mono)',
  outline: 'none', boxSizing: 'border-box',
}

const buttonStyle: React.CSSProperties = {
  padding: '10px 22px', borderRadius: 9, border: '1px solid var(--gold-dim)',
  background: 'rgba(201,168,76,0.12)', color: 'var(--gold)', fontSize: 13,
  fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
}

const secondaryButtonStyle: React.CSSProperties = {
  padding: '10px 22px', borderRadius: 9, border: '1px solid var(--border-mid)',
  background: 'none', color: 'var(--text-3)', fontSize: 13,
  fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
}
