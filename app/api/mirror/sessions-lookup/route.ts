// app/api/mirror/sessions-lookup/route.ts
// ── Sprint 20: Source Decision Drawer — Session Preview Endpoint ──────────────
//
// GET /api/mirror/sessions-lookup?ids=<comma-separated session IDs>
//
// Auth-gated: requires valid Bearer token (user_id).
// Access-gated: requires mirror_access row.
// Ownership-gated: only returns sessions belonging to the authenticated user.
//
// Sprint 20 fix: removed decision_text truncation (full text returned),
// cap raised from 10 to 30.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { getMirrorAccessState } from '@/lib/mirror-access'

const MAX_IDS = 30   // raised from 10

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
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const userId = await resolveUserId(req)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  // ── 2. Mirror access gate ──────────────────────────────────────────────────
  const accessState = await getMirrorAccessState(userId, supabase)
  if (accessState !== 'unlocked') {
    return NextResponse.json({ error: 'Mirror access required' }, { status: 403 })
  }

  // ── 3. Parse and validate session IDs ─────────────────────────────────────
  const url    = new URL(req.url)
  const idsRaw = url.searchParams.get('ids') ?? ''
  const ids    = idsRaw
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .slice(0, MAX_IDS)

  if (ids.length === 0) {
    return NextResponse.json({ sessions: [] })
  }

  // ── 4. Fetch sessions — scoped to this user only ───────────────────────────
  const { data: sessionRows, error } = await supabase
    .from('sessions')
    .select('id, decision_text, created_at')
    .in('id', ids)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(MAX_IDS)

  if (error) {
    console.error('[sessions-lookup] DB error:', error)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  // ── 5. Return full decision_text — no truncation ───────────────────────────
  const sessions = (sessionRows ?? []).map(s => ({
    id:               s.id,
    decision_preview: (s.decision_text as string ?? '').trim(),
    created_at:       s.created_at as string,
  }))

  return NextResponse.json({ sessions })
}
