// app/api/mirror/patterns/route.ts
// ── Mirror Module: Pattern Store (Sprint 17) ──────────────────────────────────
//
// GET /api/mirror/patterns
//
// Auth-gated: requires valid Bearer token (user_id)
// Access-gated: requires mirror_access row
// Session threshold: >= 3 sessions with rule_engine_result (patterns surface early)
//
// Aggregates rule firing frequency from the rule_engine_result JSONB column in
// sessions_ontology. No AI call — pure DB aggregation over existing data.
// Also computes top ontology dimensions from ontology_vector for v2.0 sessions.
//
// Returns:
//   {
//     threshold_met:         boolean
//     session_count:         number   — total sessions for this user
//     sessions_with_rules:   number   — sessions with a complete rule_engine_result
//     sessions_with_vectors: number   — sessions with v2.0 ontology_vector
//     patterns:              RulePattern[]   — sorted by fire_count desc
//     top_dimensions:        DimPattern[]    — top 3 by avg_score (v2.0 sessions only)
//   }
//
// RulePattern: { rule_id, label, description, type, fire_count, pct }
// DimPattern:  { dim, label, avg_score, high_count }
//
// Only rules that fired at least once are included in patterns[].
// top_dimensions is empty when sessions_with_vectors < 3.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }       from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

const PATTERNS_SESSION_THRESHOLD = 3

// ── Rule metadata ─────────────────────────────────────────────────────────────

type RuleType = 'REDIRECT' | 'GATE' | 'FLAG'

interface RuleMeta {
  label:       string
  description: string
  type:        RuleType
}

const RULE_META: Record<string, RuleMeta> = {
  R1:  { label: 'Upstream Dependency',    description: 'Decision depends on a prior unresolved decision',               type: 'REDIRECT' },
  R2:  { label: 'Identity-First Gate',    description: 'High identity alignment + ambiguity — values before analysis',  type: 'GATE'     },
  R3:  { label: 'No-Information Mode',    description: 'Low discriminating info + high uncertainty',                    type: 'GATE'     },
  R4:  { label: 'Regret Asymmetry',       description: 'Strong irreversibility asymmetry — downside vastly exceeds up', type: 'FLAG'     },
  R5:  { label: 'False Urgency',          description: 'High emotional intensity without genuine time pressure',        type: 'FLAG'     },
  R6:  { label: 'Multi-Party Alignment',  description: 'Multiple stakeholders + high emotion — alignment needed first', type: 'FLAG'     },
  R7:  { label: 'Information-First',      description: 'Specific missing info would change the answer — gather first',  type: 'REDIRECT' },
  R8:  { label: 'Irreconcilable Values',  description: 'Deep value conflict coinciding with identity stakes',           type: 'FLAG'     },
  R9:  { label: 'Irreversibility Warning', description: 'High irreversibility + emotional pressure + no real urgency', type: 'FLAG'     },
  R10: { label: 'Complexity Overload',    description: 'High task complexity + high ambiguity — structure before action', type: 'GATE'   },
  R12: { label: 'Couple Misalignment',    description: 'Joint decision with value conflict — alignment before analysis', type: 'FLAG'   },
}

// ── Ontology dimension labels ─────────────────────────────────────────────────

