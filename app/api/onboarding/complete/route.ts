// app/api/onboarding/complete/route.ts
// Item #3 fix: persists home-tour completion/skip server-side so a user who
// logs in from a different device/browser doesn't see the tour again — the
// tour was previously gated only by localStorage, which is device-local.
//
// Deliberately a separate, narrow endpoint rather than folded into
// /api/profile's POST — that route validates a fixed allow-list of
// psychographic fields (archetype, mbti_type, etc.) and this is an
// unrelated, single boolean-ish flag.
//
// P0 fix: the Home tour got this cross-device fix, but the Council (Session
// View) and Record page tours did not — they were still localStorage-only,
// so an established user (real decisions on record) opening the app on a
// fresh device/PWA install would see those tours again from scratch. This
// endpoint now accepts an optional `tour` param and writes to the matching
// column. Omitting `tour` keeps prior behaviour (home tour) for any existing
// callers.

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

// tour → column map. Keeping this as an explicit allow-list (rather than
// string-interpolating a column name) avoids ever building a dynamic column
// reference from client input.
const TOUR_COLUMNS = {
  home:    'onboarding_tour_completed_at',
  council: 'council_tour_completed_at',
  record:  'record_tour_completed_at',
} as const
type TourKey = keyof typeof TOUR_COLUMNS

export async function POST(req: Request) {
  const userId = await getUserId(req)
  if (!userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  let tour: TourKey = 'home'
  try {
    const body = await req.json()
    if (body?.tour && Object.prototype.hasOwnProperty.call(TOUR_COLUMNS, body.tour)) {
      tour = body.tour as TourKey
    }
  } catch {
    // No body (or invalid JSON) — fall back to 'home', matching the
    // endpoint's original behaviour before the `tour` param existed.
  }

  const column   = TOUR_COLUMNS[tour]
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('user_profiles')
    .upsert({
      user_id: userId,
      [column]: new Date().toISOString(),
    }, { onConflict: 'user_id' })

  if (error) {
    console.error('[Onboarding Complete] DB error:', error)
    return NextResponse.json({ error: 'Failed to record onboarding completion' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, tour })
}
