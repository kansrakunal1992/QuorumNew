// app/api/mirror/graph/route.ts
// ── Decision Graph Query API (Sprint G2, tiered Sprint QW-2) ─────────────────
//
// GET /api/mirror/graph
//   ?types=structural_similarity,contradiction,shared_bias_trigger,...
//   (omit to get all edge types; dismissed edges excluded by default)
//   ?include_dismissed=true  (admin/debug only)
//
// Auth: Bearer token → resolveUserId (same helper as all Mirror routes)
//
// ── Access tiers (Sprint QW-2 — was a single unlocked-only gate) ─────────────
// The graph used to be all-or-nothing: getMirrorAccessState === 'unlocked'
// AND a 20-session/3-edge corpus, or nothing at all. That meant (a) free
// users never saw the product's most differentiated asset before paying,
// and (b) paying subscribers under 20 sessions saw an empty graph too —
// a retention bug, not a deliberate paywall. Both are fixed by splitting
// into three tiers, gated primarily by WHETHER edges exist and WHETHER the
// user has paid, not by an arbitrary large corpus:
//
//   locked  — sessionCount < MIN_PREVIEW_SESSIONS (2). No edges are possible
//             yet. Response carries at most a single self-node so the client
//             can render a "your first decision is mapped" ghost state.
//   preview — sessionCount >= MIN_PREVIEW_SESSIONS AND NOT (paid + full
//             corpus met). Real edges are returned — the fact that a
//             connection exists is the hook — but dimension_breakdown,
//             explanation_text, and metadata are stripped server-side
//             (never trust client-side hiding for this: the interpretive
//             "why" is the paid layer, same principle already used for
//             ADVISORY_BYPASSES_THRESHOLDS's contradiction-detail gating).
//             Capped to PREVIEW_MAX_EDGES, strongest first; the remainder
//             is surfaced only as a count (corpus.locked_edge_count) —
//             enough to create real incentive to unlock, not enough to
//             give away the analysis itself.
//   full    — accessState === 'unlocked' AND (Advisory bypass OR corpus
//             met). Unchanged from the original behaviour: full detail,
//             uncapped.
//
// MIN_GRAPH_SESSIONS / MIN_GRAPH_EDGES now gate the preview→full transition
// for PAYING users only (previously gated whether any graph existed at all,
// default 20/3). Defaults lowered to 2/1 — a paying subscriber should not
// have to reach 20 sessions to see their own graph in full. If you have
// these env vars explicitly set in Railway from before, they still apply;
// update them if you want paying users to reach 'full' sooner.
//
// Response:
//   { nodes: GraphNode[], edges: GraphEdge[], tier, corpus }
//
//   nodes — unique sessions referenced in returned edges (plus the single
//     ghost node in the 'locked' tier), 120-char decision snippet
//     (decrypted) and status.
//
//   edges — decrypted GraphEdge[], sorted by strength DESC then computed_at
//     DESC. dimension_breakdown/explanation_text/metadata are null and
//     redacted:true when tier === 'preview'; preserved as-is for 'full'.
//
//   corpus — always returned so the client can show a meaningful gate
//     message rather than an empty graph with no explanation. Now
//     tier-aware: min_sessions/min_edges describe what's needed for the
//     NEXT tier up, not a single fixed threshold.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }            from 'next/server'
import { createServiceClient }     from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { getMirrorAccessState, getMirrorTier } from '@/lib/mirror-access'
import { ADVISORY_BYPASSES_THRESHOLDS }        from '@/lib/mirror-tier-config'
import { decryptGraphEdge, type GraphEdge, type EdgeType } from '@/lib/graph-engine'
import { decrypt }                 from '@/lib/encryption'

// ── Tier thresholds ────────────────────────────────────────────────────────
const MIN_PREVIEW_SESSIONS = Number(process.env.MIN_PREVIEW_SESSIONS ?? 2)
const PREVIEW_MAX_EDGES    = Number(process.env.PREVIEW_MAX_EDGES    ?? 2)

// Gate the preview → full transition for PAID users. Defaults lowered from
// the original 20/3 (Sprint QW-2) — see header comment.
const MIN_GRAPH_SESSIONS = Number(process.env.MIN_GRAPH_SESSIONS ?? 2)
const MIN_GRAPH_EDGES    = Number(process.env.MIN_GRAPH_EDGES    ?? 1)

