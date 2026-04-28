// app/api/auth/route.ts
// ── Sprint 6: Supabase Magic Link Auth ───────────────────────────────────────
//
// POST /api/auth  — sends a magic link to the given email via Supabase Auth
// Body: { email: string }
//
// After the user clicks the link, Supabase redirects to /auth/callback
// which is handled client-side by Supabase JS SDK.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function POST(req: Request) {
  try {
    const { email } = await req.json() as { email?: string }

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Send magic link via Supabase Auth
    const { error } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: email.toLowerCase().trim(),
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/auth/callback`,
      },
    })

    if (error) {
      console.error('[Auth] Magic link generation failed:', error)
      return NextResponse.json({ error: 'Failed to send magic link' }, { status: 500 })
    }

    return NextResponse.json({ status: 'ok', message: 'Magic link sent' })

  } catch (err) {
    console.error('[Auth] Route error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
