'use client'
// components/GoogleSignInButton.tsx
// ── Shared Google sign-in button ─────────────────────────────────────────────
//
// Two variants matching the two visual treatments originally hand-rolled in
// AuthPanel.tsx (Sprint 12):
//
//   'primary' — full-width button with icon, used as the main entry point
//               (AuthPanel idle state, EmailCaptureCard, mirror's AuthGate).
//               Pass `subtext` for the small caption underneath.
//
//   'compact' — smaller gold pill, no icon, used inside the wrong_provider
//               prompt ("this email signed up with Google — use that").
//
// Now reused by AuthPanel, EmailCaptureCard, and mirror's AuthGate instead of
// each hand-rolling its own button markup.
// ─────────────────────────────────────────────────────────────────────────────

import { signInWithGoogle } from '@/lib/google-auth'

interface Props {
  variant?: 'primary' | 'compact'
  subtext?: string
}

const GoogleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.82Z"/>
    <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.26v3.1A11.99 11.99 0 0 0 12 24Z"/>
    <path fill="#FBBC05" d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58v-3.1H1.26a12 12 0 0 0 0 10.78l4.01-3.1Z"/>
    <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.6 4.59 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0A11.99 11.99 0 0 0 1.26 6.61l4.01 3.1C6.22 6.86 8.87 4.75 12 4.75Z"/>
  </svg>
)

export default function GoogleSignInButton({ variant = 'primary', subtext }: Props) {
  if (variant === 'compact') {
    return (
      <button
        onClick={signInWithGoogle}
        style={{
          padding: '8px 16px', background: 'rgba(201,168,76,0.12)',
          border: '1px solid var(--gold-dim)', borderRadius: 8,
          color: 'var(--gold)', fontSize: 12, fontWeight: 600,
          fontFamily: 'inherit', cursor: 'pointer',
        }}
      >
        Continue with Google
      </button>
    )
  }

  return (
    <>
      <button
        onClick={signInWithGoogle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '9px 12px', background: 'var(--bg-inset)', border: '1px solid var(--border-mid)',
          borderRadius: 8, color: 'var(--text-2)', fontSize: 12, fontWeight: 600,
          fontFamily: 'inherit', cursor: 'pointer',
        }}
      >
        <GoogleIcon />
        Continue with Google
      </button>
      {subtext && (
        <p style={{ fontSize: 10.5, color: 'var(--text-5)', textAlign: 'center', margin: '5px 0 0' }}>
          {subtext}
        </p>
      )}
    </>
  )
}
