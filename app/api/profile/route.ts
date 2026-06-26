// app/api/profile/route.ts
// SB-1: User profile CRUD.
// GET  — returns the authenticated user's profile (null if none).
// POST — upserts the profile. Requires auth.

import { createServiceClient, createClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

// ── Shared auth helper ─────────────────────────────────────────────────────────
async function getUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  try {
    const anon = createClient()
    const { data: { user } } = await anon.auth.getUser(auth.slice(7).trim())
    return user?.id ?? null
  } catch { return null }
}

// ── GET ────────────────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ profile: null })

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error && error.code !== 'PGRST116') { // PGRST116 = row not found
    console.error('[Profile GET] DB error:', error)
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 })
  }

  return NextResponse.json({ profile: data ?? null })
}

// ── POST ───────────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const userId = await getUserId(req)
  if (!userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const VALID_ARCHETYPES = ['builder','steward','achiever','connector','protector','challenger']
  const VALID_FEARS      = ['wrong','judgment','loss','missed','safe','irreversible']
  const VALID_LIFE_STAGE = ['building','scaling','transition','legacy']
  const VALID_RISK       = ['conservative','balanced','bold']
  const VALID_MBTI       = [
    'INTJ','INTP','ENTJ','ENTP','INFJ','INFP','ENFJ','ENFP',
    'ISTJ','ISFJ','ESTJ','ESFJ','ISTP','ISFP','ESTP','ESFP',
  ]

  // Validate + sanitise each field (all optional — allow partial saves)
  const archetype   = typeof body.archetype === 'string' && VALID_ARCHETYPES.includes(body.archetype)
    ? body.archetype : null
  const life_stage  = typeof body.life_stage === 'string' && VALID_LIFE_STAGE.includes(body.life_stage)
    ? body.life_stage : null
  const risk_stance = typeof body.risk_stance === 'string' && VALID_RISK.includes(body.risk_stance)
    ? body.risk_stance : null
  const mbti_type   = typeof body.mbti_type === 'string' && VALID_MBTI.includes(body.mbti_type.toUpperCase())
    ? body.mbti_type.toUpperCase() : null
  const primary_fears = Array.isArray(body.primary_fears)
    ? (body.primary_fears as unknown[]).filter((f): f is string => typeof f === 'string' && VALID_FEARS.includes(f)).slice(0, 2)
    : null

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('user_profiles')
    .upsert({
      user_id:      userId,
      archetype,
      primary_fears,
      mbti_type,
      life_stage,
      risk_stance,
      updated_at:   new Date().toISOString(),
    }, { onConflict: 'user_id' })
    .select('*')
    .single()

  if (error) {
    console.error('[Profile POST] DB error:', error)
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 })
  }

  return NextResponse.json({ profile: data })
}
