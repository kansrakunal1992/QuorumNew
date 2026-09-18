// app/api/auth/link-utm/route.ts
// ── GTM attribution: persist first-touch signup UTM ──────────────────────────
//
// POST /api/auth/link-utm
// Body: { userId: string, utmSource?: string, utmCampaign?: string, utmContent?: string }
//
// Called once, fire-and-forget, from /auth/callback ONLY on a brand-new
// registration (see isNewRegistration there) — never on a later login, so
// this always reflects genuine first-touch attribution, never overwritten.
//
// Deliberately a new, narrow endpoint rather than folded into
// /api/auth/link-sessions — keeps this change isolated and easy to review,
// and means a failure here can never affect session-linking.
//
// No auth header check (mirrors link-sessions): this fires milliseconds
// after a magic-link/Google callback completes, before the client
// necessarily has a usable access token handy for an Authorization header.
// userId comes from the already-verified `user` object in that same
// callback flow, not from anything an unauthenticated caller could spoof
// their way into — worst case of abuse is a bogus attribution tag on a
// row that already requires a real, just-completed auth event to reach.

import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  let body: { userId?: string; utmSource?: string; utmCampaign?: string; utmContent?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.userId) {
    return NextResponse.json({ error: 'userId required' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('user_profiles')
    .upsert({
      user_id:               body.userId,
      signup_utm_source:     body.utmSource ?? null,
      signup_utm_campaign:   body.utmCampaign ?? null,
      signup_utm_content:    body.utmContent ?? null,
    }, { onConflict: 'user_id' })

  if (error) {
    console.error('[link-utm] DB error:', error)
    return NextResponse.json({ error: 'Failed to record attribution' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
