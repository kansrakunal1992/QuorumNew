// lib/google-auth.ts
// ── Shared Google OAuth sign-in handler ──────────────────────────────────────
//
// Extracted from AuthPanel.tsx (Sprint 12) so every entry point that offers
// "Continue with Google" — AuthPanel, EmailCaptureCard, mirror's AuthGate —
// calls the same implementation instead of re-declaring the redirect logic.
//
// Uses the same NEXT_PUBLIC_APP_URL convention as /api/auth's magic-link
// redirect, so the callback URL matches what's in Supabase's allowlist.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@/lib/supabase'

export async function signInWithGoogle(): Promise<void> {
  const supabase = createClient()
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options:  { redirectTo: `${origin}/auth/callback` },
  })
}
