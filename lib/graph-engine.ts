import 'server-only'
// ^ Build-time guard (Sprint G1). This module imports lib/encryption.ts
// (via encrypt/decrypt) and lib/structural-retrieval.ts (via
// scoreStructuralSimilarity), both of which import lib/ai-client.ts
// transitively. Explicit guard added per TB1 KDD discipline.

/**
 * lib/graph-engine.ts
 * ── Quorum: Decision Graph materialization engine ─────────────────────────────
 *
 * Sprint G1 (June 2026) — Data layer for the Decision Graph (Sprint 1 of 4).
 * No UI, no query API — those are Sprint G2 and G3. This module only materialises
 * and persists graph edges from data the existing engines already compute.
 *
 * Edge sources:
 *   structural_similarity  — from scoreStructuralSimilarity() (lib/structural-retrieval.ts)
 *                            persisted live from /api/structural-match scoring loop
 *                            and on demand via backfill
 *   contradiction          — from contradiction_log table (contradiction-detector.ts output)
 *   shared_bias_trigger    — from bias_library.session_ids (bias-trigger-engine.ts output)
 *   shared_decision_type   — from sessions_ontology.decision_type_primary grouping
 *   user_asserted          — Sprint G2 (user-authored edges via Mirror UI). Not in this file.
 *
 * Pair canonicalisation: session_id_a < session_id_b (UUID lexicographic order).
 * The unique constraint on (session_id_a, session_id_b, edge_type) in graph_edges
 * means the canonicalisation must be consistent — this module enforces it before
 * every upsert. Mismatched canonicalisation = silent duplicate rows + failed upserts.
 *
 * MATCH_THRESHOLD: same env var as lib/structural-retrieval.ts (default 45).
 * graph_edges only persists structural pairs that clear the threshold — below it,
 * the cosine similarity is too weak to be a useful graph edge.
 *
 * Encryption: explanation_text (user_asserted, Sprint G2+) is raw user input
 * → encrypt() before write, decrypt() after read. All other fields are derived
 * or computed — excluded from encryption per lib/encryption.ts policy.
 */

import { createServiceClient } from '@/lib/supabase'
import { encrypt, decrypt }    from '@/lib/encryption'
import {
  scoreStructuralSimilarity,
  type OntologySnapshot,
  type OntologyVector,
  type ScoreBreakdown,
} from '@/lib/structural-retrieval'

// Same env var as lib/structural-retrieval.ts — graph only materialises pairs
// that clear this threshold. Read independently to avoid a circular dependency
// on the retrieval module's internal constant.
const MATCH_THRESHOLD = Number(process.env.MATCH_THRESHOLD ?? 45)

// ── Types ─────────────────────────────────────────────────────────────────────

export type EdgeType =
  | 'structural_similarity'
  | 'contradiction'
  | 'shared_bias_trigger'
  | 'shared_decision_type'
  | 'user_asserted'

// Explainability payload stored in dimension_breakdown jsonb for
// structural_similarity edges. Sprint 3 UI reads this to explain
// "why two decisions connect" on edge click.
export interface DimensionBreakdown {
  vector_similarity: number     // raw cosine (0–1)
  total:             number     // 0–100 scaled score
  top_matching_dims: string[]   // top 3 VectorDimName values — the human-readable "why"
  scoring_mode:      'vector' | 'categorical'
}

// Shape returned by the Sprint G2 query API (decrypted, UI-safe).
export interface GraphEdge {
  id:                  string
  user_id:             string
  session_id_a:        string
  session_id_b:        string
  edge_type:           EdgeType
  strength:            number | null
  dimension_breakdown: DimensionBreakdown | null
  explanation_text:    string | null   // decrypted; null for all computed types
  metadata:            Record<string, unknown> | null
  dismissed_at:        string | null
  computed_at:         string
}

