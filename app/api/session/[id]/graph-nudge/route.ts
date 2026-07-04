// app/api/session/[id]/graph-nudge/route.ts
// Sprint QW-3 — powers the 6+ session SessionView graph nudge.
//
// Deliberately NOT the full /api/mirror/graph payload: this only needs to
// answer "should anything show, and which variant" — running the full
// tiered fetch (corpus checks, redaction, uncapped edge lists) on every
// session completion would be needless overhead for what's ultimately a
// single boolean + a couple of scalars.
//
// Two variants, mutually exclusive per call:
//   'new-connection' (non-veteran, sessions 6 through VETERAN_SESSION_THRESHOLD-1)
//     — fires when a graph_edges row involving THIS session exists that's
//     newer than the last time this nudge was shown to this user (or any
//     edge at all, if it's never been shown before). Event-gated, not
//     cadence-gated — see the POV doc (item3-4plus-sessions-pov-plan.md)
//     for why this matters: a static recurring message is what causes
//     habituation, a genuine new event is what earns attention.
//   'milestone' (veteran, VETERAN_SESSION_THRESHOLD+ sessions)
//     — fires when the user's total (non-dismissed) edge count has crossed
//     a new rung on the MILESTONES ladder since the last one celebrated.
//     Deliberately NOT session-count-based — a veteran's graph growing is
//     the actual thing worth celebrating, not their session count alone.
//
// Both variants share one cooldown (last_graph_nudge_shown_at) so a user
// can never see either nudge more than once per COOLDOWN_HOURS, regardless
// of how many qualifying events pile up in between.
//
// Auth: session UUID + a real resolved user_id are both required — unlike
// read-only routes such as bias-note, this route WRITES nudge-shown state,
// so (unlike that route) there's no anonymous-session fallback path here.

import { NextResponse }                        from 'next/server'
import { createServiceClient, createClient }   from '@/lib/supabase'

const VETERAN_SESSION_THRESHOLD  = 20
const COOLDOWN_HOURS             = 72
const MILESTONES                 = [10, 25, 50, 100, 250, 500, 1000]
// Mirrors SessionView's own gate (the Option B pictorial graph covers
// sessions 1–5); enforced server-side too rather than trusting the client.
const MIN_SESSION_COUNT_FOR_NUDGE = 6

type NudgeResponse =
  | { show: false }
  | { show: true; variant: 'new-connection'; edgeType: string }
  | { show: true; variant: 'milestone'; edgeCount: number; milestone: number }

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<NudgeResponse>> {
  const { id: sessionId } = await params
  if (!sessionId) return NextResponse.json({ show: false })

  // ── Auth: required, no anonymous fallback (this route writes state) ───────
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return NextResponse.json({ show: false })

  let userId: string | null = null
  try {
    const anon = createClient()
    const { data: { user } } = await anon.auth.getUser(auth.slice(7).trim())
    userId = user?.id ?? null
  } catch {
    userId = null
  }
  if (!userId) return NextResponse.json({ show: false })

  const supabase = createServiceClient()

  // ── Ownership check — the session must actually belong to this user ───────
  const { data: sessionRow } = await supabase
    .from('sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!sessionRow) return NextResponse.json({ show: false })

  // ── Session count — gates eligibility and determines veteran status ───────
  const { count: sessionCount } = await supabase
    .from('sessions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)

  if ((sessionCount ?? 0) < MIN_SESSION_COUNT_FOR_NUDGE) {
    return NextResponse.json({ show: false })
  }

  // ── Shared cooldown check ───────────────────────────────────────────────
  const { data: prefs } = await supabase
    .from('user_preferences')
    .select('last_graph_nudge_shown_at, last_graph_milestone_shown')
    .eq('user_id', userId)
    .maybeSingle()

  const lastShownAt = prefs?.last_graph_nudge_shown_at
    ? new Date(prefs.last_graph_nudge_shown_at as string)
    : null

  if (lastShownAt && (Date.now() - lastShownAt.getTime()) < COOLDOWN_HOURS * 3_600_000) {
    return NextResponse.json({ show: false })
  }

  const isVeteran = (sessionCount ?? 0) >= VETERAN_SESSION_THRESHOLD

  // ── Veteran: milestone check (Option C) ────────────────────────────────
  if (isVeteran) {
    const { count: edgeCount } = await supabase
      .from('graph_edges')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('dismissed_at', null)

    const total          = edgeCount ?? 0
    const eligible        = MILESTONES.filter(m => m <= total)
    const highestReached  = eligible.length ? eligible[eligible.length - 1] : null
    const lastCelebrated  = prefs?.last_graph_milestone_shown ?? 0

    if (highestReached !== null && highestReached > lastCelebrated) {
      await supabase.from('user_preferences').upsert(
        {
          user_id:                    userId,
          last_graph_milestone_shown: highestReached,
          last_graph_nudge_shown_at:  new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )
      return NextResponse.json({
        show:      true,
        variant:   'milestone',
        edgeCount: total,
        milestone: highestReached,
      })
    }
    return NextResponse.json({ show: false })
  }

  // ── Non-veteran: new-edge-since-last-shown check (Option A) ────────────
  // Scoped specifically to edges involving THIS session — "a new connection
  // was just found" should mean the session the person just finished, not
  // an unrelated edge elsewhere in their graph that happens to be fresh.
  let edgeQuery = supabase
    .from('graph_edges')
    .select('edge_type, computed_at')
    .eq('user_id', userId)
    .is('dismissed_at', null)
    .or(`session_id_a.eq.${sessionId},session_id_b.eq.${sessionId}`)
    .order('computed_at', { ascending: false })
    .limit(1)

  if (lastShownAt) {
    edgeQuery = edgeQuery.gt('computed_at', lastShownAt.toISOString())
  }

  const { data: freshEdge } = await edgeQuery.maybeSingle()
  if (!freshEdge) return NextResponse.json({ show: false })

  await supabase.from('user_preferences').upsert(
    { user_id: userId, last_graph_nudge_shown_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  )

  return NextResponse.json({
    show:     true,
    variant:  'new-connection',
    edgeType: freshEdge.edge_type as string,
  })
}
