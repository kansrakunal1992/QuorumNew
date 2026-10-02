// app/api/auth/route.ts
// ── Magic link send (Sprint 6 + 6b + 12) ──────────────────────────────────────
//
// FIX (Sept 2026): this file's content was an accidental duplicate of
// app/api/auth/link-utm/route.ts — byte-for-byte, including that file's own
// header comment. Every call from components/AuthPanel.tsx and
// components/EmailCaptureCard.tsx to POST /api/auth was hitting that
// UTM-upsert logic instead, which requires a `userId` neither caller sends
// (a magic-link request happens before the person is authenticated — there
// is no userId yet), so every real request 400'd on "userId required" and
// no magic link was ever sent. Reconstructed below from both sides of the
// contract, which were still intact and fully documented: the two client
// callers (what they send, and how they handle a 409) and
// app/auth/callback/page.tsx (exactly which URL params it reads back —
// xd/xs for cross-browser session recovery, us/uc/ct for GTM attribution).
//
// POST /api/auth
// Body: { email: string, deviceId?: string, sessionIds?: string[],
//          utmSource?: string, utmCampaign?: string, utmContent?: string }
//
// Sprint 6b: embeds deviceId/sessionIds as ?xd=&xs= in the magic link's
// redirect URL, so link-sessions still works when the link is opened in a
// different browser than it was requested from (email client, mobile
// WebView) where localStorage is empty — see app/auth/callback/page.tsx's
// "Identity merge priority" comment for the read side.
//
// Sprint 12: if this email already has a Google identity, no link is sent —
// returns 409 { error: 'wrong_provider' } instead, which both callers
// already handle (shows "sign in with Google instead"). Fails OPEN if the
// lookup itself errors (a transient admin-API issue should never block a
// legitimate sign-in) — logged, not surfaced to the caller.
//
// GTM attribution: utm* fields ride along the same way (?us=&uc=&ct=) so
// app/auth/callback/page.tsx can fire POST /api/auth/link-utm on first
// registration only. This route never writes attribution itself — see that
// route for the write side.

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { checkLimit, getClientIP, tooManyRequests, LIMITS } from '@/lib/rate-limit'

export async function POST(req: Request) {
  const rlResult = checkLimit(getClientIP(req), LIMITS.auth)
  if (!rlResult.allowed) return tooManyRequests(rlResult, 'magic link requests')

  let body: {
    email?:       string
    deviceId?:    string
    sessionIds?:  string[]
    utmSource?:   string
    utmCampaign?: string
    utmContent?:  string
  }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const email = body.email?.trim().toLowerCase()
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // ── Sprint 12: wrong-provider check ─────────────────────────────────────────
  // GoTrue's `filter` does a partial match on email, so the exact-match
  // check below guards against e.g. "sam@x.com" matching "sam@x.com.evil.com".
  try {
    const { data: existing, error: lookupError } = await supabase.auth.admin.listUsers({ filter: email })
    if (lookupError) throw lookupError
    const existingUser = existing?.users?.find(u => u.email?.toLowerCase() === email)
    if (existingUser?.app_metadata?.provider === 'google') {
      return NextResponse.json({ error: 'wrong_provider' }, { status: 409 })
    }
  } catch (err) {
    console.error('[api/auth] wrong-provider lookup failed — proceeding anyway:', err)
  }

  // ── Sprint 6b + GTM: build the redirect URL ─────────────────────────────────
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const params  = new URLSearchParams()
  if (body.deviceId) params.set('xd', body.deviceId)
  if (Array.isArray(body.sessionIds) && body.sessionIds.length) {
    params.set('xs', body.sessionIds.slice(0, 40).join(','))
  }
  if (body.utmSource)   params.set('us', body.utmSource)
  if (body.utmCampaign) params.set('uc', body.utmCampaign)
  if (body.utmContent)  params.set('ct', body.utmContent)

  const query = params.toString()
  const emailRedirectTo = `${baseUrl}/auth/callback${query ? `?${query}` : ''}`

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo },
  })

  if (error) {
    console.error('[api/auth] signInWithOtp failed:', error)
    return NextResponse.json({ error: 'Failed to send link' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
