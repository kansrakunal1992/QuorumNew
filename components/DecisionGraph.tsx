'use client'

// components/DecisionGraph.tsx
// ── Sprint G3: Decision Graph — d3-force interactive Mirror module ─────────────
//
// Fetches GET /api/mirror/graph, renders a force-directed graph of the user's
// decision corpus using d3-force (no npm package — uses the CDN build loaded
// via a dynamic script tag, same pattern as html2canvas usage elsewhere in
// the codebase; avoids adding d3 as a build dependency since this component
// is already client-only and d3 is only needed here).
//
// Node click → router.push('/record/[id]')
// Edge click (structural_similarity only) → opens dimension tooltip showing
//   top_matching_dims from dimension_breakdown jsonb
// user_asserted edges → visually distinct (dashed, muted gold) vs computed
//   edges (solid line, strength-weighted opacity). Documented in KDD (G3).
// Dismiss button on hover: PATCH /api/mirror/graph/edges/[id]/dismiss
// Add annotation CTA: opens an inline form → POST /api/mirror/graph/edges
//
// Corpus gate: API returns { corpus: { met: false } } → shows gate message
//   with session_count / min_sessions progress, identical copy pattern to
//   ContradictionDetector's milestone system.
//
import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { DIMENSION_LABELS } from '@/lib/session-labels'

// No d3 import at module scope — dynamically imported below to code-split it
// from the main Mirror bundle. d3 only loads when this component mounts.
// (The CDN script-tag approach was replaced after it was blocked by the
// app's CSP in production. Sprint G3 fix, June 2026.)

// ── d3 dynamic loader ─────────────────────────────────────────────────────────
let d3LoadPromise: Promise<unknown> | null = null
function loadD3(): Promise<unknown> {
  if (d3LoadPromise) return d3LoadPromise
  d3LoadPromise = import('d3').then(mod => mod)
  return d3LoadPromise
}

// ── Types (mirror lib/graph-engine.ts, no server import) ─────────────────────
type EdgeType =
  | 'structural_similarity'
  | 'contradiction'
  | 'shared_bias_trigger'
  | 'shared_decision_type'
  | 'user_asserted'

interface GraphNode {
  id:               string
  decision_snippet: string
  created_at:       string
  status:           string
}

interface GraphEdge {
  id:                  string
  session_id_a:        string
  session_id_b:        string
  edge_type:           EdgeType
  strength:            number | null
  dimension_breakdown: {
    top_matching_dims: string[]
    vector_similarity: number
    total:             number
    scoring_mode:      string
  } | null
  explanation_text:    string | null
  metadata:            Record<string, unknown> | null
  dismissed_at:        string | null
  // Sprint QW-2: true when the "why" (dimension_breakdown/explanation_text/
  // metadata) was stripped server-side because the viewer is on the preview
  // tier — the connection is real, the interpretation is paid. Never inferred
  // client-side from null fields; the API sets this explicitly.
  redacted:            boolean
}

type GraphTier = 'locked' | 'preview' | 'full'

interface GraphData {
  nodes:  GraphNode[]
  edges:  GraphEdge[]
  tier:   GraphTier
  corpus: {
    met:                boolean
    tier:               GraphTier
    session_count:      number
    min_sessions:       number
    min_edges:          number
    locked_edge_count:  number
  }
}

// ── Edge style config ─────────────────────────────────────────────────────────
// Computed vs user_asserted are visually distinct — never implying the system
// found a structural match it didn't find. (KDD G3)
//
// Bug fix (GRAPH-5): these were hardcoded rgba() values tuned only for the
// dark theme's background — never adapted to light theme, where the same
// low-alpha colors composite against near-white and lose almost all visible
// contrast (measured as low as ~2:1 for some edge types even in dark theme,
// let alone light). Now reference CSS custom properties defined per-theme in
// globals.css (contrast-checked ~3:1+ for every computed edge type in both
// themes), so edges recolor live on theme toggle without needing the D3
// simulation to rebuild — var() is a valid SVG stroke value.
const EDGE_COLOR: Record<EdgeType, string> = {
  structural_similarity: 'var(--graph-edge-structural)',    // gold — primary computed edge
  contradiction:         'var(--graph-edge-contradiction)', // red — tension signal
  shared_bias_trigger:   'var(--graph-edge-bias)',          // purple — behavioral link
  shared_decision_type:  'var(--graph-edge-type)',          // blue — categorical link
  user_asserted:         'var(--graph-edge-annotation)',    // dim gold, dashed — user-authored (deliberately subordinate, see KDD G3)
}
const EDGE_LABEL: Record<EdgeType, string> = {
  structural_similarity: 'Structural similarity',
  contradiction:         'Contradiction',
  shared_bias_trigger:   'Shared bias trigger',
  shared_decision_type:  'Same decision type',
  user_asserted:         'Your annotation',
}

// ── Insights strip (Sprint G4 / issue #5) ─────────────────────────────────────
// Turns the edge data already loaded for the graph into plain-English, ranked
// observations — no new AI calls, no new endpoint. The graph stays exactly as
// it renders today (kept deliberately unchanged visually); this is a companion
// panel that does the "so what" interpretation the graph itself was never
// built to do. Deliberately in the user's own words, not the app's internal
// vocabulary — e.g. lib/bias-scorer.ts's own BIAS_PARAMETERS labels ("Exit
// Optionality Mispricing", "Network Circularity") are already used elsewhere
// in the app (Council, Mirror) and are fine there, but fail a "layman/easy to
// understand" bar on their own — so this map is a plainer one-line gloss for
// each, specific to this panel, not a replacement for those existing labels.
// Not imported from lib/bias-scorer.ts itself — that file pulls in
// createServiceClient/createCompletion at module scope (server-only secrets),
// unsafe to bundle into this 'use client' component.
const BIAS_PLAIN_LANGUAGE: Record<string, string> = {
  fomo_urgency:                      'feeling like you had to act fast',
  overconfidence:                    'being more certain than the evidence supported',
  attribution_asymmetry:             'crediting yourself for wins but blaming circumstances for losses',
  social_proof:                      'going along with what others were doing',
  control_illusion:                  'feeling more in control of the outcome than you actually were',
  speed_bias:                        'valuing a quick decision over a careful one',
  exit_optionality_mispricing:       'underestimating how hard it would be to back out later',
  recency_bias:                      'weighing a recent event more than it deserved',
  uniqueness_fallacy:                'believing your situation was too unique for past lessons to apply',
  deference_distortion:              "deferring to someone else's judgment over your own read",
  relationship_alignment_assumption: 'assuming a relationship would stay aligned without checking',
  success_compression:               'assuming a past win would repeat the same way',
  loss_aversion_reversal:            "taking on more risk to avoid feeling like you'd already lost",
  network_circularity:               'hearing the same opinion echoed back by people who talk to each other',
  complexity_opacity:                "moving ahead despite not fully understanding how it worked",
}

