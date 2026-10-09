// app/api/prediction-tally/route.ts
// -- Phase 1 (retention work): "Quorum has guessed right N of M" ---------------
// POST { ids?: string[], deviceId?: string }  (+ optional Bearer token)
//
// Returns ONLY aggregate counts -- { guessed, total } -- over this person's
// decisions that have a recorded outcome for Quorum's prediction
// (sessions.prediction_matched_final, written by /api/session/[id]/decide).
// No decision text or per-session detail leaves this route, so accepting ids /
// a device id from an anonymous caller (the same trust level as /api/history)
// reveals nothing beyond two integers.

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase'
import { checkLimit, getClientIP, LIMITS } from '@/lib/rate-limit'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request) {
  const rl = checkLimit(getClientIP(req), LIMITS.events)
  if (!rl.allowed) return NextResponse.json({ guessed: 0, total: 0 })

  try {
    const body = await req.json().catch(() => ({})) as { ids?: unknown; deviceId?: unknown }
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)).slice(0, 100)
      : []
    const deviceId = typeof body.deviceId === 'string' && body.deviceId.length > 0 && body.deviceId.length <= 80
      ? body.deviceId : null

    let userId: string | null = null
    const authHeader = req.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const { data: { user } } = await createClient().auth.getUser(authHeader.slice(7).trim())
        userId = user?.id ?? null
      } catch { /* anonymous */ }
    }

    if (!ids.length && !userId && !deviceId) return NextResponse.json({ guessed: 0, total: 0 })

    const supabase = createServiceClient()
    const seen = new Map<string, boolean>()
    const collect = (rows: Array<{ id: string; prediction_matched_final: boolean | null }> | null) => {
      for (const r of rows ?? []) {
        if (r.prediction_matched_final === null || r.prediction_matched_final === undefined) continue
        seen.set(r.id, r.prediction_matched_final === true)
      }
    }
    const cols = 'id, prediction_matched_final'

    if (ids.length) {
      const { data } = await supabase.from('sessions').select(cols).in('id', ids).not('prediction_matched_final', 'is', null)
      collect(data as any)
    }
    if (userId) {
      const { data } = await supabase.from('sessions').select(cols).eq('user_id', userId).not('prediction_matched_final', 'is', null)
      collect(data as any)
    }
    if (deviceId) {
      const { data } = await supabase.from('sessions').select(cols).eq('device_id', deviceId).not('prediction_matched_final', 'is', null)
      collect(data as any)
    }

    let guessed = 0
    seen.forEach(v => { if (v) guessed++ })
    return NextResponse.json({ guessed, total: seen.size })
  } catch (err) {
    console.warn('[api/prediction-tally] failed:', err)
    return NextResponse.json({ guessed: 0, total: 0 })
  }
}
