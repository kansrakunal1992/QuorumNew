// app/api/auth/route.ts
// ── Sprint 6: Supabase Magic Link Auth ───────────────────────────────────────
//
// POST /api/auth  — sends a magic link via Supabase Auth OTP
//
// NOTE: Uses signInWithOtp via the anon client so Supabase's email
// delivery actually fires. admin.generateLink() only returns the URL
// without sending the email — that's why mail was never arriving.
//
// Cross-browser session recovery (Sprint 6b fix):
// The magic link's emailRedirectTo URL now carries the device_id and
// up to 40 session IDs from the originating browser as query params.
// When the user clicks the link in a different browser (email client,
// mobile WebView, etc.), the callback page reads these from the URL
// rather than from localStorage — which is empty in the new browser.
// This allows link-sessions to reunite all prior anonymous decisions
// with the newly authenticated account even across browser boundaries.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: Request) {
  try {
    const { email, deviceId, sessionIds } = await req.json() as {
      email?:      string
      deviceId?:   string       // quorum_device_id from the originating browser
      sessionIds?: string[]     // up to 40 most-recent session IDs from localStorage
    }

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
    }

    // Use the anon client so Supabase email delivery fires correctly.
    // signInWithOtp triggers the actual email send; admin.generateLink() does not.
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )

    // Always use NEXT_PUBLIC_APP_URL (the Railway URL) to build the callback.
    // Using the request Origin header would produce app.quorumvault.org which is
    // NOT in Supabase's redirect allowlist → Supabase silently falls back to Site URL,
    // dropping /auth/callback and all ?xd= ?xs= params entirely.
    const origin = process.env.NEXT_PUBLIC_APP_URL
      ?? req.headers.get('origin')
      ?? 'https://invigorating-manifestation-production-ecd2.up.railway.app'

    // ── Embed cross-browser recovery payload in the redirect URL ─────────────
    // Supabase passes these params through to the callback URL intact.
    // The callback page reads them and passes them to link-sessions, so
    // the authenticated user's prior anonymous sessions are linked even
    // when the link is clicked in a different browser (no localStorage).
    const callbackUrl = new URL(`${origin}/auth/callback`)
    if (deviceId)               callbackUrl.searchParams.set('xd', deviceId)
    if (sessionIds?.length) {
      // Send up to 40 IDs — URL length stays well under 2KB
      callbackUrl.searchParams.set('xs', sessionIds.slice(0, 40).join(','))
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: email.toLowerCase().trim(),
      options: {
        emailRedirectTo: callbackUrl.toString(),
        shouldCreateUser: true,
      },
    })

    if (error) {
      console.error('[Auth] OTP send failed:', error)
      return NextResponse.json({ error: 'Failed to send magic link' }, { status: 500 })
    }

    console.log(`[Auth] Magic link sent to ${email} with ${sessionIds?.length ?? 0} session IDs and deviceId=${deviceId ?? 'none'}`)
    return NextResponse.json({ status: 'ok', message: 'Magic link sent' })

  } catch (err) {
    console.error('[Auth] Route error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}