// ── Pair canonicalisation ─────────────────────────────────────────────────────
// Computed edges are undirected. Always put the lexicographically smaller UUID
// as session_id_a so the unique constraint covers exactly one row per pair.
// Must be called before every upsert — inconsistent ordering = silent broken
// unique constraint, two rows where there should be one.
function canonicalize(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

// ── buildDimensionBreakdown ───────────────────────────────────────────────────
// Converts a ScoreBreakdown from scoreStructuralSimilarity() into the
// serialisable DimensionBreakdown stored in graph_edges.dimension_breakdown.
// Called from both the live path (upsertStructuralEdge) and the backfill.
function buildDimensionBreakdown(breakdown: ScoreBreakdown): DimensionBreakdown {
  return {
    vector_similarity: Math.round((breakdown.vector_similarity ?? 0) * 1000) / 1000,
    total:             breakdown.total,
    top_matching_dims: breakdown.top_matching_dims ?? [],
    scoring_mode:      breakdown.scoring_mode,
  }
}

// ── upsertStructuralEdge ──────────────────────────────────────────────────────
// Called from app/api/structural-match/route.ts's scoring loop for every
// pair that clears MATCH_THRESHOLD. No AI call — purely persisting data the
// scoring loop already computed.
//
// KDD (Sprint G1): graph edge writes are additive to the structural-match
// flow, never synthesis-blocking. Errors are caught and logged but never
// thrown to the route's caller. The structural-match route response is
// never delayed waiting for a graph write.

export async function upsertStructuralEdge(
  supabase:  ReturnType<typeof createServiceClient>,
  userId:    string,
  sessionA:  string,
  sessionB:  string,
  breakdown: ScoreBreakdown,
): Promise<void> {
  if (!userId || breakdown.total < MATCH_THRESHOLD) return

  const [sid_a, sid_b] = canonicalize(sessionA, sessionB)

  const { error } = await supabase
    .from('graph_edges')
    .upsert(
      {
        user_id:             userId,
        session_id_a:        sid_a,
        session_id_b:        sid_b,
        edge_type:           'structural_similarity' as EdgeType,
        strength:            breakdown.vector_similarity ?? null,
        dimension_breakdown: buildDimensionBreakdown(breakdown),
        explanation_text:    null,
        metadata:            null,
        computed_at:         new Date().toISOString(),
      },
      { onConflict: 'session_id_a,session_id_b,edge_type' },
    )

  if (error) {
    console.error('[GraphEngine] upsertStructuralEdge failed:', error.message, '| code:', error.code)
  }
}

// ── backfillStructuralEdges ───────────────────────────────────────────────────
// Re-scores all v2.0 session pairs for a user from their stored ontology vectors
// and writes qualifying edges to graph_edges.
//
// Only v2.0 sessions are backfilled — v1.0 sessions have no ontology_vector and
// produce only weak categorical scores with no top_matching_dims (no explainability).
// O(n²) pairwise scoring — safe at current scale (~5–20 v2.0 sessions per user).
// All scoring is synchronous (scoreStructuralSimilarity has no async path for
// v2.0 vector pairs — annotateMatch is not called here).

async function backfillStructuralEdges(
  supabase: ReturnType<typeof createServiceClient>,
  userId:   string,
): Promise<number> {
  // Step 1: get all session IDs belonging to this user
  const { data: userSessions, error: sessErr } = await supabase
    .from('sessions')
    .select('id')
    .eq('user_id', userId)

  if (sessErr || !userSessions || userSessions.length < 2) return 0
  const sessionIds = userSessions.map((s: { id: string }) => s.id)

  // Step 2: get v2.0 ontology vectors for those sessions
  const { data: rows, error: ontoErr } = await supabase
    .from('sessions_ontology')
    .select('session_id, tagger_version, ontology_vector')
    .in('session_id', sessionIds)
    .eq('tagger_version', 'v2.0')
    .not('ontology_vector', 'is', null)

  if (ontoErr || !rows || rows.length < 2) return 0

  // Build minimal OntologySnapshot objects. Only tagger_version + ontology_vector
  // matter for v2.0 vector scoring (the bothV2 branch in scoreStructuralSimilarity
  // never reads the other fields). Defaults are required to satisfy the interface.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snapshots: OntologySnapshot[] = (rows as any[]).map(r => ({
    session_id:              r.session_id as string,
    decision_text:           '',
    created_at:              '',
    decision_type_primary:   '',
    decision_type_secondary: [],
    stakes_reversibility:    '',
    stakes_bearer:           '',
    stakes_timeline:         '',
    has_stated_deadline:     false,
    deadline_source:         '',
    deadline_credibility:    '',
    counterparty_present:    false,
    counterparty_alignment:  '',
    relationship_type:       '',
    instrumental_weight:     0.5,
    constitutive_weight:     0.5,
    dominant_emotion:        '',
    tagger_version:          'v2.0' as const,
    ontology_vector:         r.ontology_vector as OntologyVector,
  }))

  // Score all pairs, write qualifying edges
  let written = 0
  for (let i = 0; i < snapshots.length; i++) {
    for (let j = i + 1; j < snapshots.length; j++) {
      const breakdown = scoreStructuralSimilarity(snapshots[i], snapshots[j])
      if (breakdown.total >= MATCH_THRESHOLD) {
        await upsertStructuralEdge(
          supabase,
          userId,
          snapshots[i].session_id,
          snapshots[j].session_id,
          breakdown,
        )
        written++
      }
    }
  }
  return written
}

