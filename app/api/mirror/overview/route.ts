// app/api/mirror/overview/route.ts
// ── v16 Phase 4: what Quorum has learned, what to watch, what to try next ────
//
// GET -> { mode, decisionCount, learned[], watch[], next[] }   (see lib/mirror-insights.ts for what each insight is)
//
// NOT behind the Mirror paywall. Every insight is a count over the person's own decisions, deterministic, with no model call,
// so there is nothing costly to protect and no reason to hide the first evidence-backed look from someone deciding whether the
// Mirror is worth having. The deeper Mirror (fingerprint, rules, contradictions, calibration) stays behind its existing gate.
//
// v17: the owner form also carries at most one stored contradiction (labelled as Quorum's reading, dismissable) and the calibration
// insights; the anonymous form carries the counts-only ones. Contradictions are never in the anonymous form.
//
// Two ways in, with deliberately different reach:
//
//   Authorization: Bearer <token>   the signed-in OWNER. Gets the decisions each insight rests on (ids + first words of each
//                                   decision) so every claim can be checked. Rows come from the account, plus any rows that
//                                   only share the device id passed as ?did=.
//   ?sid=<session uuid>             an anonymous person, identified the same way as /api/session/[id]/cross-decision: by the
//                                   session row's own user_id / device_id. Gets claims, confidence and COUNTS ONLY: no
//                                   decision text and no ids of other sessions, because a session id is a capability (it opens
//                                   that session's page) and one id must not hand out the ids of the others.

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { checkLimit, getClientIP, LIMITS } from '@/lib/rate-limit'
import { getUserFromBearer } from '@/lib/audit'
import { loadInsightRows, loadStoredContradictions } from '@/lib/decision-history'
import { buildContradictionInsight, buildInsights } from '@/lib/mirror-insights'
import type { MirrorOverviewData } from '@/lib/mirror-insights'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NO_STORE = { 'Cache-Control': 'no-store' }
const EMPTY: MirrorOverviewData = { decisionCount: 0, learned: [], watch: [], next: [] }

export async function GET(req: Request) {
  const rl = checkLimit(getClientIP(req), LIMITS.events)
  if (!rl.allowed) return NextResponse.json({ mode: 'session', ...EMPTY }, { headers: NO_STORE })

  try {
    const supabase = createServiceClient()
    const url = new URL(req.url)

    const user = await getUserFromBearer(req)
    if (user) {
      const rows = await loadInsightRows(
        supabase,
        { userId: user.id, deviceId: url.searchParams.get('did') },
        { limit: 12, withSnippets: true },
      )
      const overview = buildInsights(rows, { withEvidence: true })
      // v17: one stored contradiction, if one is safe to show. Owner only: it quotes the person's own words, and it is a model's
      // reading rather than a count, so it is never part of the anonymous (session id) form below.
      // Runtime switch (no rebuild): MIRROR_OVERVIEW_CONTRADICTIONS=off hides it. It is the one insight here that is a model's reading.
      try {
        if (process.env.MIRROR_OVERVIEW_CONTRADICTIONS === 'off') throw new Error('disabled')
        const { stored, sessions } = await loadStoredContradictions(supabase, user.id)
        const c = buildContradictionInsight(stored, sessions)
        if (c) overview.watch.push(c)
      } catch (e) { console.warn('[api/mirror/overview] contradictions skipped:', e) }
      return NextResponse.json({ mode: 'owner', ...overview }, { headers: NO_STORE })
    }

    const sid = url.searchParams.get('sid') ?? ''
    if (!UUID_RE.test(sid)) return NextResponse.json({ mode: 'session', ...EMPTY }, { status: 400, headers: NO_STORE })
    const { data: session } = await supabase.from('sessions').select('id, user_id, device_id').eq('id', sid).single()
    if (!session) return NextResponse.json({ mode: 'session', ...EMPTY }, { status: 404, headers: NO_STORE })

    const rows = await loadInsightRows(
      supabase,
      { userId: session.user_id, deviceId: session.device_id },
      { limit: 12, withSnippets: false },
    )
    return NextResponse.json({ mode: 'session', ...buildInsights(rows, { withEvidence: false }) }, { headers: NO_STORE })
  } catch (err) {
    console.warn('[api/mirror/overview] failed:', err)
    return NextResponse.json({ mode: 'session', ...EMPTY }, { headers: NO_STORE })
  }
}
