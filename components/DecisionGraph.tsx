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
const EDGE_COLOR: Record<EdgeType, string> = {
  structural_similarity: 'rgba(201,168,76,0.55)',   // gold — primary computed edge
  contradiction:         'rgba(220,80,80,0.55)',     // red — tension signal
  shared_bias_trigger:   'rgba(140,100,200,0.5)',    // muted purple — behavioral link
  shared_decision_type:  'rgba(100,160,200,0.45)',   // muted blue — categorical link
  user_asserted:         'rgba(201,168,76,0.3)',     // dim gold, dashed — user-authored
}
const EDGE_LABEL: Record<EdgeType, string> = {
  structural_similarity: 'Structural similarity',
  contradiction:         'Contradiction',
  shared_bias_trigger:   'Shared bias trigger',
  shared_decision_type:  'Same decision type',
  user_asserted:         'Your annotation',
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
    const H = 420

    svgRef.current.setAttribute('width',  String(W))
    svgRef.current.setAttribute('height', String(H))

    // Filter dismissed edges
    const visibleEdges = data.edges.filter(e => !dismissed.has(e.id))

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
    const node = g.append('g').selectAll('g').data(nodes).join('g').style('cursor', 'pointer')

    node.append('circle')
      .attr('r', 18)
      .attr('fill',   'var(--bg-card)')
      .attr('stroke', (d: GraphNode) => d.status === 'active' ? 'rgba(201,168,76,0.7)' : 'rgba(201,168,76,0.3)')
      .attr('stroke-width', (d: GraphNode) => d.status === 'active' ? 2 : 1.2)

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    node.call(d3.drag()
      .on('start', (event: { active: boolean }, d: { fx: number | null; fy: number | null; x: number; y: number }) => {
        if (!event.active) sim.alphaTarget(0.3).restart()
        d.fx = d.x; d.fy = d.y
      })
      .on('drag', (event: { x: number; y: number }, d: { fx: number; fy: number }) => {
        d.fx = event.x; d.fy = event.y
      })
      .on('end', (event: { active: boolean }, d: { fx: number | null; fy: number | null }) => {
        if (!event.active) sim.alphaTarget(0)
        d.fx = null; d.fy = null
      })
    )

    // Node click → record page; prevent drag from firing click
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let dragMoved = false
    node.on('mousedown', () => { dragMoved = false })
      .on('mousemove', () => { dragMoved = true })
      .on('click', (_event: MouseEvent, d: GraphNode) => {
        if (!dragMoved) router.push(`/record/${d.id}`)
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
                <circle cx="36" cy="35" r="16" fill="var(--bg-card)" stroke="rgba(201,168,76,0.7)" strokeWidth="2" />
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
        {tooltip && (
          <div
            style={{
              position:     'absolute',
              left:         Math.min(tooltip.x + 12, (containerRef.current?.clientWidth ?? 640) - 260),
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
        )}
      </div>

      {/* Legend + annotation CTA */}
      <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: '6px 16px', alignItems: 'center', justifyContent: 'space-between' }}>
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