// ── backfillContradictionEdges ────────────────────────────────────────────────
// Reads contradiction_log for sessions belonging to this user and writes an
// edge between each principle/violation pair. contradiction_log uses user_email
// for identity (not user_id directly) — so this function resolves via the
// sessions table instead of querying contradiction_log.user_email directly,
// which would require email lookup and isn't available on the server without
// the auth token.

async function backfillContradictionEdges(
  supabase: ReturnType<typeof createServiceClient>,
  userId:   string,
): Promise<number> {
  // Resolve session IDs for this user (contradiction_log has session_id_principle
  // and session_id_violation which are foreign keys into sessions)
  const { data: userSessions, error: sessErr } = await supabase
    .from('sessions')
    .select('id')
    .eq('user_id', userId)

  if (sessErr || !userSessions || userSessions.length === 0) return 0
  const sessionIds = userSessions.map((s: { id: string }) => s.id)

  const { data: contradictions, error: cErr } = await supabase
    .from('contradiction_log')
    .select('id, session_id_principle, session_id_violation')
    .in('session_id_principle', sessionIds)
    .not('session_id_principle', 'is', null)
    .not('session_id_violation', 'is', null)

  if (cErr || !contradictions || contradictions.length === 0) return 0

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const upserts = (contradictions as any[])
    .filter(c => c.session_id_principle && c.session_id_violation)
    .map(c => {
      const [sid_a, sid_b] = canonicalize(c.session_id_principle, c.session_id_violation)
      return {
        user_id:             userId,
        session_id_a:        sid_a,
        session_id_b:        sid_b,
        edge_type:           'contradiction' as EdgeType,
        strength:            1.0,
        dimension_breakdown: null,
        explanation_text:    null,
        metadata:            { contradiction_id: c.id } as Record<string, unknown>,
        computed_at:         new Date().toISOString(),
      }
    })

  if (upserts.length === 0) return 0

  const { error: uErr } = await supabase
    .from('graph_edges')
    .upsert(upserts, { onConflict: 'session_id_a,session_id_b,edge_type' })

  if (uErr) {
    console.error('[GraphEngine] backfillContradictionEdges failed:', uErr.message)
    return 0
  }
  return upserts.length
}

