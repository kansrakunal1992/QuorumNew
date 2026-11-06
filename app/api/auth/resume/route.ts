// app/api/auth/resume/route.ts
// ── Cross-browser sign-in: hand the callback the "pending intent" for this inbox ──────────────────────────────────
//
// POST /api/auth/resume        (Authorization: Bearer <access_token>)
// -> { intent: AuthIntent | null }
//
// Called by /auth/callback right after Supabase has verified the magic link, so the person can be sent back to the
// page they asked for the link from (typically /session/<id>, the Convene gate) even when the link was opened in a
// different browser, or Supabase dropped the link's query string. See lib/auth-intent.ts for the full story.
//
// Authorization: the email is read from the VERIFIED token, never from the request, so only the owner of the inbox
// can read the intent recorded for it. Fails soft: any problem returns { intent: null } and the callback carries on
// with whatever the URL / localStorage still hold — this route must never be able to block a sign-in.

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getUserFromBearer } from '@/lib/audit'
import { INTENT_TTL_MS, sanitizeIntent } from '@/lib/auth-intent'

export async function POST(req: Request) {
  const user = await getUserFromBearer(req)
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const supabase = createServiceClient()
    const since = new Date(Date.now() - INTENT_TTL_MS).toISOString()
    const { data, error } = await supabase
      .from('auth_pending_intents')
      .select('return_to, session_ids, device_id, utm_source, utm_campaign, utm_content')
      .eq('email', user.email.trim().toLowerCase())
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.warn('[api/auth/resume] lookup failed (non-fatal):', error.message)
      return NextResponse.json({ intent: null })
    }
    if (!data) return NextResponse.json({ intent: null })

    return NextResponse.json({
      intent: sanitizeIntent({
        returnTo:    data.return_to,
        sessionIds:  data.session_ids,
        deviceId:    data.device_id,
        utmSource:   data.utm_source,
        utmCampaign: data.utm_campaign,
        utmContent:  data.utm_content,
      }),
    })
  } catch (err) {
    console.warn('[api/auth/resume] threw (non-fatal):', err)
    return NextResponse.json({ intent: null })
  }
}
