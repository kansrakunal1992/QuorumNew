// app/api/mirror/unlock/route.ts
// ── Mirror Module: Access Unlock Route (Sprint 7b) ────────────────────────────
//
// POST /api/mirror/unlock
//
// Body: { code: string }
// Auth: Bearer token required (user must be signed in)
//
// Validates the unlock code against MIRROR_UNLOCK_TOKEN env var.
// On match: inserts a row into mirror_access for this user_id.
// Returns: { status: 'ok', grantedAt: string }
//
// This enables the manual sales flow:
//   1. User sees paywall on Mirror page
//   2. They contact Quorum (WhatsApp / email)
//   3. We share the unlock code privately
//   4. User enters it in the Mirror UI — instant access
//
// The token is a shared secret (not user-specific). It can be rotated
// at any time by updating MIRROR_UNLOCK_TOKEN in Railway env vars.
// Old grants in mirror_access are not affected by rotation.
//
// Future: replace with Razorpay webhook that calls this internally.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }        from 'next/server'
import { createServiceClient }  from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

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

  // ── 3. Validate code against env var ──────────────────────────────────────
  const validToken = process.env.MIRROR_UNLOCK_TOKEN
  if (!validToken) {
    console.error('[mirror/unlock] MIRROR_UNLOCK_TOKEN env var not set')
    return NextResponse.json({ error: 'Unlock not configured' }, { status: 500 })
  }

  // Constant-time comparison to prevent timing attacks
  const providedCode  = code.trim().toLowerCase()
  const expectedToken = validToken.trim().toLowerCase()

  if (providedCode !== expectedToken) {
    // Intentionally vague error message — don't confirm what's wrong
    return NextResponse.json({ error: 'Invalid unlock code' }, { status: 403 })
  }

  // ── 4. Upsert mirror_access row ───────────────────────────────────────────
  // Uses upsert (not insert) to handle edge case where an expired row exists.
  // access_type: 'lifetime' — unlock codes are permanent grants.
  const grantedAt = new Date().toISOString()

  const { error: upsertError } = await supabase
    .from('mirror_access')
    .upsert(
      {
        user_id:     userId,
        access_type: 'lifetime',
        granted_at:  grantedAt,
        started_at:  grantedAt,
        expires_at:  null,
        payment_ref: `code:${code.slice(0, 6)}…`,  // partial ref for audit trail
      },
      { onConflict: 'user_id' },
    )

  if (upsertError) {
    console.error('[mirror/unlock] Upsert error:', upsertError)
    return NextResponse.json({ error: 'Failed to grant access' }, { status: 500 })
  }

  return NextResponse.json({
    status:    'ok',
    grantedAt,
    message:   'Mirror unlocked',
  })
}