// ── backfillSharedBiasEdges ───────────────────────────────────────────────────
// Each bias_library row has session_ids[] — all sessions where this bias fired
// for this user. Creates a shared_bias_trigger edge between every pair of sessions
// in that array.
//
// Multiple biases can connect the same pair (e.g. FOMO fired in sessions A+B,
// AND overconfidence fired in A+B). The unique constraint allows only one
// shared_bias_trigger row per pair — accumulated bias_parameters are merged
// into metadata.bias_parameters[] before upserting, so the most-recent upsert
// wins with all contributing biases preserved.

async function backfillSharedBiasEdges(
  supabase: ReturnType<typeof createServiceClient>,
  userId:   string,
): Promise<number> {
  const { data: biasRows, error } = await supabase
    .from('bias_library')
    .select('bias_parameter, session_ids, confidence_weight')
    .eq('user_id', userId)
    .not('session_ids', 'is', null)

  if (error || !biasRows || biasRows.length === 0) return 0

  // Pre-aggregate across all biases: canonical pair → { biases[], maxStrength }
  const pairMap = new Map<string, {
    sid_a:    string
    sid_b:    string
    biases:   string[]
    strength: number
  }>()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of biasRows as any[]) {
    const sessionIds: string[] = row.session_ids ?? []
    if (sessionIds.length < 2) continue
    const biasParam:  string  = row.bias_parameter
    const weight:     number  = typeof row.confidence_weight === 'number' ? row.confidence_weight : 0.3

    for (let i = 0; i < sessionIds.length; i++) {
      for (let j = i + 1; j < sessionIds.length; j++) {
        const [sid_a, sid_b] = canonicalize(sessionIds[i], sessionIds[j])
        const key = `${sid_a}:${sid_b}`
        const existing = pairMap.get(key)
        if (existing) {
          if (!existing.biases.includes(biasParam)) existing.biases.push(biasParam)
          existing.strength = Math.max(existing.strength, weight)
        } else {
          pairMap.set(key, { sid_a, sid_b, biases: [biasParam], strength: weight })
        }
      }
    }
  }

  if (pairMap.size === 0) return 0

  const upserts = Array.from(pairMap.values()).map(({ sid_a, sid_b, biases, strength }) => ({
    user_id:             userId,
    session_id_a:        sid_a,
    session_id_b:        sid_b,
    edge_type:           'shared_bias_trigger' as EdgeType,
    strength:            Math.round(strength * 1000) / 1000,
    dimension_breakdown: null,
    explanation_text:    null,
    metadata:            { bias_parameters: biases } as Record<string, unknown>,
    computed_at:         new Date().toISOString(),
  }))

  // Batch in groups of 50 to stay under Supabase payload limits
  let written = 0
  for (let i = 0; i < upserts.length; i += 50) {
    const batch = upserts.slice(i, i + 50)
    const { error: uErr } = await supabase
      .from('graph_edges')
      .upsert(batch, { onConflict: 'session_id_a,session_id_b,edge_type' })
    if (uErr) {
      console.error('[GraphEngine] backfillSharedBiasEdges batch failed:', uErr.message)
    } else {
      written += batch.length
    }
  }
  return written
}

// ── backfillSharedDecisionTypeEdges ──────────────────────────────────────────
// Groups the user's sessions_ontology rows by decision_type_primary, then
// creates a shared_decision_type edge between every pair within each group.
// Simple categorical grouping — no vector scoring, no threshold.
// A pair with 2+ shared decision types (e.g. both 'commitment' and 'allocation'
// as secondary types) is not handled here — primary type only, keeping it clean.

