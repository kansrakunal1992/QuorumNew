'use client'

// components/CancelSubscription.tsx
// ── Mirror: In-app Subscription Cancellation (Sprint CX-PAY) ─────────────────
//
// Renders at the bottom of UnlockedView for monthly/annual subscribers.
// Three states: idle → confirming → done (or error).
//
// Cancels at cycle end — user keeps Mirror access until expires_at.
// Advisory tier is excluded (handled server-side with a 403, shown as
// a "contact us" message if somehow rendered).
//
// Props:
//   authToken — Supabase JWT, required for the POST
//   tier      — MirrorTier; 'advisory' users see a contact message instead
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import type { MirrorTier } from '@/lib/types'

type State = 'idle' | 'confirming' | 'loading' | 'done' | 'error'

interface Props {
  authToken: string
  tier:      MirrorTier
}

export function CancelSubscription({ authToken, tier }: Props) {
  const [state,      setState]      = useState<State>('idle')
  const [doneMsg,    setDoneMsg]    = useState('')
  const [errorMsg,   setErrorMsg]   = useState('')

  // Advisory users get a static contact message — no cancel flow
  if (tier === 'advisory') {
    return (
      <p style={{ fontSize: 11, color: 'var(--text-4)', margin: 0, textAlign: 'center' }}>
        Advisory access is managed directly.{' '}
        <a href="mailto:support@quorumvault.org" style={{ color: 'var(--text-4)', textDecoration: 'underline' }}>
          Contact us
        </a>{' '}
        to make changes.
      </p>
    )
  }

  async function handleConfirm() {
    setState('loading')
    try {
      const res = await fetch('/api/payment/cancel-subscription', {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${authToken}` },
      })
      const data = await res.json()

      if (!res.ok) {
        // Surface friendly messages for known error codes
        if (data.error === 'no_razorpay_subscription' || data.error === 'advisory_plan') {
          setErrorMsg(data.message ?? 'Contact us to cancel.')
        } else {
          setErrorMsg(data.error ?? 'Cancellation failed. Please try again.')
        }
        setState('error')
        return
      }

      setDoneMsg(data.message ?? 'Subscription cancelled.')
      setState('done')
    } catch {
      setErrorMsg('Something went wrong. Please try again.')
      setState('error')
    }
  }

  // ── idle ──────────────────────────────────────────────────────────────────
  if (state === 'idle') {
    return (
      <button
        onClick={() => setState('confirming')}
        style={{
          background:    'transparent',
          border:        'none',
          padding:       0,
          color:         'var(--text-4)',
          fontSize:      11,
          fontFamily:    'inherit',
          cursor:        'pointer',
          textDecoration: 'underline',
          textUnderlineOffset: 3,
          transition:    'color 0.15s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-4)' }}
      >
        Cancel subscription
      </button>
    )
  }

  // ── confirming ────────────────────────────────────────────────────────────
  if (state === 'confirming') {
    return (
      <div style={{
        border:       '1px solid var(--border-dim)',
        borderRadius: 10,
        padding:      '16px 18px',
        display:      'flex',
        flexDirection: 'column',
        gap:          12,
      }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)', margin: 0 }}>
          Cancel subscription?
        </p>
        <p style={{ fontSize: 12.5, color: 'var(--text-3)', margin: 0, lineHeight: 1.55 }}>
          Your Mirror access continues until the end of your current billing period.
          No further charges will be made after that.
        </p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            onClick={handleConfirm}
            style={{
              padding:      '8px 18px',
              background:   'rgba(224,92,92,0.1)',
              border:       '1px solid rgba(224,92,92,0.35)',
              borderRadius: 7,
              color:        '#e05c5c',
              fontSize:     12.5,
              fontWeight:   600,
              fontFamily:   'inherit',
              cursor:       'pointer',
              transition:   'all 0.15s',
            }}
          >
            Yes, cancel
          </button>
          <button
            onClick={() => setState('idle')}
            style={{
              background:    'transparent',
              border:        'none',
              padding:       0,
              color:         'var(--text-4)',
              fontSize:      12,
              fontFamily:    'inherit',
              cursor:        'pointer',
              textDecoration: 'underline',
              textUnderlineOffset: 3,
            }}
          >
            Never mind
          </button>
        </div>
      </div>
    )
  }

  // ── loading ───────────────────────────────────────────────────────────────
  if (state === 'loading') {
    return (
      <p style={{ fontSize: 12, color: 'var(--text-4)', margin: 0 }}>
        Cancelling…
      </p>
    )
  }

  // ── done ──────────────────────────────────────────────────────────────────
  if (state === 'done') {
    return (
      <p style={{ fontSize: 12.5, color: 'var(--text-3)', margin: 0, lineHeight: 1.55 }}>
        {doneMsg}
      </p>
    )
  }

  // ── error ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <p style={{ fontSize: 12.5, color: '#e05c5c', margin: 0 }}>{errorMsg}</p>
      <button
        onClick={() => setState('idle')}
        style={{
          background: 'transparent', border: 'none', padding: 0,
          color: 'var(--text-4)', fontSize: 11, fontFamily: 'inherit',
          cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3,
          alignSelf: 'flex-start',
        }}
      >
        ← Back
      </button>
    </div>
  )
}
