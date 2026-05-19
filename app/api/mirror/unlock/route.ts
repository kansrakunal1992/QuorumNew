// app/api/mirror/unlock/route.ts
// ── Mirror Module: Access Unlock Route (Sprint 19) ────────────────────────────
//
// POST /api/mirror/unlock
//
// Body: { code: string }
// Auth: Bearer token required (user must be signed in)
//
// Validates the unlock code against three Railway env vars:
//   MIRROR_TOKEN_MONTHLY   → grants monthly access (30 days)
//   MIRROR_TOKEN_ANNUAL    → grants annual access (365 days)
//   MIRROR_TOKEN_LIFETIME  → grants lifetime access (no expiry)
//
// Each token is a shared secret — share the appropriate one privately
// (WhatsApp / email) after payment. Rotate any token in Railway at any time;
// existing mirror_access rows are unaffected by rotation.
//
// Legacy: MIRROR_UNLOCK_TOKEN still accepted as lifetime fallback
//         so existing shared codes don't break on deploy.
//
// Future: replace with Razorpay webhook that calls /api/payment/create-subscription.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }        from 'next/server'
import { createServiceClient }  from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

function getExpiresAt(accessType: 'monthly' | 'annual' | 'lifetime'): string | null {
  if (accessType === 'lifetime') return null
  const d = new Date()
  if (accessType === 'monthly') d.setDate(d.getDate() + 30)
  if (accessType === 'annual')  d.setDate(d.getDate() + 365)
  return d.toISOString()
}

export async function POST(req: Request) {
  // ── 1. Resolve user_id from Bearer token ──────────────────────────────────
  let userId: string | null = null

  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    try {
      const anonClient = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      )
      const { data: { user } } = await anonClient.auth.getUser(token)
      userId = user?.id ?? null
    } catch {
      // Invalid token
    }
  }

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── 2. Validate request body ───────────────────────────────────────────────
  let body: { code?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { code } = body
  if (!code || typeof code !== 'string') {
    return NextResponse.json({ error: 'Unlock code required' }, { status: 400 })
  }

  // ── 3. Match code against all three token env vars ────────────────────────
  // Also accepts legacy MIRROR_UNLOCK_TOKEN as lifetime fallback.
  const provided = code.trim().toLowerCase()

  const tokenMap: Array<{ envKey: string; accessType: 'monthly' | 'annual' | 'lifetime' }> = [
    { envKey: 'MIRROR_TOKEN_MONTHLY',  accessType: 'monthly'  },
    { envKey: 'MIRROR_TOKEN_ANNUAL',   accessType: 'annual'   },
    { envKey: 'MIRROR_TOKEN_LIFETIME', accessType: 'lifetime' },
    { envKey: 'MIRROR_UNLOCK_TOKEN',   accessType: 'lifetime' }, // legacy fallback
  ]

  let matchedType: 'monthly' | 'annual' | 'lifetime' | null = null

  for (const { envKey, accessType } of tokenMap) {
    const envVal = process.env[envKey]
    if (envVal && provided === envVal.trim().toLowerCase()) {
      matchedType = accessType
      break
    }
  }

  if (!matchedType) {
    // Intentionally vague — don't confirm what's wrong
    return NextResponse.json({ error: 'Invalid unlock code' }, { status: 403 })
  }

  // ── 4. Upsert mirror_access row ───────────────────────────────────────────
  const supabase   = createServiceClient()
  const grantedAt  = new Date().toISOString()
  const expiresAt  = getExpiresAt(matchedType)

  const { error: upsertError } = await supabase
    .from('mirror_access')
    .upsert(
      {
        user_id:     userId,
        access_type: matchedType,
        granted_at:  grantedAt,
        started_at:  grantedAt,
        expires_at:  expiresAt,
        payment_ref: `code:${code.trim().slice(0, 6)}…`,
      },
      { onConflict: 'user_id' },
    )

  if (upsertError) {
    console.error('[mirror/unlock] Upsert error:', upsertError)
    return NextResponse.json({ error: 'Failed to grant access' }, { status: 500 })
  }

  console.log(`[mirror/unlock] Granted ${matchedType} to ${userId} (expires: ${expiresAt ?? 'never'})`)

  return NextResponse.json({
    status:     'ok',
    accessType: matchedType,
    expiresAt,
    grantedAt,
    message:    'Mirror unlocked',
  })
}