async function backfillSharedDecisionTypeEdges(
  supabase: ReturnType<typeof createServiceClient>,
  userId:   string,
): Promise<number> {
  // Resolve session IDs for this user first (sessions_ontology has no user_id column)
  const { data: userSessions, error: sessErr } = await supabase
    .from('sessions')
    .select('id')
    .eq('user_id', userId)

  if (sessErr || !userSessions || userSessions.length < 2) return 0
  const sessionIds = userSessions.map((s: { id: string }) => s.id)

  const { data: rows, error } = await supabase
    .from('sessions_ontology')
    .select('session_id, decision_type_primary')
    .in('session_id', sessionIds)
    .not('decision_type_primary', 'is', null)

  if (error || !rows || rows.length < 2) return 0

  // Group by decision_type_primary
  const groups = new Map<string, string[]>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of rows as any[]) {
    const dt = row.decision_type_primary as string | null
    if (!dt) continue
    if (!groups.has(dt)) groups.set(dt, [])
    groups.get(dt)!.push(row.session_id as string)
  }

  const upserts: Record<string, unknown>[] = []
  for (const [decisionType, sessIds] of groups) {
    if (sessIds.length < 2) continue
    for (let i = 0; i < sessIds.length; i++) {
      for (let j = i + 1; j < sessIds.length; j++) {
        const [sid_a, sid_b] = canonicalize(sessIds[i], sessIds[j])
        upserts.push({
          user_id:             userId,
          session_id_a:        sid_a,
          session_id_b:        sid_b,
          edge_type:           'shared_decision_type' as EdgeType,
          strength:            1.0,
          dimension_breakdown: null,
          explanation_text:    null,
          metadata:            { decision_type: decisionType },
          computed_at:         new Date().toISOString(),
        })
      }
    }
  }

  if (upserts.length === 0) return 0

  let written = 0
  for (let i = 0; i < upserts.length; i += 50) {
    const batch = upserts.slice(i, i + 50)
    const { error: uErr } = await supabase
      .from('graph_edges')
      .upsert(batch, { onConflict: 'session_id_a,session_id_b,edge_type' })
    if (uErr) {
      console.error('[GraphEngine] backfillSharedDecisionTypeEdges batch failed:', uErr.message)
    } else {
      written += batch.length
    }
  }
  return written
}

// ── runFullBackfill ───────────────────────────────────────────────────────────
// Orchestrates all 4 computed edge-type backfills for one user.
// Called from /api/graph/backfill (admin endpoint, INTERNAL_API_SECRET-gated).
//
// All 4 types are run in parallel — they write to different edge_type rows
// so there's no write contention on the unique constraint.
// user_asserted edges are not backfilled — they have no historic source data.

export async function runFullBackfill(
  supabase: ReturnType<typeof createServiceClient>,
  userId:   string,
): Promise<{
  structural:    number
  contradiction: number
  bias:          number
  decision_type: number
  total:         number
}> {
  const [structural, contradiction, bias, decision_type] = await Promise.all([
    backfillStructuralEdges(supabase, userId),
    backfillContradictionEdges(supabase, userId),
    backfillSharedBiasEdges(supabase, userId),
    backfillSharedDecisionTypeEdges(supabase, userId),
  ])

  return {
    structural,
    contradiction,
    bias,
    decision_type,
    total: structural + contradiction + bias + decision_type,
  }
}

// ── decryptGraphEdge ──────────────────────────────────────────────────────────
// Used by the Sprint G2 query API to decrypt explanation_text on user_asserted
// edges before serving to the client. All other fields are plaintext/jsonb.
// Exported here so the API route doesn't import lib/encryption directly
// (maintains the single-import-chain discipline).

export function decryptGraphEdge(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: Record<string, any>,
): GraphEdge {
  return {
    id:                  row.id,
    user_id:             row.user_id,
    session_id_a:        row.session_id_a,
    session_id_b:        row.session_id_b,
    edge_type:           row.edge_type as EdgeType,
    strength:            row.strength ?? null,
    dimension_breakdown: row.dimension_breakdown as DimensionBreakdown | null,
    explanation_text:    row.explanation_text ? (decrypt(row.explanation_text) ?? null) : null,
    metadata:            row.metadata as Record<string, unknown> | null,
    dismissed_at:        row.dismissed_at ?? null,
    computed_at:         row.computed_at,
  }
}
