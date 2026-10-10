// app/api/preferences/notifications/route.ts
// -- Phase 4 (retention work): the email preferences behind /settings/notifications
// GET  -> { brief_cadence, daily_nudge_opted_out, validation_nudge_opted_out,
//           weekly_brief_opted_out, pattern_notice_opted_out }
// POST -> same keys (any subset). Authorization: Bearer <token> on both.
//
// Cadence goes through the same validated lists as the D2 card
// (lib/habit-prefs.ts). Choosing 'weekly' also clears weekly_brief_opted_out,
// because picking Weekly again is an explicit opt back in after a one-click
// unsubscribe. Review-date reminders are not controlled here: they are tied to
// a date the person chose for a specific decision.

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase'
import { VALID_CADENCES } from '@/lib/habit-prefs'

const BOOL_KEYS = [
  'daily_nudge_opted_out',
  'validation_nudge_opted_out',
  'weekly_brief_opted_out',
  'pattern_notice_opted_out',
] as const

const DEFAULTS = {
  brief_cadence:              null as string | null,
  daily_nudge_opted_out:      false,
  validation_nudge_opted_out: false,
  weekly_brief_opted_out:     false,
  pattern_notice_opted_out:   false,
}

async function authUser(req: Request) {
  const h = req.headers.get('Authorization')
  if (!h?.startsWith('Bearer ')) return null
  const { data: { user } } = await createClient().auth.getUser(h.slice(7).trim())
  return user ?? null
}

export async function GET(req: Request) {
  const user = await authUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await createServiceClient()
    .from('user_preferences')
    .select('brief_cadence, daily_nudge_opted_out, validation_nudge_opted_out, weekly_brief_opted_out, pattern_notice_opted_out')
    .eq('user_id', user.id)
    .maybeSingle()

  return NextResponse.json({
    brief_cadence:              data?.brief_cadence ?? DEFAULTS.brief_cadence,
    daily_nudge_opted_out:      !!data?.daily_nudge_opted_out,
    validation_nudge_opted_out: !!data?.validation_nudge_opted_out,
    weekly_brief_opted_out:     !!data?.weekly_brief_opted_out,
    pattern_notice_opted_out:   !!data?.pattern_notice_opted_out,
  })
}

export async function POST(req: Request) {
  const user = await authUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const update: Record<string, string | boolean | null> = {}

  for (const k of BOOL_KEYS) {
    if (body[k] === undefined) continue
    if (typeof body[k] !== 'boolean') return NextResponse.json({ error: `Invalid ${k}` }, { status: 400 })
    update[k] = body[k] as boolean
  }
  if (body.brief_cadence !== undefined) {
    if (body.brief_cadence !== null && !VALID_CADENCES.includes(String(body.brief_cadence))) {
      return NextResponse.json({ error: 'Invalid brief_cadence' }, { status: 400 })
    }
    update.brief_cadence = body.brief_cadence === null ? null : String(body.brief_cadence)
    if (update.brief_cadence === 'weekly') update.weekly_brief_opted_out = false
  }
  if (!Object.keys(update).length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const { error } = await createServiceClient()
    .from('user_preferences')
    .upsert({ user_id: user.id, user_email: user.email ?? null, ...update }, { onConflict: 'user_id' })

  if (error) {
    console.error('[api/preferences/notifications] upsert failed:', error.message)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
