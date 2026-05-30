// app/api/mirror/benchmark/route.ts
// ── Sprint 20: Mirror Module — Others in Similar Decisions ────────────────────
//
// GET /api/mirror/benchmark
//
// Auth-gated: requires valid Bearer token (user_id).
// Access-gated: requires mirror_access row.
//
// Finds structurally similar sessions from OTHER users in the corpus by
// computing cosine similarity between the current user's most recent session
// ontology_vector and all other users' session vectors. Returns aggregate
// dimension signals and most common bias patterns from the cluster.
//
// Privacy:
//   - Reads only sessions_ontology (no decision_text, no user identity)
//   - Reads only aggregate bias_library counts (no per-user bias data)
//   - Minimum cluster size of 5 before any data is returned
//   - Current user's own sessions are excluded from cluster
//   - Response contains zero PII, zero session IDs
//
// Returns: BenchmarkData
//   { insufficient: boolean, cluster_size: number,
//     top_dimensions: BenchmarkDimension[], top_biases: string[] }
//
// Additional Risk C fix:
//   extractVector() previously used raw scores only (no dimension weighting).
//   structural-retrieval.ts applied 1.5× multipliers to the three ⭐ starred
//   dimensions (identity_alignment, regret_asymmetry, upstream_dependency).
//   Both used SIMILARITY_THRESHOLD = 0.808 against different distributions.
//
//   Fix: extractVector() now applies DIM_WEIGHTS imported from lib/similarity.ts
//   — the same weights used in structural-retrieval.ts. Starred dimensions
//   now carry 1.5× weight in both personal retrieval and peer benchmark,
//   making "structurally similar" mean the same thing across both surfaces.
//
//   Confidence is intentionally NOT applied cross-user: confidence is a
//   per-session tagger signal that is not portable between users. See
//   lib/similarity.ts for the full design note.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { getMirrorAccessState } from '@/lib/mirror-access'
import { DIM_WEIGHTS }          from '@/lib/similarity'   // Additional Risk C
import type { BenchmarkData }  from '@/lib/types'

// ── Config ────────────────────────────────────────────────────────────────────

const MIN_CLUSTER_SIZE   = 5      // below this: return insufficient: true
const SIMILARITY_THRESHOLD = 0.808 // cosine ≥ 0.808 ≈ total_score ≥ 45
const CORPUS_FETCH_LIMIT = 300    // max other-user sessions to scan

// ── Dimension labels for response ─────────────────────────────────────────────

const DIM_LABELS: Record<string, string> = {
  reversibility:                'Reversibility',
  time_horizon:                 'Time Horizon',
  stakes_magnitude:             'Stakes Magnitude',
  outcome_uncertainty:          'Outcome Uncertainty',
  ambiguity:                    'Ambiguity',
  task_complexity:              'Task Complexity',
  decision_discriminating_info: 'Decision Information Gap',
  time_pressure:                'Time Pressure',
  decision_unit:                'Decision Unit Size',
  value_conflict:               'Value Conflict',
  emotional_intensity:          'Emotional Intensity',
  identity_alignment:           'Identity Alignment',
  regret_asymmetry:             'Regret Asymmetry',
  upstream_dependency:          'Upstream Dependency',
}

const DIMS = Object.keys(DIM_LABELS)

// ── Cosine similarity ─────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

// Extract ordered numeric vector from ontology_vector JSONB.
// Additional Risk C: multiply each dimension score by DIM_WEIGHTS[dim] so that
// starred dimensions (identity_alignment, regret_asymmetry, upstream_dependency)
// carry the same 1.5× emphasis used in structural-retrieval.ts scoreVectorSimilarity().
// Confidence is NOT applied here — it is a per-session personal signal and is
// not portable across users for cross-user comparison. See lib/similarity.ts.
function extractVector(vec: Record<string, unknown>): number[] {
  return DIMS.map(dim => {
    const d     = vec[dim] as { score?: number } | undefined
    const score = d?.score ?? 3   // default to mid-range when dimension is missing
    return score * (DIM_WEIGHTS[dim] ?? 1.0)
  })
}

