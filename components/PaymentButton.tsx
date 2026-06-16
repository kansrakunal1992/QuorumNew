'use client'

// components/PaymentButton.tsx
// ── Mirror: Razorpay Checkout Button (Sprint CX-PAY) ─────────────────────────
//
// Client component that drives the full Razorpay checkout flow:
//   1. POST /api/payment/create-subscription → get subscriptionId + keyId
//   2. Load Razorpay checkout.js if not already present
//   3. Open Razorpay modal with subscription_id
//   4. On handler callback (payment complete): call onSuccess()
//   5. On modal dismiss: reset loading state
//
// Props:
//   plan      — 'monthly' | 'annual'
//   label     — button text e.g. "₹3,999 / month"
//   authToken — Supabase JWT from session (for Authorization header)
//   userEmail — prefilled in Razorpay checkout
//   onSuccess — called on successful payment; caller triggers Mirror unlock
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'

// ── Type declaration for Razorpay checkout (loaded via CDN script tag) ────────
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Razorpay: new (options: Record<string, any>) => { open: () => void }
  }
}

interface PaymentButtonProps {
  plan:      'monthly' | 'annual'
  label:     string
  authToken: string
  userEmail: string
  onSuccess: () => void
}

// ── Load Razorpay checkout.js once — idempotent ───────────────────────────────
function loadRazorpayScript(): Promise<boolean> {
  return new Promise(resolve => {
    if (typeof window !== 'undefined' && window.Razorpay) {
      resolve(true)
      return
    }
    const script    = document.createElement('script')
    script.src      = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async    = true
    script.onload   = () => resolve(true)
    script.onerror  = () => resolve(false)
    document.body.appendChild(script)
  })
}

// ── Component ─────────────────────────────────────────────────────────────────
export function PaymentButton({
  plan,
  label,
  authToken,
  userEmail,
  onSuccess,
}: PaymentButtonProps) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function handleClick() {
    setLoading(true)
    setError(null)

    try {
      // ── Step 1: Create Razorpay subscription on server ──────────────────
      const res = await fetch('/api/payment/create-subscription', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ plan }),
      })

      if (!res.ok) {
        let msg = 'Subscription creation failed'
        try {
          const err = await res.json()
          msg = err.error ?? msg
        } catch { /* use default */ }
        throw new Error(msg)
      }

      const { subscriptionId, keyId } = await res.json() as {
        subscriptionId: string
        keyId:          string
      }

      // ── Step 2: Load Razorpay checkout.js ───────────────────────────────
      const loaded = await loadRazorpayScript()
      if (!loaded) {
        throw new Error('Checkout failed to load. Please refresh and try again.')
      }

      // ── Step 3: Open Razorpay checkout modal ────────────────────────────
      const rzp = new window.Razorpay({
        key:             keyId,
        subscription_id: subscriptionId,
        name:            'Quorum',
        image:           'https://app.quorumvault.org/icon-512.png',
        description:     plan === 'annual'
          ? 'Mirror — Annual (₹39,999/year)'
          : 'Mirror — Monthly (₹3,999/month)',
        prefill: {
          email: userEmail,
        },
        theme: {
          color:          '#c9a84c',
          backdrop_color: '#08111f',
        },
        // handler fires on successful payment (before webhook)
        handler: () => {
          setLoading(false)
          onSuccess()
        },
        modal: {
          backdropclose: false,
          escape:        false,
          ondismiss:     () => setLoading(false),
        },
      })

      rzp.open()

    } catch (err: unknown) {
      setLoading(false)
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <button
        onClick={handleClick}
        disabled={loading}
        style={{
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
          width:           '100%',
          padding:         '11px 20px',
          background:      loading
            ? 'rgba(201,168,76,0.06)'
            : 'rgba(201,168,76,0.13)',
          border:          '1px solid var(--gold-dim)',
          borderRadius:    8,
          color:           loading ? 'var(--text-4)' : 'var(--gold)',
          fontSize:        13,
          fontWeight:      600,
          fontFamily:      'inherit',
          cursor:          loading ? 'not-allowed' : 'pointer',
          transition:      'background 0.15s, color 0.15s',
          letterSpacing:   '0.01em',
        }}
      >
        {loading ? 'Opening checkout…' : label}
      </button>
      {error && (
        <p style={{
          fontSize:   11.5,
          color:      '#e05c5c',
          margin:     0,
          lineHeight: 1.4,
        }}>
          {error}
        </p>
      )}
    </div>
  )
}
