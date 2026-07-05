// app/api/mirror/advisory-request/route.ts
// ── Mirror Advisory — Request Access (Sprint M7) ─────────────────────────────
//
// Backs the "Request access" CTA on AdvisoryUpsellCard. Advisory is a capped-
// cohort, manually-granted tier (see app/api/admin/grant-mirror-access) — this
// route doesn't grant anything, it just records interest so a 'mirror' tier
// user has a real next step instead of the previous dead-end upsell card, and
// gives a queue to work from (supabase.advisory_access_requests, status
// 'pending' by default) instead of nothing.
//
// GET  — returns the current user's existing request (or null), so the UI
//        can show "Request sent" on return visits without resubmitting.
// POST — creates (or upserts) a request. Body: { source: 'benchmark' |
//        'sriNextMove' | 'contradictionDetail' }
//
// Auth: Bearer token required for both, same pattern as the rest of
// app/api/mirror/*. Restricted server-side to 'mirror' tier — someone on the
// free/locked tier hitting this directly wouldn't make sense (they haven't
// subscribed to the tier this upgrades from), and an 'advisory' user
// requesting Advisory is a no-op we don't need to record.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { getMirrorAccessState } from '@/lib/mirror-access'

const VALID_SOURCES = ['benchmark', 'sriNextMove', 'contradictionDetail'] as const
type Source = typeof VALID_SOURCES[number]

async function resolveUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  try {
    const anonClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
    const { data: { user } } = await anonClient.auth.getUser(token)
    return user?.id ?? null
  } catch {
    return null
  }
}

export async function GET(req: Request) {
  const supabase = createServiceClient()
  const userId = await resolveUserId(req)
  if (!userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('advisory_access_requests')
    .select('status, created_at, source')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('[AdvisoryRequest] GET error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  return NextResponse.json({ request: data ?? null })
}

export async function POST(req: Request) {
  const supabase = createServiceClient()
  const userId = await resolveUserId(req)
  if (!userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  let body: { source?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const source = body.source
  if (!source || !VALID_SOURCES.includes(source as Source)) {
    return NextResponse.json(
      { error: `source must be one of: ${VALID_SOURCES.join(', ')}` },
      { status: 400 },
    )
  }

  // Only 'mirror' tier can request the upgrade — see file header for why.
  const accessState = await getMirrorAccessState(userId, supabase)
  if (accessState !== 'unlocked') {
    return NextResponse.json({ error: 'Mirror access required' }, { status: 403 })
  }

  const { data: mirrorAccess } = await supabase
    .from('mirror_access')
    .select('access_type')
    .eq('user_id', userId)
    .maybeSingle()

  if (mirrorAccess?.access_type === 'advisory') {
    return NextResponse.json({ error: 'Already on Advisory' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('advisory_access_requests')
    .upsert(
      { user_id: userId, source, status: 'pending' },
      { onConflict: 'user_id', ignoreDuplicates: false },
    )
    .select('status, created_at, source')
    .single()

  if (error) {
    console.error('[AdvisoryRequest] POST error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  return NextResponse.json({ request: data })
}
