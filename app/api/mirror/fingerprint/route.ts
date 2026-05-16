// app/api/mirror/fingerprint/route.ts
// ── Mirror Module: Bias Fingerprint Route (Sprint 7b) ─────────────────────────
//
// GET /api/mirror/fingerprint
//
// Auth-gated: requires valid Bearer token (user_id)
// Access-gated: requires mirror_access row for this user
//
// Returns FingerprintData:
//   narrative:      AI-generated personal decision profile (null if < 2 confirmed)
//   confirmedTiles: detection_count >= 2 — full tiles with interpretation
//   formingTiles:   detection_count == 1 — label + "forming" state, no interpretation
//   sessionCount:   total sessions for this user
//   generatedAt:    ISO timestamp
//
// Generation is ~4–6s (one AI call). The route does NOT cache server-side;
// the client caches within the session. On Mirror page re-visit, fingerprint
// is re-fetched only if the page is hard-reloaded or tab is closed/reopened.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }       from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { buildFingerprint }   from '@/lib/mirror-fingerprint'
import { getMirrorAccessState } from '@/lib/mirror-access'

export async function GET(req: Request) {
  const supabase = createServiceClient()

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

  // ── 2. Check mirror access state ──────────────────────────────────────────
  const accessState = await getMirrorAccessState(userId, supabase)
  if (accessState !== 'unlocked') {
    return NextResponse.json({ error: 'Mirror access required' }, { status: 403 })
  }

  // ── 3. Build fingerprint ───────────────────────────────────────────────────
  try {
    const fingerprint = await buildFingerprint(userId)
    return NextResponse.json(fingerprint)
  } catch (err) {
    console.error('[mirror/fingerprint] buildFingerprint error:', err)
    return NextResponse.json(
      { error: 'Fingerprint generation failed' },
      { status: 500 },
    )
  }
}
