// app/api/onboarding/complete/route.ts
// Item #3 fix: persists home-tour completion/skip server-side so a user who
// logs in from a different device/browser doesn't see the tour again — the
// tour was previously gated only by localStorage, which is device-local.
//
// Deliberately a separate, narrow endpoint rather than folded into
// /api/profile's POST — that route validates a fixed allow-list of
// psychographic fields (archetype, mbti_type, etc.) and this is an
// unrelated, single boolean-ish flag.

import { createServiceClient, createClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

// ── Shared auth helper (mirrors app/api/profile/route.ts) ─────────────────────
async function getUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  try {
    const anon = createClient()
    const { data: { user } } = await anon.auth.getUser(auth.slice(7).trim())
    return user?.id ?? null
  } catch { return null }
}

export async function POST(req: Request) {
  const userId = await getUserId(req)
  if (!userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('user_profiles')
    .upsert({
      user_id: userId,
      onboarding_tour_completed_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

  if (error) {
    console.error('[Onboarding Complete] DB error:', error)
    return NextResponse.json({ error: 'Failed to record onboarding completion' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