interface GraphInsight {
  id:      string
  kind:    'contradiction' | 'bias' | 'connected' | 'structural' | 'annotation'
  label:   string       // small kicker, e.g. "Contradiction"
  body:    string       // the plain-English sentence
  nodeIds: string[]     // for hover/click sync with the graph above
}

const truncate = (s: string | null | undefined, n: number) =>
  !s ? '' : (s.length > n ? s.slice(0, n).trimEnd() + '…' : s)

// Builds up to 4 ranked insights, most-actionable first. Respects `redacted`
// per edge (preview-tier users get a generic teaser line pointing at Mirror,
// same paywall pattern as the tooltip above — never leaking the underlying
// reason a redacted edge fired, consistent with KDD G3).
function buildInsights(nodes: GraphNode[], edges: GraphEdge[]): GraphInsight[] {
  const live = edges.filter(e => !e.dismissed_at)
  const byId = new Map(nodes.map(n => [n.id, n]))
  const insights: GraphInsight[] = []

  // 1. Contradiction — most urgent, surface first.
  const allContradictions = live.filter(e => e.edge_type === 'contradiction')
  const contradiction = allContradictions[0]
  if (contradiction) {
    if (contradiction.redacted) {
      // Bug fix (GRAPH-6): was a hardcoded "Two of your decisions..." even
      // when the real count was 1, 3, or more — a generic placeholder word
      // where a real number belongs. The count itself isn't the paid part
      // (Bias Fingerprint/Patterns/Contradiction Detector teasers all show
      // real counts for locked content elsewhere in the app); only which
      // specific decisions and why stays locked.
      insights.push({
        id: 'contradiction', kind: 'contradiction', label: 'Contradiction',
        body:    `${allContradictions.length} of your decisions seem to pull in different directions. Unlocking Mirror shows exactly which ones and why.`,
        nodeIds: [contradiction.session_id_a, contradiction.session_id_b],
      })
    } else {
      const a = byId.get(contradiction.session_id_a)
      const b = byId.get(contradiction.session_id_b)
      insights.push({
        id: 'contradiction', kind: 'contradiction', label: 'Contradiction',
        body:    `"${truncate(a?.decision_snippet, 42)}" and "${truncate(b?.decision_snippet, 42)}" seem to pull in different directions — worth checking if something changed.`,
        nodeIds: [contradiction.session_id_a, contradiction.session_id_b],
      })
    }
  }

  // 2. Shared bias cluster — the most-repeated bias trigger across 2+ decisions.
  const biasEdges = live.filter(e => e.edge_type === 'shared_bias_trigger')
  const openBiasEdges = biasEdges.filter(e => !e.redacted)
  const biasNodeSets = new Map<string, Set<string>>()
  openBiasEdges.forEach(e => {
    const params = (e.metadata?.bias_parameters as string[] | undefined) ?? []
    params.forEach(p => {
      if (!biasNodeSets.has(p)) biasNodeSets.set(p, new Set())
      biasNodeSets.get(p)!.add(e.session_id_a)
      biasNodeSets.get(p)!.add(e.session_id_b)
    })
  })
  const topBias = [...biasNodeSets.entries()].sort((a, b) => b[1].size - a[1].size)[0]
  if (topBias && topBias[1].size >= 2) {
    const [biasKey, nodeSet] = topBias
    const plain = BIAS_PLAIN_LANGUAGE[biasKey] ?? biasKey.replace(/_/g, ' ')
    insights.push({
      id: 'bias-cluster', kind: 'bias', label: 'Recurring pattern',
      body:    `${nodeSet.size} of your decisions show signs of ${plain}.`,
      nodeIds: [...nodeSet],
    })
  } else {
    // GRAPH-6: which specific bias (bias_parameters) is the locked part —
    // but which/how many *decisions* are touched by a shared-bias edge is
    // not, same real-count-not-placeholder fix as the contradiction branch.
    const redactedBiasNodes = new Set<string>()
    biasEdges.filter(e => e.redacted).forEach(e => {
      redactedBiasNodes.add(e.session_id_a); redactedBiasNodes.add(e.session_id_b)
    })
    if (redactedBiasNodes.size >= 2) {
      insights.push({
        id: 'bias-cluster-locked', kind: 'bias', label: 'Recurring pattern',
        body:    `${redactedBiasNodes.size} of your decisions share a recurring bias pattern. Unlocking Mirror names it.`,
        nodeIds: [...redactedBiasNodes],
      })
    }
  }

  // 3. Most connected node — exploratory, not urgent, but a natural "start here".
  const countByNode = new Map<string, number>()
  live.forEach(e => {
    countByNode.set(e.session_id_a, (countByNode.get(e.session_id_a) ?? 0) + 1)
    countByNode.set(e.session_id_b, (countByNode.get(e.session_id_b) ?? 0) + 1)
  })
  const topNode = [...countByNode.entries()].sort((a, b) => b[1] - a[1])[0]
  if (topNode && topNode[1] >= 2) {
    const node = byId.get(topNode[0])
    if (node) {
      insights.push({
        id: 'most-connected', kind: 'connected', label: 'Most connected',
        body:    `"${truncate(node.decision_snippet, 60)}" links to ${topNode[1]} other decision${topNode[1] === 1 ? '' : 's'} — often a sign it's still unresolved.`,
        nodeIds: [node.id],
      })
    }
  }

  // 4. Structural similarity detail — what specifically two decisions had in
  // common, in plain English via DIMENSION_LABELS (shared with Mirror/Council
  // elsewhere in the app, so the vocabulary stays consistent).
  const structural = live.find(e =>
    e.edge_type === 'structural_similarity' && !e.redacted &&
    (e.dimension_breakdown?.top_matching_dims?.length ?? 0) > 0,
  )
  if (structural && insights.length < 4) {
    const dims = structural.dimension_breakdown!.top_matching_dims
      .map(d => DIMENSION_LABELS[d])
      .filter(Boolean)
      .slice(0, 2)
    if (dims.length > 0) {
      insights.push({
        id: 'structural', kind: 'structural', label: 'Similar situations',
        body:    `You approached two decisions the same way: both were ${dims.map(d => d.toLowerCase()).join(' and ')}.`,
        nodeIds: [structural.session_id_a, structural.session_id_b],
      })
    }
  }

  // 5. User's own annotation — least novel (they already know this), lowest priority filler.
  const annotation = live.find(e => e.edge_type === 'user_asserted' && e.explanation_text)
  if (annotation && insights.length < 4) {
    insights.push({
      id: 'annotation', kind: 'annotation', label: 'Your own note',
      body:    `You connected two decisions yourself: "${truncate(annotation.explanation_text, 80)}"`,
      nodeIds: [annotation.session_id_a, annotation.session_id_b],
    })
  }

  return insights.slice(0, 4)
}

