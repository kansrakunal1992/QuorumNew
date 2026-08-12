// app/api/auth/route.ts
// ── Sprint 6 + 6b + 12: Magic Link SEND endpoint ──────────────────────────────
//
// Accepts an email (+ optional device/session identity) and sends a Supabase
// magic link. Embeds the caller's device ID and session IDs as ?xd=&xs= query
// params on the redirect URL so /auth/callback can recover them even when the
// link is opened in a different browser (email client, mobile WebView, etc.)
// where localStorage is empty — see /auth/callback/page.tsx for the read side
// of this contract.
//
// Sprint 12 addition: provider-lock pre-check. If this email already signed
// up via Google, we don't send a link at all — we return 409 { error:
// 'wrong_provider' } so the client (AuthPanel) can prompt "use Google instead".
// This is a UX nicety, not a safety mechanism — Supabase auto-links same-email
// identities to one account regardless (confirmed directly against this
// project's Supabase configuration, 2026-08 — see the matching note in
// app/api/auth/link-sessions/route.ts), so skipping this check would just cost
// the user an unnecessary email round-trip, not create a duplicate account.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase'
import { checkLimit, getClientIP, tooManyRequests, LIMITS } from '@/lib/rate-limit'
import { writeAuditLog, getAuditContext } from '@/lib/audit'

export async function POST(req: Request) {
  try {
    // S5-01: rate limit magic link sends — 5 per 15 min per IP
    const rlResult = checkLimit(getClientIP(req), LIMITS.auth)
    if (!rlResult.allowed) return tooManyRequests(rlResult, 'sign-in requests')

    const { email, deviceId, sessionIds } = await req.json() as {
      email?:      string
      deviceId?:   string
      sessionIds?: string[]
    }

    if (!email || !email.trim() || !email.includes('@')) {
      return NextResponse.json({ error: 'valid email required' }, { status: 400 })
    }

    const normalizedEmail = email.trim().toLowerCase()
    const supabase = createServiceClient()

    // ── 0. Provider-lock pre-check ────────────────────────────────────────
    // If this email already has a row locked to 'google', don't send a link —
    // tell the client so it can prompt "Continue with Google" instead.
    const { data: existing } = await supabase
      .from('user_preferences')
      .select('signup_method')
      .eq('user_email', normalizedEmail)
      .maybeSingle()

    if (existing?.signup_method && existing.signup_method !== 'magic_link') {
      console.warn(`[Auth] Pre-check blocked magic-link send for ${normalizedEmail}: locked to ${existing.signup_method}`)
      return NextResponse.json({ error: 'wrong_provider' }, { status: 409 })
    }

    // ── 1. Build the redirect URL, embedding device/session identity ──────
    // so /auth/callback can recover it via ?xd=&xs= even in a different
    // browser context than the one that requested the link.
    //
    // Fallback must be the Railway URL, NOT app.quorumvault.org — that
    // custom domain is not in Supabase's redirect allowlist, so using it
    // here would make Supabase silently drop /auth/callback and all
    // ?xd=/?xs= params (this exact bug was already hit and fixed once).
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL
      ?? 'https://invigorating-manifestation-production-ecd2.up.railway.app').replace(/\/$/, '')
    const params = new URLSearchParams()
    if (deviceId) params.set('xd', deviceId)
    if (sessionIds?.length) params.set('xs', sessionIds.slice(0, 40).join(',')) // keep URL well under 2KB
    const query = params.toString()
    const emailRedirectTo = `${appUrl}/auth/callback${query ? `?${query}` : ''}`

    // ── 2. Send the magic link ─────────────────────────────────────────────
    // Anon client — signInWithOtp is a public-facing auth operation, not one
    // that needs the service role. persistSession is already disabled for the
    // non-browser branch of createClient(), so no session state leaks server-side.
    const anonClient = createClient()
    const { error: otpError } = await anonClient.auth.signInWithOtp({
      email:   normalizedEmail,
      options: {
        shouldCreateUser: true,
        emailRedirectTo,
      },
    })

    if (otpError) {
      console.error('[Auth] signInWithOtp failed:', otpError.message)
      return NextResponse.json({ error: 'Failed to send magic link' }, { status: 500 })
    }

    console.log(`[Auth] Magic link sent to ${normalizedEmail} (deviceId=${deviceId ?? 'none'}, sessions=${sessionIds?.length ?? 0})`)

    // S6-01: audit log — non-blocking
    void writeAuditLog({
      actor_email: normalizedEmail,
      action:      'auth.magic_link_sent',
      ...getAuditContext(req),
    })

    return NextResponse.json({ status: 'ok' })

  } catch (err) {
    console.error('[Auth] Route error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
