// app/api/mirror/graph/route.ts
// ── Decision Graph Query API (Sprint G2) ─────────────────────────────────────
//
// GET /api/mirror/graph
//   ?types=structural_similarity,contradiction,shared_bias_trigger,...
//   (omit to get all edge types; dismissed edges excluded by default)
//   ?include_dismissed=true  (admin/debug only)
//
// Auth:    Bearer token → resolveUserId (same helper as all Mirror routes)
// Access:  getMirrorAccessState === 'unlocked' (Mirror ₹3,999/mo or Advisory)
// Corpus:  MIN_GRAPH_SESSIONS (default 20) AND MIN_GRAPH_EDGES (default 3)
//          Advisory bypasses both via ADVISORY_BYPASSES_THRESHOLDS.
//
// Response:
//   { nodes: GraphNode[], edges: GraphEdge[], corpus: CorpusStatus }
//
//   nodes — unique sessions referenced in returned edges, with 120-char
//     decision snippet (decrypted) and status. Nodes with no remaining
//     edges after filtering are excluded.
//
//   edges — decrypted GraphEdge[], sorted by strength DESC then computed_at
//     DESC. dimension_breakdown jsonb preserved as-is for Sprint G3 d3 tooltip.
//
//   corpus — always returned so the Sprint G3 UI can show a meaningful
//     gate message rather than an empty graph with no explanation.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }            from 'next/server'
import { createServiceClient }     from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { getMirrorAccessState, getMirrorTier } from '@/lib/mirror-access'
import { ADVISORY_BYPASSES_THRESHOLDS }        from '@/lib/mirror-tier-config'
import { decryptGraphEdge, type GraphEdge, type EdgeType } from '@/lib/graph-engine'
import { decrypt }                 from '@/lib/encryption'

const MIN_GRAPH_SESSIONS = Number(process.env.MIN_GRAPH_SESSIONS ?? 20)
const MIN_GRAPH_EDGES    = Number(process.env.MIN_GRAPH_EDGES    ?? 3)

const VALID_EDGE_TYPES: EdgeType[] = [
  'structural_similarity',
  'contradiction',
  'shared_bias_trigger',
  'shared_decision_type',
  'user_asserted',
]

export interface GraphNode {
  id:               string
  decision_snippet: string  // 120-char, decrypted
  created_at:       string
  status:           string
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

  // ── 2. Mirror access gate ─────────────────────────────────────────────────
  const [accessState, tier] = await Promise.all([
    getMirrorAccessState(userId, supabase),
    getMirrorTier(userId, supabase),
  ])
  if (accessState !== 'unlocked') {
    return NextResponse.json({ error: 'Mirror access required' }, { status: 403 })
  }

  // ── 3. Query params ───────────────────────────────────────────────────────
  const url = new URL(req.url)
  const typesParam = url.searchParams.get('types')
  const requestedTypes: EdgeType[] = typesParam
    ? typesParam.split(',').filter((t): t is EdgeType => VALID_EDGE_TYPES.includes(t as EdgeType))
    : VALID_EDGE_TYPES
  const includeDismissed = url.searchParams.get('include_dismissed') === 'true'

  // ── 4. Corpus gate ────────────────────────────────────────────────────────
  const isAdvisory = tier === 'advisory' && ADVISORY_BYPASSES_THRESHOLDS

  const [{ count: sessionCount }, { count: edgeCount }] = await Promise.all([
    supabase
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId),
    supabase
      .from('graph_edges')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('dismissed_at', null),
  ])

  const corpusMet = isAdvisory || (
    (sessionCount ?? 0) >= MIN_GRAPH_SESSIONS &&
    (edgeCount    ?? 0) >= MIN_GRAPH_EDGES
  )

  const corpus = {
    met:           corpusMet,
    session_count: sessionCount ?? 0,
    edge_count:    edgeCount    ?? 0,
    min_sessions:  isAdvisory ? 0 : MIN_GRAPH_SESSIONS,
    min_edges:     isAdvisory ? 0 : MIN_GRAPH_EDGES,
  }

  if (!corpusMet) {
    return NextResponse.json({ nodes: [], edges: [], corpus })
  }

  // ── 5. Fetch edges ────────────────────────────────────────────────────────
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
  const edges: GraphEdge[] = (rawEdges ?? []).map((r: any) => decryptGraphEdge(r))

  // ── 6. Collect unique session IDs from edges ──────────────────────────────
  const sessionIdSet = new Set<string>()
  for (const edge of edges) {
    sessionIdSet.add(edge.session_id_a)
    sessionIdSet.add(edge.session_id_b)
  }
  if (sessionIdSet.size === 0) {
    return NextResponse.json({ nodes: [], edges: [], corpus })
  }

  // ── 7. Fetch node data ────────────────────────────────────────────────────
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
  const cleanEdges = edges.filter(e => validIds.has(e.session_id_a) && validIds.has(e.session_id_b))

  console.log(`[mirror/graph] user=${userId} nodes=${nodes.length} edges=${cleanEdges.length} tier=${tier}`)
  return NextResponse.json({ nodes, edges: cleanEdges, corpus })
}
