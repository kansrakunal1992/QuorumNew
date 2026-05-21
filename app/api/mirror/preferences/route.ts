// app/api/mirror/preferences/route.ts
// Sprint 21: Style calibration preference store
//
// GET  /api/mirror/preferences  — returns { style_cue: string | null }
// POST /api/mirror/preferences  — upserts style_cue for the authenticated user
//
// Auth-gated: requires valid Bearer token.
// Mirror-access gated: unlocked state only.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }              from 'next/server'
import { createServiceClient }        from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { getMirrorAccessState }       from '@/lib/mirror-access'

const VALID_STYLE_CUES = ['direct', 'challenge', 'pattern', 'risk', 'stakeholder', 'long'] as const
type StyleCue = typeof VALID_STYLE_CUES[number]

// ── Auth helper ───────────────────────────────────────────────────────────────
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

// ── GET: fetch current style_cue ──────────────────────────────────────────────
export async function GET(req: Request) {
  const supabase = createServiceClient()

  const userId = await resolveUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const accessState = await getMirrorAccessState(userId, supabase)
  if (accessState !== 'unlocked') {
    return NextResponse.json({ error: 'Mirror access required' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('user_preferences')
    .select('style_cue')
    .eq('user_id', userId)
    .single()

  if (error && error.code !== 'PGRST116') {
    console.error('[mirror/preferences] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch preferences' }, { status: 500 })
  }

  return NextResponse.json({ style_cue: data?.style_cue ?? null })
}

// ── POST: save style_cue ──────────────────────────────────────────────────────
export async function POST(req: Request) {
  const supabase = createServiceClient()

  const userId = await resolveUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const accessState = await getMirrorAccessState(userId, supabase)
  if (accessState !== 'unlocked') {
    return NextResponse.json({ error: 'Mirror access required' }, { status: 403 })
  }

  let body: { style_cue?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const cue = body.style_cue as StyleCue
  if (!cue || !VALID_STYLE_CUES.includes(cue)) {
    return NextResponse.json(
      { error: `style_cue must be one of: ${VALID_STYLE_CUES.join(', ')}` },
      { status: 400 },
    )
  }

  const { error } = await supabase
    .from('user_preferences')
    .upsert({ user_id: userId, style_cue: cue }, { onConflict: 'user_id' })

  if (error) {
    console.error('[mirror/preferences] POST error:', error)
    return NextResponse.json({ error: 'Failed to save preference' }, { status: 500 })
  }

  console.log(`[mirror/preferences] style_cue='${cue}' saved for user ${userId}`)
  return NextResponse.json({ ok: true, style_cue: cue })
}
