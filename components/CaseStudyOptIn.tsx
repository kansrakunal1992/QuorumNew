// components/CaseStudyOptIn.tsx
// Item #11 — shown only when a decision's outcome was marked "changed my
// thinking" (council_helped === 'yes'), matching the "Aha moment" signal
// from the original feedback. Opt-in only, unchecked by default, per the
// working decision on item #12: default consent must never be opt-out.
//
// Self-contained: fetches its own auth token (same pattern as app/page.tsx)
// rather than threading it through OutcomeTracker's props, to keep this an
// isolated, low-risk addition to an existing, heavily-used component.

'use client'

import { useState, useEffect } from 'react'

interface Props {
  sessionId: string
}

type Phase = 'checking' | 'hidden' | 'offer' | 'form' | 'submitted' | 'error'

export default function CaseStudyOptIn({ sessionId }: Props) {
  const [phase, setPhase]   = useState<Phase>('checking')
  const [note, setNote]     = useState('')
  const [consent, setConsent] = useState(false) // unchecked by default — item #12
  const [submitting, setSubmitting] = useState(false)
  const [authToken, setAuthToken] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { createClient } = await import('@/lib/supabase')
        const supabase = createClient()
        const { data: { session: authSession } } = await supabase.auth.getSession()
        const token = authSession?.access_token ?? null
        if (cancelled) return
        setAuthToken(token)

        if (!token) { setPhase('hidden'); return } // anonymous sessions can't be attributed — skip

        const res = await fetch(`/api/case-study/submit?sessionId=${sessionId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const json = await res.json()
        if (cancelled) return
        setPhase(json?.exists ? 'hidden' : 'offer')
      } catch {
        if (!cancelled) setPhase('hidden')
      }
    })()
    return () => { cancelled = true }
  }, [sessionId])

  const handleSubmit = async () => {
    if (!authToken || !consent) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/case-study/submit', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body:    JSON.stringify({ sessionId, userNote: note.trim() || undefined }),
      })
      if (!res.ok) throw new Error()
      setPhase('submitted')
    } catch {
      setPhase('error')
    } finally {
      setSubmitting(false)
    }
  }

  if (phase === 'checking' || phase === 'hidden') return null

  if (phase === 'submitted') {
    return (
      <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-3)' }}>
        Thank you — this has been sent for review. Nothing is published without us reaching out to you first.
      </div>
    )
  }

  return (
    <div
      style={{
        marginTop: 14, padding: '14px 16px', borderRadius: 10,
        border: '1px solid var(--border-dim)', background: 'var(--bg-card-alt)',
      }}
    >
      {phase === 'offer' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
            Would you be open to this decision being considered as an anonymized case study, to help someone facing something similar?
          </p>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => setPhase('form')}
              className="btn-ghost"
              style={{ fontSize: 12, padding: '6px 14px' }}
            >
              Yes, ask me
            </button>
            <button
              onClick={() => setPhase('hidden')}
              className="btn-ghost"
              style={{ fontSize: 12, padding: '6px 14px', opacity: 0.6 }}
            >
              No thanks
            </button>
          </div>
        </div>
      )}

      {phase === 'form' && (
        <div>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>
            Nothing is published automatically. A real person reviews and fully anonymizes this before anything is ever shown to anyone — we'll reach out to confirm the final version with you first.
          </p>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Optional — anything you'd want included or left out (not shared with anyone yet)"
            rows={2}
            style={{
              width: '100%', fontSize: 12.5, padding: '8px 10px', borderRadius: 8,
              border: '1px solid var(--border-dim)', background: 'var(--bg-card)',
              color: 'var(--text-1)', fontFamily: 'inherit', resize: 'vertical', marginBottom: 10,
            }}
          />
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'var(--text-3)', marginBottom: 12, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={consent}
              onChange={e => setConsent(e.target.checked)}
              style={{ marginTop: 2 }}
            />
            I'm opting in to have this decision considered for an anonymized case study.
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleSubmit}
              disabled={!consent || submitting}
              className="btn-primary"
              style={{ fontSize: 12, padding: '7px 16px', opacity: !consent ? 0.5 : 1 }}
            >
              {submitting ? 'Sending…' : 'Submit for review'}
            </button>
            <button
              onClick={() => setPhase('hidden')}
              className="btn-ghost"
              style={{ fontSize: 12, padding: '7px 14px' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === 'error' && (
        <p style={{ margin: 0, fontSize: 12, color: '#e05050' }}>
          Something went wrong — please try again in a moment.
        </p>
      )}
    </div>
  )
}
