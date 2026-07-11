// app/api/invite/redeem/route.ts
// Item #16 — individual HNI invite code redemption.
//
// Same hashing/lookup pattern as app/api/institutions/redeem/route.ts
// (SHA-256, lookup by hash, no shared global secret) but a separate table —
// deliberately not merged with the institutional layer.
//
// Redeeming records attribution for the founder-led outreach motion; it
// does not gate access to the Council or anything else, which stays free
// and open per the existing positioning.

import { NextResponse }                      from 'next/server'
import { createServiceClient, createClient } from '@/lib/supabase'
import { createHash }                        from 'crypto'

async function resolveUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  try {
    const anon = createClient()
    const { data: { user } } = await anon.auth.getUser(authHeader.slice(7).trim())
    return user?.id ?? null
  } catch {
    return null
  }
}

function hashCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex')
}

export async function POST(req: Request): Promise<NextResponse> {
  const userId = await resolveUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { code?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const code = (body.code ?? '').trim()
  if (!code) return NextResponse.json({ error: 'code is required' }, { status: 400 })

  const supabase = createServiceClient()

  const { data: invite, error: lookupError } = await supabase
    .from('individual_invite_codes')
    .select('id, max_redemptions, redemption_count, expires_at')
    .eq('code_hash', hashCode(code))
    .maybeSingle()

  if (lookupError) {
    console.error('[invite/redeem] lookup failed:', lookupError.message)
    return NextResponse.json({ error: 'Redemption failed' }, { status: 500 })
  }
  if (!invite) {
    // Intentionally vague — same posture as institutions/redeem's invalid-code response
    return NextResponse.json({ error: 'Invalid invite code' }, { status: 403 })
  }
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This invite code has expired' }, { status: 403 })
  }
  if (invite.redemption_count >= invite.max_redemptions) {
    return NextResponse.json({ error: 'This invite code has already been used' }, { status: 403 })
  }

  // Already redeemed by this exact user — treat as a harmless no-op, not an error.
  const { data: existing } = await supabase
    .from('individual_invite_redemptions')
    .select('id')
    .eq('invite_code_id', invite.id)
    .eq('user_id', userId)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ status: 'already_redeemed' })
  }

  const { error: insertError } = await supabase
    .from('individual_invite_redemptions')
    .insert({ invite_code_id: invite.id, user_id: userId })
  if (insertError) {
    console.error('[invite/redeem] insert failed:', insertError.message)
    return NextResponse.json({ error: 'Redemption failed' }, { status: 500 })
  }

  // Best-effort counter bump — not atomic against a rare simultaneous double
  // redemption race on a max_redemptions > 1 code, but the UNIQUE constraint
  // above already prevents the same user redeeming twice, which is the
  // scenario that actually matters here.
  await supabase
    .from('individual_invite_codes')
    .update({ redemption_count: invite.redemption_count + 1 })
    .eq('id', invite.id)

  return NextResponse.json({ status: 'redeemed' }, { status: 201 })
}
