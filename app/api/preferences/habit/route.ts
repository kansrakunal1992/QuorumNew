// app/api/preferences/habit/route.ts
// -- Phase 2 (retention work): save the D2 cue + cadence for a linked person ---
// POST { cue?: string|null, cadence?: string|null }   Authorization: Bearer <token>
//
// Written to user_preferences (next_decision_cue, brief_cadence). Anonymous
// choices wait in localStorage (lib/habit-prefs.ts) and are flushed here from
// /auth/callback. Values are validated against fixed lists; nothing free-text.

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase'
import { VALID_CUES, VALID_CADENCES } from '@/lib/habit-prefs'

export async function POST(req: Request) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user } } = await createClient().auth.getUser(authHeader.slice(7).trim())
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null) as { cue?: unknown; cadence?: unknown } | null
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const update: Record<string, string | null> = {}
  if (body.cue !== undefined) {
    if (body.cue !== null && !VALID_CUES.includes(String(body.cue))) return NextResponse.json({ error: 'Invalid cue' }, { status: 400 })
    update.next_decision_cue = body.cue === null ? null : String(body.cue)
  }
  if (body.cadence !== undefined) {
    if (body.cadence !== null && !VALID_CADENCES.includes(String(body.cadence))) return NextResponse.json({ error: 'Invalid cadence' }, { status: 400 })
    update.brief_cadence = body.cadence === null ? null : String(body.cadence)
  }
  if (!Object.keys(update).length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const { error } = await createServiceClient()
    .from('user_preferences')
    .upsert({ user_id: user.id, user_email: user.email ?? null, ...update }, { onConflict: 'user_id' })

  if (error) {
    console.error('[api/preferences/habit] upsert failed:', error.message)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
