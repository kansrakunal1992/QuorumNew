// app/api/session/[id]/cross-decision/route.ts
// -- Phase 2 (retention work): the cross-decision line shown after a decision --
// GET -> { line, kind, decisionCount }   (line is null when there is nothing to compare yet)
//
// Powers the D2 "first cross-decision observation" and the rotating one-liner
// after later decisions (components/NextDecisionPrompt.tsx). Deterministic and
// counts-only (lib/cross-decision-observations.ts); returns no decision text.
// Identity comes from the session row itself (user_id, else device_id), so it
// works for anonymous people too. Trust level matches /app/session/[id]: anyone
// holding the session UUID already sees far more than one summary line.

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { checkLimit, getClientIP, LIMITS } from '@/lib/rate-limit'
import { loadDecisionRows } from '@/lib/decision-history'
import { computeObservations, pickObservation } from '@/lib/cross-decision-observations'

interface Params { params: Promise<{ id: string }> }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NONE = { line: null, kind: 'none', decisionCount: 0 }

export async function GET(req: Request, { params }: Params) {
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json(NONE, { status: 400 })

  const rl = checkLimit(getClientIP(req), LIMITS.events)
  if (!rl.allowed) return NextResponse.json(NONE)

  try {
    const supabase = createServiceClient()
    const { data: session } = await supabase
      .from('sessions').select('id, user_id, device_id').eq('id', id).single()
    if (!session) return NextResponse.json(NONE, { status: 404 })

    const rows = await loadDecisionRows(supabase, { userId: session.user_id, deviceId: session.device_id }, { limit: 12 })
    const n = rows.length
    if (n < 2) return NextResponse.json({ ...NONE, decisionCount: n }, { headers: { 'Cache-Control': 'no-store' } })

    const picked = pickObservation(
      computeObservations(rows, { focusId: id }),
      // The running prediction tally is already its own line on the same screen.
      { n, seed: id, exclude: ['prediction'] },
    )
    return NextResponse.json(
      { line: picked.line, kind: picked.kind, decisionCount: n },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.warn('[api/session/cross-decision] failed:', err)
    return NextResponse.json(NONE)
  }
}