// ── d3 dynamic loader ─────────────────────────────────────────────────────────

// ── Tooltip state ─────────────────────────────────────────────────────────────
interface TooltipState {
  x:       number
  y:       number
  content: React.ReactNode
}

// ── Annotation form state ─────────────────────────────────────────────────────
interface AnnotationForm {
  session_id_a: string
  session_id_b: string
  text:         string
  submitting:   boolean
  error:        string | null
}

interface DecisionGraphProps {
  authToken: string
  fallbackSessionCount?: number
  fallbackCurrentNode?: GraphNode
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DecisionGraph({
  authToken,
  fallbackSessionCount,
  fallbackCurrentNode,
}: DecisionGraphProps) {
  const router                              = useRouter()
  const svgRef                              = useRef<SVGSVGElement>(null)
  const containerRef                        = useRef<HTMLDivElement>(null)

  const [data,        setData]        = useState<GraphData | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(false)
  const [tooltip,     setTooltip]     = useState<TooltipState | null>(null)
  const [dismissed,   setDismissed]   = useState<Set<string>>(new Set())
  const [annotation,  setAnnotation]  = useState<AnnotationForm | null>(null)
  const [d3Ready,     setD3Ready]     = useState(false)
  // Insights strip: which node ids to glow, driven by hovering an insight card
  // below the graph. Applied via a lightweight separate effect (below) that
  // just toggles a filter on existing DOM nodes — never rebuilds the D3
  // simulation, so hovering a card can't restart/reheat the physics.
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<string[]>([])

  // ── 1. Load d3 ─────────────────────────────────────────────────────────────
  useEffect(() => {
    loadD3().then(() => setD3Ready(true)).catch(() => setError(true))
  }, [])

  const buildAuthlessLockedData = useCallback((): GraphData => {
    const sessionCount = Math.max(
      fallbackSessionCount ?? 0,
      fallbackCurrentNode ? 1 : 0
    )

    return {
      nodes: fallbackCurrentNode ? [fallbackCurrentNode] : [],
      edges: [],
      tier: 'locked',
      corpus: {
        met: false,
        tier: 'locked',
        session_count: sessionCount,
        min_sessions: 2,
        min_edges: 1,
        locked_edge_count: 0,
      },
    }
  }, [fallbackSessionCount, fallbackCurrentNode])

  // ── 2. Fetch graph data ─────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true)        
    setError(false)
    
        if (!authToken) {
          setData(buildAuthlessLockedData())
          setLoading(false)
          return
        }

    fetch('/api/mirror/graph', {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: GraphData) => { setData(d); setLoading(false) })
      .catch(() => { setError(true); setLoading(false) })
  }, [authToken, buildAuthlessLockedData])

  // ── 3. Dismiss edge ─────────────────────────────────────────────────────────
  const dismissEdge = useCallback(async (edgeId: string) => {
    setDismissed(prev => new Set(prev).add(edgeId))
    setTooltip(null)
    try {
      await fetch(`/api/mirror/graph/edges/${edgeId}/dismiss`, {
        method:  'PATCH',
        headers: { Authorization: `Bearer ${authToken}` },
      })
    } catch {
      // Optimistic dismiss — don't undo on error, just log
      console.warn('[DecisionGraph] dismiss failed for', edgeId)
    }
  }, [authToken])

  // ── 4. Submit annotation ────────────────────────────────────────────────────
  const submitAnnotation = useCallback(async () => {
    if (!annotation || !annotation.text.trim()) return
    setAnnotation(a => a ? { ...a, submitting: true, error: null } : null)
    try {
      const r = await fetch('/api/mirror/graph/edges', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          Authorization:   `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          session_id_a:     annotation.session_id_a,
          session_id_b:     annotation.session_id_b,
          explanation_text: annotation.text.trim(),
        }),
      })
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        setAnnotation(a => a ? { ...a, submitting: false, error: body.error ?? 'Failed to save' } : null)
        return
      }
      // Refresh graph data to show new edge
      const fresh = await fetch('/api/mirror/graph', {
        headers: { Authorization: `Bearer ${authToken}` },
      }).then(res => res.json()).catch(() => null)
      if (fresh) setData(fresh)
      setAnnotation(null)
    } catch {
      setAnnotation(a => a ? { ...a, submitting: false, error: 'Network error' } : null)
    }
  }, [annotation, authToken])

  // ── 5. Render d3 graph ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function render() {
      if (!d3Ready || !data || data.nodes.length === 0 || !svgRef.current || !containerRef.current) return
      if (data.nodes.length === 0) return

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d3 = await loadD3() as any
      if (cancelled) return
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()  // clear on re-render

    const W = containerRef.current.clientWidth || 640
    // Bug fix (GRAPH-4): "atom oscillation" for users with a lot of decisions.
    // H was a flat 420px regardless of node count, and charge/collision
    // strength were likewise fixed — so as node count grows, the available
    // area per node shrinks while the forces trying to keep them apart don't
    // relax at all. That's an increasingly overcrowded, overconstrained
    // system: forceLink keeps pulling connected nodes to 120px apart while
    // forceManyBody repels everything and forceCollide refuses overlap
    // within 36px, all inside the same fixed box — for a dense graph there
    // may be no stable arrangement that satisfies all three at once, so
    // nodes never settle and keep visibly jostling for room. Scaling H with
    // node count gives the layout room to actually resolve, and the added
    // velocityDecay/alphaDecay tuning damps out residual jitter faster so
    // even a still-imperfect layout stops visibly moving in a bounded time
    // instead of continuing to buzz indefinitely.
    const H = Math.max(420, Math.min(900, 140 + data.nodes.length * 16))

    svgRef.current.setAttribute('width',  String(W))
    svgRef.current.setAttribute('height', String(H))

    // Filter dismissed edges
    const visibleEdges = data.edges.filter(e => !dismissed.has(e.id))

    // "Most significant node" glow (companion to the Insights strip below —
    // same ranking as its 'most-connected' insight). Static per render, not
    // tied to hover state, so it's always visible as an entry point into a
    // dense graph — gives the eye somewhere to land first.
    const connectionCounts = new Map<string, number>()
    visibleEdges.forEach(e => {
      connectionCounts.set(e.session_id_a, (connectionCounts.get(e.session_id_a) ?? 0) + 1)
      connectionCounts.set(e.session_id_b, (connectionCounts.get(e.session_id_b) ?? 0) + 1)
    })
    const topEntry = [...connectionCounts.entries()].sort((a, b) => b[1] - a[1])[0]
    const mostConnectedId = topEntry && topEntry[1] >= 2 ? topEntry[0] : null

    // d3-force simulation nodes/links (clones to avoid d3 mutating original)
    const nodes = data.nodes.map(n => ({ ...n }))
    const nodeById = new Map(nodes.map(n => [n.id, n]))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const links = visibleEdges.map((e: GraphEdge) => ({
      ...e,
      source: nodeById.get(e.session_id_a),
      target: nodeById.get(e.session_id_b),
    })).filter((l: { source: unknown; target: unknown }) => l.source && l.target)

    // Zoom container
    const g = svg.append('g')
    svg.call(
      d3.zoom()
        .scaleExtent([0.3, 3])
        .on('zoom', (event: { transform: unknown }) => g.attr('transform', event.transform))
    )

    // Force simulation
    const sim = d3.forceSimulation(nodes)
      .force('link',   d3.forceLink(links).id((d: { id: string }) => d.id).distance(120).strength(0.6))
      .force('charge', d3.forceManyBody().strength(-280))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collide', d3.forceCollide(36))
      .velocityDecay(0.55)   // more damping (default 0.4) — settles instead of buzzing
      .alphaDecay(0.04)      // cools down faster (default ~0.0228) — bounds how long jitter is visible

    // ── Edges ─────────────────────────────────────────────────────────────────
    const link = g.append('g').selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke',           (d: { edge_type: EdgeType }) => EDGE_COLOR[d.edge_type])
      .attr('stroke-width',     (d: { strength: number | null; edge_type: EdgeType }) =>
        d.edge_type === 'structural_similarity' ? 1 + (d.strength ?? 0.5) * 2 : 1.5
      )
      .attr('stroke-dasharray', (d: { edge_type: EdgeType }) =>
        d.edge_type === 'user_asserted' ? '5,4' : 'none'
      )
      .style('cursor', 'pointer')
      .on('click', (event: MouseEvent, d: GraphEdge & { source: { x: number; y: number }; target: { x: number; y: number } }) => {
        event.stopPropagation()
        const rect = svgRef.current!.getBoundingClientRect()
        const mx = event.clientX - rect.left
        const my = event.clientY - rect.top

        const dims = d.dimension_breakdown?.top_matching_dims ?? []
        setTooltip({
          x: mx, y: my,
          content: (
            <div style={{ minWidth: 220 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: 6 }}>
                {EDGE_LABEL[d.edge_type]}
              </div>
              {d.redacted ? (
                <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 4 }}>
                  {d.edge_type === 'contradiction'
                    ? 'A possible contradiction was detected between these two decisions.'
                    : 'These two decisions are connected.'}{' '}
                  <span style={{ color: 'var(--text-4)' }}>The specific reason is part of Mirror.</span>
                </div>
              ) : (
                <>
                  {d.edge_type === 'structural_similarity' && dims.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-4)', marginBottom: 4 }}>Connected by</div>
                      {dims.map((dim: string) => (
                        <div key={dim} style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 2 }}>
                          · {dim.replace(/_/g, ' ')}
                        </div>
                      ))}
                    </div>
                  )}
                  {d.edge_type === 'user_asserted' && d.explanation_text && (
                    <div style={{ fontSize: 11, color: 'var(--text-2)', fontStyle: 'italic', marginBottom: 8, lineHeight: 1.5 }}>
                      "{d.explanation_text}"
                    </div>
                  )}
                  {d.edge_type === 'contradiction' && (
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>
                      A contradiction was detected between these decisions.
                    </div>
                  )}
                  {d.edge_type === 'shared_bias_trigger' && Array.isArray(d.metadata?.bias_parameters) && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-4)', marginBottom: 4 }}>Shared trigger</div>
                      {(d.metadata.bias_parameters as string[]).map((b: string) => (
                        <div key={b} style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 2 }}>
                          · {b.replace(/_/g, ' ')}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              {!d.redacted && (
                <button
                  onClick={(e) => { e.stopPropagation(); dismissEdge(d.id) }}
                  style={{ fontSize: 10, color: 'var(--text-4)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: 2 }}
                >
                  Dismiss this connection
                </button>
              )}
            </div>
          ),
        })
      })

    // ── Nodes ─────────────────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const node = g.append('g').selectAll('g').data(nodes).join('g')
      .attr('class', 'dg-node')
      .attr('data-node-id', (d: GraphNode) => d.id)
      .style('cursor', 'pointer')

    node.append('circle')
      .attr('class', 'dg-node-circle')
      .attr('r', (d: GraphNode) => d.id === mostConnectedId ? 22 : 18)
      .attr('fill',   'var(--bg-card)')
      .attr('stroke', (d: GraphNode) => d.status === 'active' ? 'var(--graph-node-stroke-active)' : 'var(--graph-node-stroke-inactive)')
      .attr('stroke-width', (d: GraphNode) => d.status === 'active' ? 2 : 1.2)
      .style('filter', (d: GraphNode) => d.id === mostConnectedId ? 'drop-shadow(0 0 5px var(--gold-bright))' : 'none')

    // Date label inside node
    node.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('font-size', 8)
      .attr('fill', 'var(--text-4)')
      .attr('font-family', 'var(--font-mono, monospace)')
      .text((d: GraphNode) => {
        const dt = new Date(d.created_at)
        return `${dt.getDate()}/${dt.getMonth() + 1}`
      })

    // Drag behaviour
    // Bug fix (GRAPH-2): click-to-open-record was silently broken. The old
    // code set dragMoved=true on ANY 'mousemove' event fired on the node —
    // but mousemove fires on ordinary hover motion too, not just an actual
    // held-button drag. It is essentially impossible for a human to click
    // with literally zero cursor movement between mousedown and mouseup, so
    // dragMoved was ending up true on nearly every real click, silently
    // suppressing the router.push below almost every time. Now tracks actual
    // cumulative displacement from d3.drag()'s own start/drag/end stream,
    // which only fires during a genuine held-button drag — a real click (no
    // button-held movement) now correctly measures ~0 distance.
    let dragDistance = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    node.call(d3.drag()
      .on('start', (event: { active: boolean }, d: { fx: number | null; fy: number | null; x: number; y: number }) => {
        dragDistance = 0
        if (!event.active) sim.alphaTarget(0.3).restart()
        d.fx = d.x; d.fy = d.y
      })
      .on('drag', (event: { dx: number; dy: number; x: number; y: number }, d: { fx: number; fy: number }) => {
        dragDistance += Math.abs(event.dx) + Math.abs(event.dy)
        d.fx = event.x; d.fy = event.y
      })
      .on('end', (event: { active: boolean }, d: { fx: number | null; fy: number | null }) => {
        if (!event.active) sim.alphaTarget(0)
        d.fx = null; d.fy = null
      })
    )

    // Node click → record page; only suppressed for genuine drags (>5px of
    // real held-button movement), not ordinary hover jitter.
    node.on('click', (_event: MouseEvent, d: GraphNode) => {
        if (dragDistance < 5) router.push(`/record/${d.id}`)
      })
      .on('mouseenter', (event: MouseEvent, d: GraphNode) => {
        const rect = svgRef.current!.getBoundingClientRect()
        setTooltip({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top - 10,
          content: (
            <div style={{ maxWidth: 240 }}>
              <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5, marginBottom: 4 }}>
                {d.decision_snippet}
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-4)', letterSpacing: '0.06em' }}>
                Click to open record
              </div>
            </div>
          ),
        })
      })
      .on('mouseleave', () => setTooltip(null))

    // Dismiss SVG click → close tooltip
    svg.on('click', () => setTooltip(null))

    // Tick
    sim.on('tick', () => {
      link
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .attr('x1', (d: any) => d.source.x)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .attr('y1', (d: any) => d.source.y)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .attr('x2', (d: any) => d.target.x)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .attr('y2', (d: any) => d.target.y)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      node.attr('transform', (d: any) => `translate(${d.x},${d.y})`)
    })

    return () => { sim.stop() }
    }
    render()
    return () => { cancelled = true }
  }, [d3Ready, data, dismissed, dismissEdge, router])

  // ── Insights ↔ graph hover-sync ────────────────────────────────────────────
  // Deliberately a separate effect from the D3 render above: only toggles a
  // CSS filter/opacity on already-rendered DOM nodes via plain querySelector,
  // never touches the simulation or re-runs render() — hovering an insight
  // card must not restart/reheat the physics (would look identical to the
  // GRAPH-4 "atom oscillation" bug from the user's perspective if it did).
  useEffect(() => {
    if (!svgRef.current) return
    const circles = svgRef.current.querySelectorAll<SVGCircleElement>('.dg-node-circle')
    const groups  = svgRef.current.querySelectorAll<SVGGElement>('.dg-node')
    if (highlightedNodeIds.length === 0) {
      circles.forEach(c => { c.style.filter = ''; })
      groups.forEach(gEl => { gEl.style.opacity = '' })
      return
    }
    const idSet = new Set(highlightedNodeIds)
    groups.forEach(gEl => {
      const id = gEl.getAttribute('data-node-id')
      const isMatch = !!id && idSet.has(id)
      gEl.style.opacity = isMatch ? '1' : '0.3'
    })
    circles.forEach(c => {
      const id = c.closest('.dg-node')?.getAttribute('data-node-id')
      c.style.filter = (id && idSet.has(id)) ? 'drop-shadow(0 0 7px var(--gold-bright))' : 'none'
    })
  }, [highlightedNodeIds])

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '32px 0', color: 'var(--text-4)', fontSize: 13 }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)', animation: 'blink 1.5s ease-in-out infinite' }} />
      Building your decision graph…
    </div>
  )

  if (error) return (
    <div style={{ padding: '24px 0', color: 'var(--text-4)', fontSize: 13 }}>
      Unable to load graph. Try refreshing.
    </div>
  )

  if (!data) return null

  // ── Locked tier — sessionCount < MIN_PREVIEW_SESSIONS, no edges possible ────
  if (data.tier === 'locked') {
    const hasFirstNode  = data.nodes.length > 0
    const sessionsNeeded = Math.max(0, data.corpus.min_sessions - data.corpus.session_count)
    return (
      <div style={{ padding: '24px 0' }}>
        <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.7, margin: '0 0 20px' }}>
          Your Decision Graph connects decisions by structural similarity, shared bias triggers,
          contradictions, and decision type — patterns that only become visible with enough history.
        </p>
        <div style={{
          background:    'var(--bg-inset)',
          border:        '1px solid var(--border-dim)',
          borderRadius:  8,
          padding:       '24px 20px',
          display:       'flex',
          flexDirection: 'column',
          alignItems:    'center',
          gap:           14,
        }}>
          <svg width="180" height="70" viewBox="0 0 180 70">
            {hasFirstNode ? (
              <>
                <circle cx="36" cy="35" r="16" fill="var(--bg-card)" stroke="var(--graph-node-stroke-active)" strokeWidth="2" />
                <text x="36" y="39" textAnchor="middle" fontSize="8" fill="var(--text-4)" fontFamily="var(--font-mono, monospace)">
                  {(() => { const d = new Date(data.nodes[0].created_at); return `${d.getDate()}/${d.getMonth() + 1}` })()}
                </text>
              </>
            ) : (
              <circle cx="36" cy="35" r="16" fill="none" stroke="var(--border-mid)" strokeWidth="1.5" strokeDasharray="3,3" />
            )}
            <line x1="52" y1="35" x2="124" y2="35" stroke="var(--border-dim)" strokeWidth="1.5" strokeDasharray="4,4" />
            <circle cx="140" cy="35" r="16" fill="none" stroke="var(--border-mid)" strokeWidth="1.5" strokeDasharray="3,3">
              <animate attributeName="opacity" values="0.3;0.8;0.3" dur="2s" repeatCount="indefinite" />
            </circle>
          </svg>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 4px', fontWeight: 600 }}>
              {hasFirstNode ? 'Your first decision is mapped.' : 'Your Decision Graph starts here.'}
            </p>
            {sessionsNeeded > 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-4)', margin: 0, lineHeight: 1.6 }}>
                {sessionsNeeded} more decision{sessionsNeeded !== 1 ? 's' : ''} and your first connection appears.
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Preview tier, no visible connections yet ──────────────────────────────
  // (Enough sessions to be past 'locked', but no structural/bias/contradiction
  // edge has cleared the match threshold yet — different message from
  // 'locked' since there's no countdown here, it's data-dependent.)
  if (data.tier === 'preview' && data.nodes.length === 0) {
    return (
      <div style={{ padding: '24px 0' }}>
        <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.7, margin: 0 }}>
          No structural connections yet across your {data.corpus.session_count} decisions. As you log
          more, the graph will surface shared patterns, contradictions, and structural echoes here.
        </p>
      </div>
    )
  }

  // ── 'full' tier, or 'preview' tier with real (redacted) edges to show ─────
  // falls through to the normal force-graph render below.

  // Insights + small live counts next to the legend — both derived from the
  // same already-loaded edge data, computed once per render (cheap: at most
  // a few dozen edges for any real user).
  const liveEdges = data.edges.filter(e => !dismissed.has(e.id))
  const insights = buildInsights(data.nodes, liveEdges)
  const contradictionCount = liveEdges.filter(e => e.edge_type === 'contradiction').length
  // Bug fix (GRAPH-8, issue #6 dipstick): this previously only counted
  // distinct clusters from non-redacted edges, so it silently showed 0 for
  // preview-tier users even when a shared bias pattern genuinely existed —
  // inconsistent with contradictionCount above, which counts real numbers
  // regardless of redaction (matches the house "counts are free, specifics
  // are paid" standard used throughout Mirror). True per-parameter grouping
  // needs metadata.bias_parameters, which is (correctly) stripped for
  // redacted edges — so when that grouping isn't possible, fall back to the
  // number of distinct decisions touched by any shared-bias edge instead of
  // reporting zero. Same fallback buildInsights' bias-cluster-locked branch
  // already uses, kept consistent here.
  const biasCluster = (() => {
    const biasEdges = liveEdges.filter(e => e.edge_type === 'shared_bias_trigger')
    const sets = new Map<string, Set<string>>()
    biasEdges.filter(e => !e.redacted).forEach(e => {
      const params = (e.metadata?.bias_parameters as string[] | undefined) ?? []
      params.forEach(p => {
        if (!sets.has(p)) sets.set(p, new Set())
        sets.get(p)!.add(e.session_id_a); sets.get(p)!.add(e.session_id_b)
      })
    })
    const trueClusters = [...sets.values()].filter(s => s.size >= 2).length
    if (trueClusters > 0) return { count: trueClusters, unit: 'shared bias cluster' }

    const nodeCount = new Set(biasEdges.flatMap(e => [e.session_id_a, e.session_id_b])).size
    return nodeCount >= 2 ? { count: nodeCount, unit: 'decision shares a bias pattern' } : { count: 0, unit: '' }
  })()

  // ── Legend ──────────────────────────────────────────────────────────────────
  const LEGEND: { type: EdgeType; dashed?: boolean }[] = [
    { type: 'structural_similarity' },
    { type: 'contradiction' },
    { type: 'shared_bias_trigger' },
    { type: 'shared_decision_type' },
    { type: 'user_asserted', dashed: true },
  ]

  return (
    <div style={{ position: 'relative' }}>
      <style>{`
        @keyframes blink { 0%,100%{opacity:.3} 50%{opacity:1} }
        .dg-annotation-btn {
          font-size: 11px; color: var(--text-4); background: none;
          border: 1px solid var(--border-dim); border-radius: 4px;
          padding: 4px 10px; cursor: pointer; transition: all 0.15s;
          font-family: inherit;
        }
        .dg-annotation-btn:hover { color: var(--gold); border-color: var(--gold-dim); }
        .dg-insight-card:hover { border-color: var(--gold-dim); }
      `}</style>

      {/* Preview-tier banner — real graph shown above, deeper detail is paid */}
      {data.tier === 'preview' && (
        <div style={{
          marginBottom: 14,
          padding:      '10px 14px',
          background:   'rgba(201,168,76,0.06)',
          border:       '1px solid var(--gold-dim)',
          borderRadius: 8,
          display:      'flex',
          alignItems:   'center',
          justifyContent: 'space-between',
          gap:          10,
          flexWrap:     'wrap',
        }}>
          <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>
            Click a connection to see what type it is. Why two decisions connect — the shared
            dimensions, the exact contradiction, the shared bias — is part of Mirror.
          </span>
          {data.corpus.locked_edge_count > 0 && (
            <span style={{ fontSize: 11, color: 'var(--gold)', fontWeight: 600, whiteSpace: 'nowrap' }}>
              +{data.corpus.locked_edge_count} more connection{data.corpus.locked_edge_count !== 1 ? 's' : ''} with Mirror
            </span>
          )}
        </div>
      )}

      {/* Graph SVG */}
      <div
        ref={containerRef}
        style={{
          width:        '100%',
          borderRadius: 8,
          background:   'var(--bg-inset)',
          border:       '1px solid var(--border-dim)',
          overflow:     'hidden',
          position:     'relative',
        }}
        onClick={() => setTooltip(null)}
      >
        <svg ref={svgRef} style={{ display: 'block', width: '100%' }} />

        {/* Tooltip */}
        {tooltip && (() => {
          // Bug fix (GRAPH-3): nodes on the right side of the graph blinked
          // rapidly on hover and couldn't be clicked. The old clamp —
          // `Math.min(tooltip.x + 12, containerWidth - 260)` — only kept the
          // tooltip inside the container's right edge; it never checked
          // whether the clamped position ends up *underneath the cursor*.
          // For a right-side node, tooltip.x + 12 already overflows, so the
          // clamp pulls the tooltip's whole box leftward — often far enough
          // left that it now sits directly on top of the cursor (and the
          // node under it). Since this div has pointerEvents:'auto' and
          // renders above the SVG, the browser then considers the tooltip —
          // not the node — to be under the cursor, which fires the node's
          // mouseleave (hiding the tooltip), which puts the cursor back over
          // the node (firing mouseenter again) — an infinite rapid loop, and
          // a moving target that also made clicking unreliable. Fix: flip
          // the tooltip to the LEFT of the cursor when there's no room on
          // the right, instead of clamping into an overlapping position —
          // this always keeps a 12px gap from the cursor either way.
          const TOOLTIP_W = 260
          const containerWidth = containerRef.current?.clientWidth ?? 640
          const overflowsRight = tooltip.x + 12 + TOOLTIP_W > containerWidth
          const left = overflowsRight
            ? Math.max(tooltip.x - TOOLTIP_W - 12, 8)   // flip to the left of the cursor
            : tooltip.x + 12                             // default: right of the cursor
          return (
            <div
              style={{
                position:     'absolute',
                left,
                top:          Math.max(tooltip.y - 10, 8),
                background:   'var(--bg-card)',
                border:       '1px solid var(--border-mid)',
                borderRadius: 6,
                padding:      '10px 12px',
                pointerEvents:'auto',
                zIndex:       10,
                boxShadow:    '0 4px 16px rgba(0,0,0,0.4)',
              }}
              onClick={e => e.stopPropagation()}
            >
              {tooltip.content}
            </div>
          )
        })()}
      </div>

      {/* Live counts — glance-level summary before reading the insight cards below */}
      {(contradictionCount > 0 || biasCluster.count > 0) && (
        <div style={{ marginTop: 16, fontSize: 11, color: 'var(--gold)', fontWeight: 600 }}>
          {[
            contradictionCount > 0 ? `${contradictionCount} contradiction${contradictionCount === 1 ? '' : 's'}` : null,
            biasCluster.count > 0
              ? biasCluster.unit === 'shared bias cluster'
                ? `${biasCluster.count} shared bias cluster${biasCluster.count === 1 ? '' : 's'}`
                : `${biasCluster.count} decision${biasCluster.count === 1 ? '' : 's'} share${biasCluster.count === 1 ? 's' : ''} a bias pattern`
              : null,
          ].filter(Boolean).join(' · ')}
        </div>
      )}

      {/* Legend + annotation CTA */}
      <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: '6px 16px', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
          {LEGEND.map(({ type, dashed }) => (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <svg width={22} height={8}>
                <line
                  x1={0} y1={4} x2={22} y2={4}
                  stroke={EDGE_COLOR[type]}
                  strokeWidth={dashed ? 1.5 : 2}
                  strokeDasharray={dashed ? '4,3' : 'none'}
                />
              </svg>
              <span style={{ fontSize: 10, color: 'var(--text-4)' }}>{EDGE_LABEL[type]}</span>
            </div>
          ))}
        </div>

        <button
          className="dg-annotation-btn"
          onClick={() => {
            const nodeIds = data.nodes.map(n => n.id)
            if (nodeIds.length >= 2) {
              setAnnotation({ session_id_a: nodeIds[0], session_id_b: nodeIds[1], text: '', submitting: false, error: null })
            }
          }}
        >
          + Add connection
        </button>
      </div>

      {/* Insights strip (issue #5) — plain-English "so what" for the same edge
          data the graph above already renders. Hovering a card glows the
          matching node(s) above via the highlightedNodeIds hover-sync effect;
          clicking a card with exactly one linked node opens that decision,
          same as clicking the node itself. */}
      {insights.length > 0 ? (
        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          {insights.map(insight => {
            const kindColor: Record<GraphInsight['kind'], string> = {
              contradiction: 'var(--graph-edge-contradiction)',
              bias:          'var(--graph-edge-bias)',
              connected:     'var(--gold-bright)',
              structural:    'var(--graph-edge-structural)',
              annotation:    'var(--graph-edge-annotation)',
            }
            return (
              <div
                key={insight.id}
                className="dg-insight-card"
                onMouseEnter={() => setHighlightedNodeIds(insight.nodeIds)}
                onMouseLeave={() => setHighlightedNodeIds([])}
                onClick={() => { if (insight.nodeIds.length === 1) router.push(`/record/${insight.nodeIds[0]}`) }}
                style={{
                  background:   'var(--bg-card)',
                  border:       '1px solid var(--border-dim)',
                  borderRadius: 8,
                  padding:      '10px 12px',
                  cursor:       insight.nodeIds.length === 1 ? 'pointer' : 'default',
                  transition:   'border-color 0.15s',
                }}
              >
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: kindColor[insight.kind], marginBottom: 4 }}>
                  {insight.label}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
                  {insight.body}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        // GRAPH-6: dipstick finding (issue #6 review) — every other threshold-
        // gated module in Mirror (Decision Rules, Contradiction Detector,
        // Pattern Memory) reframes "not enough data yet" forward ("Building
        // the map", milestone labels) rather than rendering a silent gap.
        // The graph itself renders from 2 sessions, but most insight types
        // need a few edges to say anything meaningful — this fills that gap
        // with the same house voice instead of an empty space under a graph
        // that otherwise looks "ready".
        <p style={{ marginTop: 16, fontSize: 12, color: 'var(--text-4)', lineHeight: 1.6 }}>
          Add a few more decisions and Quorum will start surfacing patterns here — contradictions, recurring biases, and which decisions influence each other most.
        </p>
      )}

      {/* Annotation form */}
      {annotation && (
        <div style={{
          marginTop:    16,
          background:   'var(--bg-card)',
          border:       '1px solid var(--border-mid)',
          borderRadius: 8,
          padding:      '16px',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
            Add a connection you see
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-4)', margin: '0 0 12px', lineHeight: 1.6 }}>
            The system connects decisions by structural pattern. This is for causal or narrative links it can't infer — "leaving that role is why I made this decision six months later."
          </p>

          {/* Bug fix (GRAPH-1): both selects had `flex: 1` but no `min-width: 0`.
              Flex items default to `min-width: auto`, which means they refuse
              to shrink below their content's intrinsic width — and a native
              <select>'s intrinsic width is driven by whichever currently-
              selected option's text is longest (up to the 60-char snippet
              slice below). Whichever of the two decisions has the longer
              snippet forces that select to ignore its equal flex share and
              overflow the row/card instead of shrinking — which is why it
              looked like "first is fine, second overflows": it's whichever
              side has the longer text, not a fixed side. min-width: 0 lets
              both shrink correctly; the ellipsis/nowrap/hidden trio keeps the
              truncation readable instead of an abrupt content-driven cutoff. */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <select
              value={annotation.session_id_a}
              onChange={e => setAnnotation(a => a ? { ...a, session_id_a: e.target.value } : null)}
              style={{
                flex: 1, minWidth: 0, background: 'var(--bg-inset)', border: '1px solid var(--border-dim)',
                borderRadius: 4, color: 'var(--text-2)', fontSize: 11, padding: '6px 8px', fontFamily: 'inherit',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {data.nodes.map(n => (
                <option key={n.id} value={n.id}>{n.decision_snippet.slice(0, 60)}</option>
              ))}
            </select>
            <span style={{ color: 'var(--text-4)', fontSize: 12, alignSelf: 'center', flexShrink: 0 }}>connects to</span>
            <select
              value={annotation.session_id_b}
              onChange={e => setAnnotation(a => a ? { ...a, session_id_b: e.target.value } : null)}
              style={{
                flex: 1, minWidth: 0, background: 'var(--bg-inset)', border: '1px solid var(--border-dim)',
                borderRadius: 4, color: 'var(--text-2)', fontSize: 11, padding: '6px 8px', fontFamily: 'inherit',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {data.nodes.filter(n => n.id !== annotation.session_id_a).map(n => (
                <option key={n.id} value={n.id}>{n.decision_snippet.slice(0, 60)}</option>
              ))}
            </select>
          </div>

          <textarea
            value={annotation.text}
            onChange={e => setAnnotation(a => a ? { ...a, text: e.target.value } : null)}
            placeholder="One sentence — why do these connect?"
            maxLength={400}
            rows={2}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'var(--bg-inset)', border: '1px solid var(--border-dim)',
              borderRadius: 4, color: 'var(--text-2)', fontSize: 12,
              padding: '8px 10px', fontFamily: 'inherit', resize: 'none',
              lineHeight: 1.5, marginBottom: 4,
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <div style={{ fontSize: 10, color: annotation.error ? 'var(--error, #e05050)' : 'var(--text-4)' }}>
              {annotation.error ?? `${annotation.text.length}/400`}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setAnnotation(null)}
                style={{ fontSize: 11, color: 'var(--text-4)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', fontFamily: 'inherit' }}
              >
                Cancel
              </button>
              <button
                onClick={submitAnnotation}
                disabled={annotation.submitting || !annotation.text.trim() || annotation.session_id_a === annotation.session_id_b}
                style={{
                  fontSize: 11, fontWeight: 600, padding: '5px 14px', borderRadius: 4,
                  background: annotation.submitting ? 'var(--border-dim)' : 'rgba(201,168,76,0.15)',
                  border: '1px solid var(--gold-dim)',
                  color: annotation.submitting ? 'var(--text-4)' : 'var(--gold)',
                  cursor: annotation.submitting ? 'default' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {annotation.submitting ? 'Saving…' : 'Save connection'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edge/node count */}
      <div style={{ marginTop: 10, fontSize: 10, color: 'var(--text-4)', textAlign: 'right', letterSpacing: '0.04em' }}>
        {data.nodes.length} decisions · {data.edges.filter(e => !dismissed.has(e.id)).length} connections
      </div>
    </div>
  )
}
