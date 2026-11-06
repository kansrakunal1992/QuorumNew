'use client'

// components/ConveneGate.tsx
// -- v14: sign in before the Council runs ----------------------------------------------------------------------
// Wraps <SessionView> on /session/<id>. For a signed-OUT visitor whose Council has not run yet, it shows a short
// sign-in step INSTEAD of mounting SessionView. SessionView starts the ontology, examiner and all six advisors the
// moment it mounts, so nothing runs (and nothing is spent) until the person is signed in.
//
// Everything else renders exactly as before: `candidate` is decided on the server (lib/convene-gate.ts) and is false
// when the gate is switched off, when the Council already ran, or when the session is locked / completed.
//
// Failure policy: if anything here goes wrong, FAIL OPEN. A bug in the gate must never lock someone out of the product.
//
// After Google or the magic link, the person returns to this same /session/<id> (returnTo) with the session linked to
// their account, the check below finds a live session, and SessionView mounts as normal.

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import ConnectCard from '@/components/ConnectCard'
import { getAuthHeaders } from '@/lib/auth-headers'
import { track } from '@/lib/track'
import { CONVENE_GATE_STAGE } from '@/lib/convene-gate'

interface Props {
  sessionId: string
  /** decided on the server: gate enabled AND this session's Council has never run */
  candidate: boolean
  children: ReactNode
}

type GateState = 'checking' | 'open' | 'gate'

// /auth/callback sends someone whose link failed back here with ?auth_error=… (see app/auth/callback/page.tsx).
function readAuthErrorNotice(): string | null {
  try {
    const reason = new URLSearchParams(window.location.search).get('auth_error')
    if (reason === 'link_expired') return 'That sign-in link has expired or was already used. Send yourself a new one below.'
    if (reason === 'link_failed')  return 'That sign-in link did not work. Send yourself a new one below.'
  } catch { /* no window / bad URL: no notice */ }
  return null
}

export default function ConveneGate({ sessionId, candidate, children }: Props) {
  const [state, setState] = useState<GateState>(candidate ? 'checking' : 'open')
  const shownRef = useRef(false)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => { setNotice(readAuthErrorNotice()) }, [])

  useEffect(() => {
    if (!candidate) return
    let cancelled = false
    ;(async () => {
      try {
        const headers = await getAuthHeaders()
        if (!cancelled) setState(headers.Authorization ? 'open' : 'gate')
      } catch {
        if (!cancelled) setState('open')   // fail open
      }
    })()
    return () => { cancelled = true }
  }, [candidate])

  useEffect(() => {
    if (state !== 'gate' || shownRef.current) return
    shownRef.current = true
    track('convene_gate_shown', { surface: 'session_page' }, { sessionId })
  }, [state, sessionId])

  if (state === 'open') return <>{children}</>

  if (state === 'checking') {
    // Deliberately empty: a signed-in person passes this in a few milliseconds, and nothing may start behind it.
    return <main style={{ minHeight: '60vh' }} aria-busy="true" />
  }

  return (
    <main style={{ maxWidth: 520, margin: '0 auto', padding: '14vh 20px 48px' }}>
      <h1 style={{ fontSize: 26, lineHeight: 1.25, fontWeight: 500, color: 'var(--text-1)', margin: '0 0 10px' }}>
        Your Council is ready.
      </h1>
      <p style={{ fontSize: 14.5, lineHeight: 1.6, color: 'var(--text-3)', margin: '0 0 20px' }}>
        One quick step first. Six advisors will read your decision and push back from different angles. Sign in so
        Quorum can keep that record private to you.
      </p>

      {notice && (
        <p role="alert" style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)', background: 'var(--bg-card)', border: '1px solid var(--border-mid)', borderRadius: 10, padding: '10px 12px', margin: '0 0 14px' }}>
          {notice}
        </p>
      )}

      <ConnectCard mode="convene_gate" surface="session_page" sessionId={sessionId} arm={CONVENE_GATE_STAGE} />

      <details style={{ marginTop: 18, fontSize: 12.5, color: 'var(--text-4)', lineHeight: 1.6 }}>
        <summary style={{ cursor: 'pointer', color: 'var(--text-3)' }}>Why sign in?</summary>
        <p style={{ margin: '8px 0 0' }}>
          So your decision is saved to you, not to a browser that can be cleared. It lets Quorum remind you on the
          review date you choose, and ask how it turned out a few weeks later. There is no password, and what you wrote
          stays private to you.
        </p>
      </details>
    </main>
  )
}