const VALID_EDGE_TYPES: EdgeType[] = [
  'structural_similarity',
  'contradiction',
  'shared_bias_trigger',
  'shared_decision_type',
  'user_asserted',
]

export type GraphTier = 'locked' | 'preview' | 'full'

export interface GraphNode {
  id:               string
  decision_snippet: string  // 120-char, decrypted
  created_at:       string
  status:           string
}

// Response edge shape — same as GraphEdge but with an explicit `redacted`
// flag so the client can distinguish "computed and genuinely empty" from
// "stripped because you're on the preview tier" without guessing from nulls.
export interface ResponseEdge {
  id:                  string
  session_id_a:        string
  session_id_b:        string
  edge_type:           EdgeType
  strength:            number | null
  dimension_breakdown: GraphEdge['dimension_breakdown']
  explanation_text:    string | null
  metadata:            Record<string, unknown> | null
  dismissed_at:        string | null
  computed_at:         string
  redacted:            boolean
}

// ── Auth helper (same pattern as all Mirror routes) ──────────────────────────
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

export async function GET(req: Request): Promise<NextResponse> {
  const supabase = createServiceClient()

  // ── 1. Auth ───────────────────────────────────────────────────────────────
  const userId = await resolveUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── 2. Access state + session count (needed for every tier decision) ──────
  const [accessState, tier, { count: sessionCountRaw }] = await Promise.all([
    getMirrorAccessState(userId, supabase),
    getMirrorTier(userId, supabase),
    supabase.from('sessions').select('*', { count: 'exact', head: true }).eq('user_id', userId),
  ])
  const sessionCount = sessionCountRaw ?? 0
  const isAdvisory   = tier === 'advisory' && ADVISORY_BYPASSES_THRESHOLDS
  const isPaid       = accessState === 'unlocked'

  // ── 3. Locked tier — not enough sessions for any connection to exist ──────
  if (sessionCount < MIN_PREVIEW_SESSIONS) {
    // Surface the single most recent session as a ghost node so the client
    // can render "your first decision is mapped" instead of a blank state.
    let nodes: GraphNode[] = []
    if (sessionCount === 1) {
      const { data: onlySession } = await supabase
        .from('sessions')
        .select('id, decision_text, created_at, status')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (onlySession) {
        const fullText = decrypt(onlySession.decision_text) ?? ''
        nodes = [{
          id:               onlySession.id as string,
          decision_snippet: fullText.length > 120 ? fullText.slice(0, 117) + '…' : fullText,
          created_at:       onlySession.created_at as string,
          status:           onlySession.status as string,
        }]
      }
    }

    return NextResponse.json({
      nodes,
      edges: [] as ResponseEdge[],
      tier: 'locked' as GraphTier,
      corpus: {
        met:               false,
        tier:              'locked' as GraphTier,
        session_count:     sessionCount,
        min_sessions:      MIN_PREVIEW_SESSIONS,
        min_edges:         0,
        locked_edge_count: 0,
      },
    })
  }

  // ── 4. Query params ───────────────────────────────────────────────────────
  const url = new URL(req.url)
  const typesParam = url.searchParams.get('types')
  const requestedTypes: EdgeType[] = typesParam
    ? typesParam.split(',').filter((t): t is EdgeType => VALID_EDGE_TYPES.includes(t as EdgeType))
    : VALID_EDGE_TYPES
  const includeDismissed = url.searchParams.get('include_dismissed') === 'true'

  // ── 5. Fetch edges (preview and full tiers both need the real edge set —
  //      preview redacts afterwards, it doesn't query differently) ──────────
  let edgeQuery = supabase
    .from('graph_edges')
    .select('id, user_id, session_id_a, session_id_b, edge_type, strength, dimension_breakdown, explanation_text, metadata, dismissed_at, computed_at')
    .eq('user_id', userId)
    .in('edge_type', requestedTypes)
    .order('strength', { ascending: false })
    .order('computed_at', { ascending: false })

  if (!includeDismissed) {
    edgeQuery = edgeQuery.is('dismissed_at', null)
  }

  const { data: rawEdges, error: edgeErr } = await edgeQuery
  if (edgeErr) {
    console.error('[mirror/graph] edge fetch failed:', edgeErr.message)
    return NextResponse.json({ error: 'Failed to fetch graph' }, { status: 500 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allEdges: GraphEdge[] = (rawEdges ?? []).map((r: any) => decryptGraphEdge(r))

  // ── 6. Determine tier now that we know the real edge count ────────────────
  const realEdgeCount = allEdges.length
  const fullCorpusMet = isAdvisory || (sessionCount >= MIN_GRAPH_SESSIONS && realEdgeCount >= MIN_GRAPH_EDGES)
  const graphTier: GraphTier = (isPaid && fullCorpusMet) ? 'full' : 'preview'

  // ── 7. Select which edges are shown, and redact if preview ────────────────
  const selectedEdges = graphTier === 'full' ? allEdges : allEdges.slice(0, PREVIEW_MAX_EDGES)
  const lockedEdgeCount = graphTier === 'full' ? 0 : Math.max(0, realEdgeCount - selectedEdges.length)

  const responseEdges: ResponseEdge[] = selectedEdges.map(e => ({
    id:                  e.id,
    session_id_a:        e.session_id_a,
    session_id_b:        e.session_id_b,
    edge_type:           e.edge_type,
    strength:            e.strength,
    dimension_breakdown: graphTier === 'full' ? e.dimension_breakdown : null,
    explanation_text:    graphTier === 'full' ? e.explanation_text    : null,
    metadata:            graphTier === 'full' ? e.metadata            : null,
    dismissed_at:        e.dismissed_at,
    computed_at:         e.computed_at,
    redacted:            graphTier !== 'full',
  }))

  // ── 8. Collect node IDs from the edges we're actually returning ───────────
  // (Preview tier intentionally does NOT expose nodes for edges it isn't
  // showing — an isolated node with no visible edge would be a rendering
  // artifact, not a feature, and would leak graph size beyond what's shown.)
  const sessionIdSet = new Set<string>()
  for (const edge of responseEdges) {
    sessionIdSet.add(edge.session_id_a)
    sessionIdSet.add(edge.session_id_b)
  }

  const corpusBase = {
    tier:              graphTier,
    session_count:     sessionCount,
    min_sessions:      graphTier === 'full' ? 0 : MIN_GRAPH_SESSIONS,
    min_edges:         graphTier === 'full' ? 0 : MIN_GRAPH_EDGES,
    locked_edge_count: lockedEdgeCount,
  }

  if (sessionIdSet.size === 0) {
    return NextResponse.json({
      nodes: [] as GraphNode[],
      edges: [] as ResponseEdge[],
      tier: graphTier,
      corpus: { met: true, ...corpusBase },
    })
  }

  // ── 9. Fetch node data ────────────────────────────────────────────────────
  const { data: sessionRows, error: sessErr } = await supabase
    .from('sessions')
    .select('id, decision_text, created_at, status')
    .in('id', Array.from(sessionIdSet))
    .eq('user_id', userId)   // re-confirm ownership — never trust edge data alone

  if (sessErr) {
    console.error('[mirror/graph] session fetch failed:', sessErr.message)
    return NextResponse.json({ error: 'Failed to fetch nodes' }, { status: 500 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodes: GraphNode[] = (sessionRows ?? []).map((s: any) => {
    const fullText = decrypt(s.decision_text) ?? ''
    return {
      id:               s.id as string,
      decision_snippet: fullText.length > 120 ? fullText.slice(0, 117) + '…' : fullText,
      created_at:       s.created_at as string,
      status:           s.status as string,
    }
  })

  // Drop edges whose sessions weren't returned (guards against cascaded deletes
  // that the graph_edges FK cascade should handle, but be defensive here)
  const validIds = new Set(nodes.map(n => n.id))
  const cleanEdges = responseEdges.filter(e => validIds.has(e.session_id_a) && validIds.has(e.session_id_b))

  console.log(
    `[mirror/graph] user=${userId} tier=${graphTier} nodes=${nodes.length} ` +
    `edges=${cleanEdges.length} locked_edges=${lockedEdgeCount} mirrorTier=${tier}`,
  )

  return NextResponse.json({
    nodes,
    edges: cleanEdges,
    tier: graphTier,
    corpus: { met: true, ...corpusBase },
  })
}