const DIM_LABELS: Record<string, string> = {
  reversibility:               'Reversibility',
  time_horizon:                'Time Horizon',
  stakes_magnitude:            'Stakes Magnitude',
  outcome_uncertainty:         'Outcome Uncertainty',
  ambiguity:                   'Ambiguity',
  task_complexity:             'Task Complexity',
  decision_discriminating_info:'Decision Information Gap',
  time_pressure:               'Time Pressure',
  decision_unit:               'Decision Unit Size',
  value_conflict:              'Value Conflict',
  emotional_intensity:         'Emotional Intensity',
  identity_alignment:          'Identity Alignment',
  regret_asymmetry:            'Regret Asymmetry',
  upstream_dependency:         'Upstream Dependency',
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

export async function GET(req: Request) {

  // ── 1. Auth ───────────────────────────────────────────────────────────────
  const userId = await resolveUserId(req)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  // ── 2. Mirror access gate ─────────────────────────────────────────────────
  const { data: accessRow } = await supabase
    .from('mirror_access')
    .select('id, expires_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (!accessRow) {
    return NextResponse.json({ error: 'Mirror access required' }, { status: 403 })
  }

  if (accessRow.expires_at && new Date(accessRow.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Mirror access has expired' }, { status: 403 })
  }

  // ── 3. Fetch user sessions ────────────────────────────────────────────────
  const { data: sessionRows, count: sessionCount } = await supabase
    .from('sessions')
    .select('id', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(100)

  const totalSessions = sessionCount ?? 0

  if (totalSessions < PATTERNS_SESSION_THRESHOLD) {
    return NextResponse.json({
      threshold_met:         false,
      session_count:         totalSessions,
      sessions_with_rules:   0,
      sessions_with_vectors: 0,
      patterns:              [],
      top_dimensions:        [],
    })
  }

  if (!sessionRows || sessionRows.length === 0) {
    return NextResponse.json({
      threshold_met:         false,
      session_count:         0,
      sessions_with_rules:   0,
      sessions_with_vectors: 0,
      patterns:              [],
      top_dimensions:        [],
    })
  }

  const sessionIds = sessionRows.map(s => s.id)

  // ── 4. Fetch ontology rows for all sessions ───────────────────────────────
  const { data: ontologyRows, error: ontErr } = await supabase
    .from('sessions_ontology')
    .select('session_id, tagger_version, tagger_status, rule_engine_result, ontology_vector')
    .in('session_id', sessionIds)
    .eq('tagger_status', 'complete')

  if (ontErr) {
    console.error('[mirror/patterns] sessions_ontology fetch failed:', ontErr)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  const rows = ontologyRows ?? []

  // ── 5. Aggregate rule firing frequency ────────────────────────────────────
  // Count each rule_id across triggered_rules and flag_rules in all sessions.
  const ruleCounts: Record<string, number> = {}
  let sessionsWithRules = 0

  for (const row of rows) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rer = row.rule_engine_result as any
    if (!rer) continue
    sessionsWithRules++

    const allRules: string[] = [
      ...((rer.triggered_rules ?? []) as Array<{ rule_id: string }>).map(r => r.rule_id),
      ...((rer.flag_rules      ?? []) as Array<{ rule_id: string }>).map(r => r.rule_id),
    ]

    for (const ruleId of allRules) {
      ruleCounts[ruleId] = (ruleCounts[ruleId] ?? 0) + 1
    }
  }

  // Build sorted pattern array — only rules that fired at least once
  const patterns = Object.entries(ruleCounts)
    .filter(([, count]) => count > 0)
    .map(([ruleId, count]) => {
      const meta = RULE_META[ruleId]
      return {
        rule_id:     ruleId,
        label:       meta?.label       ?? ruleId,
        description: meta?.description ?? '',
        type:        meta?.type        ?? 'FLAG' as RuleType,
        fire_count:  count,
        pct:         sessionsWithRules > 0 ? Math.round((count / sessionsWithRules) * 100) / 100 : 0,
      }
    })
    .sort((a, b) => b.fire_count - a.fire_count)

  // ── 6. Aggregate ontology dimensions (v2.0 sessions only) ─────────────────
  const dimSums:  Record<string, number> = {}
  const dimCounts: Record<string, number> = {}
  const dimHighCounts: Record<string, number> = {}
  let sessionsWithVectors = 0

  for (const row of rows) {
    if (row.tagger_version !== 'v2.0') continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vec = row.ontology_vector as any
    if (!vec || typeof vec !== 'object') continue
    sessionsWithVectors++

    for (const dim of Object.keys(DIM_LABELS)) {
      const dimData = vec[dim]
      if (!dimData || typeof dimData.score !== 'number') continue
      dimSums[dim]   = (dimSums[dim]   ?? 0) + dimData.score
      dimCounts[dim] = (dimCounts[dim] ?? 0) + 1
      if (dimData.score >= 4) {
        dimHighCounts[dim] = (dimHighCounts[dim] ?? 0) + 1
      }
    }
  }

  // Only surface top_dimensions when we have enough v2.0 sessions for signal
  const top_dimensions = sessionsWithVectors >= 3
    ? Object.keys(DIM_LABELS)
        .filter(dim => dimCounts[dim] > 0)
        .map(dim => ({
          dim,
          label:      DIM_LABELS[dim],
          avg_score:  Math.round((dimSums[dim] / dimCounts[dim]) * 10) / 10,
          high_count: dimHighCounts[dim] ?? 0,
        }))
        .sort((a, b) => b.avg_score - a.avg_score)
        .slice(0, 5)
    : []

  // ── 7. Return ─────────────────────────────────────────────────────────────
  return NextResponse.json({
    threshold_met:         true,
    session_count:         totalSessions,
    sessions_with_rules:   sessionsWithRules,
    sessions_with_vectors: sessionsWithVectors,
    patterns,
    top_dimensions,
  })
}
