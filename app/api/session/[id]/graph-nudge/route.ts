// app/api/session/[id]/graph-nudge/route.ts
// Sprint QW-3 (graph variants) + Sprint W1 (watchlist-suggestion variant) —
// powers the single shared end-of-flow prompt slot in SessionView.
//
// Kept at this path rather than renamed to something more neutral like
// post-session-prompt — a real naming imprecision now that this also returns
// a non-graph variant, flagged deliberately rather than silently left, but
// judged not worth the cascading rename across this route + SessionView.tsx
// for what's a documentation concern, not a correctness one (unlike the
// wrong-TABLE bugs from the earlier audit pass, which this is not an
// instance of).
//
// Deliberately NOT the full /api/mirror/graph payload: this only needs to
// answer "should anything show, and which variant" — running the full
// tiered fetch (corpus checks, redaction, uncapped edge lists) on every
// session completion would be needless overhead for what's ultimately a
// single boolean + a couple of scalars.
//
// Three variants, mutually exclusive per call, tried in this order:
//   1. 'milestone' (veteran, VETERAN_SESSION_THRESHOLD+ sessions) — fires
//      when total (non-dismissed) edge count crosses a new MILESTONES rung.
//   2. 'new-connection' (non-veteran) — fires when a graph_edges row
//      involving THIS session exists that's newer than the last time this
//      slot was shown to this user (or any edge, if never shown before).
//   3. 'watchlist-suggestion' (either cohort, fallback only, Sprint W1) —
//      if neither graph variant fired, and NEXT_PUBLIC_WATCHLIST_ENABLED is
//      on, offers to add this session's first non-empty examiner_gap_N
//      phrase to the person's Watchlist. Deliberately sourced from a field
//      the Examiner already computed for this exact session — never a new
//      detection pass, so this can't become the fake-insight problem the
//      rest of this build has been careful to avoid. Graph variants always
//      win when both are eligible — a real new connection or milestone is
//      treated as the more "earned" moment; the watchlist suggestion is the
//      lower-stakes fallback, not a competing headline.
//
// All three share ONE cooldown (last_graph_nudge_shown_at) — whichever
// variant fires, it updates the same timestamp, so a user can never see
// more than one prompt from this slot per COOLDOWN_HOURS regardless of which
// variant it was.
//
// Auth: session UUID + a real resolved user_id are both required — unlike
// read-only routes such as bias-note, this route WRITES nudge-shown state,
// so (unlike that route) there's no anonymous-session fallback path here.

import { NextResponse }                        from 'next/server'
import { createServiceClient, createClient }   from '@/lib/supabase'
import { isWatchlistEnabled }                  from '@/lib/feature-flags'

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
  | { show: true; variant: 'watchlist-suggestion'; gapText: string }

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
    const fallback = await tryWatchlistSuggestion(supabase, userId, sessionId)
    return NextResponse.json(fallback)
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
  if (!freshEdge) {
    const fallback = await tryWatchlistSuggestion(supabase, userId, sessionId)
    return NextResponse.json(fallback)
  }

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

// ── Watchlist-suggestion fallback (Sprint W1) ────────────────────────────
// Only reached when neither graph variant fired. Sources the suggestion
// from this session's own examiner_gap_1/2/3 — real, already-computed by
// the Examiner during this exact session (see lib/ontology-tagger.ts) —
// never a new detection pass run just to manufacture a prompt.
async function tryWatchlistSuggestion(
  supabase: ReturnType<typeof createServiceClient>,
  userId:   string,
  sessionId: string,
): Promise<NudgeResponse> {
  if (!isWatchlistEnabled()) return { show: false }

  const { data: ont } = await supabase
    .from('sessions_ontology')
    .select('examiner_gap_1, examiner_gap_2, examiner_gap_3')
    .eq('session_id', sessionId)
    .maybeSingle()

  const gapText = [ont?.examiner_gap_1, ont?.examiner_gap_2, ont?.examiner_gap_3]
    .find((g): g is string => typeof g === 'string' && g.trim().length > 0)

  if (!gapText) return { show: false }

  await supabase.from('user_preferences').upsert(
    { user_id: userId, last_graph_nudge_shown_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  )

  return { show: true, variant: 'watchlist-suggestion', gapText: gapText.trim() }
}
