// app/api/auth/route.ts
// ── Sprint 6: Supabase Magic Link Auth ───────────────────────────────────────
//
// POST /api/auth  — sends a magic link via Supabase Auth OTP
//
// NOTE: Uses signInWithOtp via the anon client so Supabase's email
// delivery actually fires. admin.generateLink() only returns the URL
// without sending the email — that's why mail was never arriving.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: Request) {
  try {
    const { email } = await req.json() as { email?: string }

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
    }

    // Use the anon client so Supabase email delivery fires correctly.
    // signInWithOtp triggers the actual email send; admin.generateLink() does not.
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )

    const { error } = await supabase.auth.signInWithOtp({
      email: email.toLowerCase().trim(),
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/auth/callback`,
        shouldCreateUser: true,
      },
    })

    if (error) {
      console.error('[Auth] OTP send failed:', error)
      return NextResponse.json({ error: 'Failed to send magic link' }, { status: 500 })
    }

    console.log(`[Auth] Magic link sent to ${email}`)
    return NextResponse.json({ status: 'ok', message: 'Magic link sent' })

  } catch (err) {
    console.error('[Auth] Route error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