// ── Auth helper ───────────────────────────────────────────────────────────────

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

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: Request): Promise<Response> {
  // ── 1. Auth + access gate ─────────────────────────────────────────────────
  const userId = await resolveUserId(req)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  const accessState = await getMirrorAccessState(userId, supabase)
  if (accessState !== 'unlocked') {
    return NextResponse.json({ error: 'Mirror access required' }, { status: 403 })
  }

  // ── 2. Get current user's session IDs ────────────────────────────────────
  const { data: userSessionRows } = await supabase
    .from('sessions')
    .select('id')
    .eq('user_id', userId)
    .limit(50)

  const userSessionIds = new Set((userSessionRows ?? []).map(s => s.id as string))

  if (userSessionIds.size === 0) {
    return NextResponse.json({ insufficient: true, cluster_size: 0, top_dimensions: [], top_biases: [] } satisfies BenchmarkData)
  }

  // ── 3. Get the user's most recent session ontology_vector ─────────────────
  const { data: userOntRow } = await supabase
    .from('sessions_ontology')
    .select('session_id, ontology_vector')
    .in('session_id', Array.from(userSessionIds))
    .eq('tagger_version', 'v2.0')
    .eq('tagger_status', 'complete')
    .order('session_id', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!userOntRow?.ontology_vector) {
    // User has no v2.0 ontology vector yet — benchmark unavailable
    return NextResponse.json({ insufficient: true, cluster_size: 0, top_dimensions: [], top_biases: [] } satisfies BenchmarkData)
  }

  const userVector = extractVector(userOntRow.ontology_vector as Record<string, unknown>)

  // ── 4. Fetch other users' session vectors from corpus ─────────────────────
  // Reads sessions_ontology cross-user — no PII, structural vectors only.
  const { data: corpusRows } = await supabase
    .from('sessions_ontology')
    .select('session_id, ontology_vector, user_id')
    .eq('tagger_version', 'v2.0')
    .eq('tagger_status', 'complete')
    .not('ontology_vector', 'is', null)
    .limit(CORPUS_FETCH_LIMIT)

  // ── 5. Compute similarity + build cluster ─────────────────────────────────
  const clusterSessionIds: string[] = []

  for (const row of corpusRows ?? []) {
    const sessionId = row.session_id as string

    // Exclude current user's own sessions
    if (userSessionIds.has(sessionId)) continue
    // Also exclude by user_id where available (belt + suspenders)
    if ((row.user_id as string | null) === userId) continue

    const vec = row.ontology_vector as Record<string, unknown> | null
    if (!vec) continue

    const otherVector = extractVector(vec)
    const sim = cosineSimilarity(userVector, otherVector)

    if (sim >= SIMILARITY_THRESHOLD) {
      clusterSessionIds.push(sessionId)
    }
  }

  // ── 6. Cluster size gate ──────────────────────────────────────────────────
  if (clusterSessionIds.length < MIN_CLUSTER_SIZE) {
    return NextResponse.json({
      insufficient:   true,
      cluster_size:   clusterSessionIds.length,
      top_dimensions: [],
      top_biases:     [],
    } satisfies BenchmarkData)
  }

  // ── 7. Aggregate dimension averages from cluster ──────────────────────────
  const dimSums:   Record<string, number> = {}
  const dimCounts: Record<string, number> = {}

  const { data: clusterOntRows } = await supabase
    .from('sessions_ontology')
    .select('ontology_vector')
    .in('session_id', clusterSessionIds)

  for (const row of clusterOntRows ?? []) {
    const vec = row.ontology_vector as Record<string, unknown> | null
    if (!vec) continue
    for (const dim of DIMS) {
      const d = (vec[dim] as { score?: number } | undefined)?.score
      if (typeof d === 'number') {
        dimSums[dim]   = (dimSums[dim]   ?? 0) + d
        dimCounts[dim] = (dimCounts[dim] ?? 0) + 1
      }
    }
  }

  const top_dimensions = DIMS
    .filter(dim => dimCounts[dim] > 0)
    .map(dim => ({
      dim,
      label:     DIM_LABELS[dim],
      avg_score: Math.round((dimSums[dim] / dimCounts[dim]) * 10) / 10,
    }))
    .sort((a, b) => b.avg_score - a.avg_score)
    .slice(0, 3)

  // ── 8. Aggregate top biases in cluster (via bias_library) ─────────────────
  // Fetch bias_library rows for sessions in the cluster — aggregate only.
  // Returns bias_parameter and total detection_count across all cluster sessions.
  const { data: biasRows } = await supabase
    .from('bias_library')
    .select('bias_parameter, session_ids')
    .limit(500)    // aggregate scan — no user identity returned

  // Count how many cluster sessions each bias appears in
  const biasCounts: Record<string, number> = {}

  for (const row of biasRows ?? []) {
    const sids = (row.session_ids as string[] | null) ?? []
    const overlap = sids.filter(sid => clusterSessionIds.includes(sid)).length
    if (overlap > 0) {
      const key = row.bias_parameter as string
      biasCounts[key] = (biasCounts[key] ?? 0) + overlap
    }
  }

  const top_biases = Object.entries(biasCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key]) => key)

  // ── 9. Return ─────────────────────────────────────────────────────────────
  return NextResponse.json({
    insufficient:   false,
    cluster_size:   clusterSessionIds.length,
    top_dimensions,
    top_biases,
  } satisfies BenchmarkData)
}
