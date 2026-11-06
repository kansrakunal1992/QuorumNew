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
// Cross-browser hardening: the same information is ALSO stored server-side in auth_pending_intents, keyed by email,
// and recovered by POST /api/auth/resume after sign-in. The query string alone is not reliable — if Supabase does not
// honour emailRedirectTo (Redirect URL allow-list mismatch) it redirects to the Site URL and drops every param. See
// lib/auth-intent.ts for the full explanation.
//
// GTM attribution: utm* fields ride along the same way (?us=&uc=&ct=) so
// app/auth/callback/page.tsx can fire POST /api/auth/link-utm on first
// registration only. This route never writes attribution itself — see that
// route for the write side.

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { checkLimit, getClientIP, tooManyRequests, LIMITS } from '@/lib/rate-limit'
import { sanitizeReturnTo } from '@/lib/return-to'   // Phase 0: send people back where they were
import { sanitizeIntent, cleanSessionIds } from '@/lib/auth-intent'    // cross-browser: server-side pending intent (see that file)

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
    returnTo?:    string | null   // Phase 0
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
    // `filter` is a real, supported GoTrue admin API param (confirmed
    // against Supabase's own docs) but this installed @supabase/supabase-js
    // version's TypeScript types don't declare it on PageParams yet — a
    // type lag, not a runtime issue. Narrow cast here rather than widen
    // the whole call's type.
    const { data: existing, error: lookupError } = await supabase.auth.admin.listUsers({ filter: email } as any)
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
  const linkSessionIds = cleanSessionIds(body.sessionIds)   // uuids only: link_sessions_to_user takes uuid[]
  if (linkSessionIds.length) params.set('xs', linkSessionIds.join(','))
  if (body.utmSource)   params.set('us', body.utmSource)
  if (body.utmCampaign) params.set('uc', body.utmCampaign)
  if (body.utmContent)  params.set('ct', body.utmContent)
  // Phase 0: ?rt= carries a same-origin path (validated) so a link opened in a
  // different browser still lands on the page the person signed in from.
  const returnTo = sanitizeReturnTo(body.returnTo)
  if (returnTo) params.set('rt', returnTo)

  // ── Cross-browser: record the pending intent server-side (best effort — never blocks sending the link) ──
  try {
    const intent = sanitizeIntent({
      returnTo: body.returnTo, sessionIds: body.sessionIds, deviceId: body.deviceId,
      utmSource: body.utmSource, utmCampaign: body.utmCampaign, utmContent: body.utmContent,
    })
    const { error: intentError } = await supabase.from('auth_pending_intents').insert({
      email,
      return_to:    intent.returnTo,
      session_ids:  intent.sessionIds,
      device_id:    intent.deviceId,
      utm_source:   intent.utmSource,
      utm_campaign: intent.utmCampaign,
      utm_content:  intent.utmContent,
    })
    if (intentError) console.warn('[api/auth] pending intent not stored (non-fatal):', intentError.message)
    // Opportunistic cleanup — rows are only honoured for 1 hour, so anything older than a day is dead weight.
    await supabase.from('auth_pending_intents').delete().lt('created_at', new Date(Date.now() - 24 * 3600_000).toISOString())
  } catch (err) {
    console.warn('[api/auth] pending intent threw (non-fatal):', err)
  }

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
