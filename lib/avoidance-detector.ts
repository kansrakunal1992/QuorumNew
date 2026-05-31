// lib/avoidance-detector.ts
// ── R11 Avoidance Detection Engine (Sprint D2) ───────────────────────────────
//
// Implements the full R11 trigger: upstream_dependency >= 4 AND days_open >= 45
// AND no outcome filed. Run daily via Railway cron
// (app/api/cron/avoidance-detect/route.ts, CRON_SECRET auth).
//
// Detection pipeline per user:
//   Step 1 — Load completed sessions for user (sessions table has user_id).
//   Step 2 — Parallel fetch: sessions_ontology + outcomes, both scoped to
//             the session IDs from Step 1 (neither table has user_id).
//   Step 3 — Gate each session: upstream_dependency >= 4 AND
//             days_open (NOW - COALESCE(last_action_at, created_at)) >= 45 AND
//             no outcome filed.
//   Step 4 — Filter sessions that already have an undismissed avoidance alert.
//   Step 5 — For each qualifying session: compute structural_echo — best prior
//             RESOLVED session with score >= 60 using scoreStructuralSimilarity.
//   Step 6 — Upsert to avoidance_alerts.
//
// Design decisions:
//   - Two-step DB fetch: sessions first (has user_id filter), then ontology +
//     outcomes scoped by session IDs. Avoids cross-table user_id joins that
//     the schema doesn't support.
//   - structural_echo threshold: 60/100 (vs 45 for Council injection) — higher
//     bar because the echo surfaces as a human observation to the user.
//   - Only v2.0 sessions scored for structural echo — v1.0 vectors absent.
//   - Mirror-access gate enforced in D3 alerts route, not here.
//   - Non-fatal: per-user errors caught, logged, counted. Always resolves.
//
// Requires: SUPABASE_SERVICE_ROLE_KEY (via createServiceClient)
// ─────────────────────────────────────────────────────────────────────────────

import { createServiceClient }       from '@/lib/supabase'
import { scoreStructuralSimilarity } from '@/lib/structural-retrieval'
import type { OntologySnapshot }     from '@/lib/structural-retrieval'

// ── Thresholds ────────────────────────────────────────────────────────────────

// R11 fix: configurable via Railway env vars (no deploy needed to tune).
// Defaults match the R11 spec values. Re-evaluate at 100 + 250 sessions.
const AVOIDANCE_DAYS_THRESHOLD  = Number(process.env.AVOIDANCE_DAYS_THRESHOLD  ?? '45')
const UPSTREAM_DEP_THRESHOLD    = 4    // structural spec — not tunable independently
const STRUCTURAL_ECHO_MIN_SCORE = Number(process.env.STRUCTURAL_ECHO_MIN_SCORE ?? '60')
const USER_SESSION_FETCH_LIMIT  = 100  // max sessions loaded per user per pass

// ── Types ─────────────────────────────────────────────────────────────────────

interface RawSession {
  id:             string
  decision_text:  string
  created_at:     string
  last_action_at: string | null
}

interface SessionWithOntology extends RawSession {
  ontology_vector:    Record<string, { score: number; confidence: number; rationale?: string }> | null
  tagger_version:     string | null
  upstream_dep_score: number | null
}

interface ResolvedSession extends SessionWithOntology {
  what_decided: string
}

export interface StructuralEcho {
  sessionId:       string
  matchScore:      number
  decisionSnippet: string
  outcomeSummary:  string
}

export interface AvoidanceDetectionResult {
  detected: number
  skipped:  number
  errors:   number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysOpen(session: RawSession): number {
  const anchor = session.last_action_at ?? session.created_at
  return Math.floor((Date.now() - new Date(anchor).getTime()) / 86_400_000)
}

function extractUpstreamDep(
  ov: Record<string, { score: number; confidence: number }> | null,
): number | null {
  if (!ov) return null
  const dim = ov['upstream_dependency']
  return (dim && typeof dim.score === 'number') ? dim.score : null
}

// Build an OntologySnapshot for scoreStructuralSimilarity.
// Uses safe defaults for v1.0 categorical fields that may be missing on
// v2.0-only records — these fields are not used in v2.0 vector scoring.
function toOntologySnapshot(s: SessionWithOntology): OntologySnapshot {
  const ov = (s.ontology_vector as Record<string, any>) ?? {}
  return {
    session_id:              s.id,
    decision_text:           s.decision_text,
    created_at:              s.created_at,
    tagger_version:          s.tagger_version ?? 'v2.0',
    ontology_vector:         s.ontology_vector,
    decision_type_primary:   ov.decision_type_primary   ?? '',
    decision_type_secondary: ov.decision_type_secondary ?? [],
    stakes_reversibility:    ov.stakes_reversibility    ?? '',
    stakes_bearer:           ov.stakes_bearer           ?? '',
    stakes_timeline:         ov.stakes_timeline         ?? '',
    has_stated_deadline:     ov.has_stated_deadline     ?? false,
    deadline_source:         ov.deadline_source         ?? 'none',
    deadline_credibility:    ov.deadline_credibility    ?? 'none',
    counterparty_present:    ov.counterparty_present    ?? false,
    counterparty_alignment:  ov.counterparty_alignment  ?? 'unknown',
    relationship_type:       ov.relationship_type       ?? '',
    instrumental_weight:     ov.instrumental_weight     ?? 0.5,
    constitutive_weight:     ov.constitutive_weight     ?? 0.5,
    dominant_emotion:        ov.dominant_emotion        ?? '',
    outcome:                 null,
  }
}

// ── Structural echo ───────────────────────────────────────────────────────────
//
// Finds the best prior resolved session with structural similarity >= 60/100.
// Uses scoreStructuralSimilarity (pure function) — no LLM call.
// Returns null if no qualifying match, or if flagged session lacks v2.0 vector.

function computeStructuralEcho(
  flagged:  SessionWithOntology,
  resolved: ResolvedSession[],
): StructuralEcho | null {
  if (flagged.tagger_version !== 'v2.0' || !flagged.ontology_vector) return null
  if (resolved.length === 0) return null

  const currentSnapshot = toOntologySnapshot(flagged)
  let bestScore = 0
  let bestMatch: ResolvedSession | null = null

  for (const r of resolved) {
    if (r.id === flagged.id) continue
    if (r.tagger_version !== 'v2.0' || !r.ontology_vector) continue
    try {
      const breakdown = scoreStructuralSimilarity(currentSnapshot, toOntologySnapshot(r))
      if (breakdown.total >= STRUCTURAL_ECHO_MIN_SCORE && breakdown.total > bestScore) {
        bestScore = breakdown.total
        bestMatch = r
      }
    } catch {
      // scoreStructuralSimilarity is pure — skip malformed snapshots
    }
  }

  if (!bestMatch) return null

  return {
    sessionId:       bestMatch.id,
    matchScore:      bestScore,
    decisionSnippet: bestMatch.decision_text.slice(0, 120),
    outcomeSummary:  bestMatch.what_decided.slice(0, 120),
  }
}

// ── Per-user detection ────────────────────────────────────────────────────────

async function detectForUser(
  userId:   string,
  supabase: ReturnType<typeof createServiceClient>,
): Promise<{ detected: number; skipped: number }> {
  let detected = 0
  let skipped  = 0

  // ── Step 1: Load this user's completed sessions ───────────────────────────
  // sessions table has user_id — scoped correctly.

  const { data: sessionData, error: sessionErr } = await supabase
    .from('sessions')
    .select('id, decision_text, created_at, last_action_at')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(USER_SESSION_FETCH_LIMIT)

  if (sessionErr || !sessionData || sessionData.length === 0) {
    return { detected: 0, skipped: 0 }
  }

  const allSessions  = sessionData as RawSession[]
  const allSessionIds = allSessions.map(s => s.id)

  // ── Step 2: Parallel fetch ontology + outcomes scoped to session IDs ──────
  // Neither sessions_ontology nor outcomes has a user_id column.
  // Scope both by the session IDs we loaded in Step 1.

  const [ontologyRes, outcomesRes] = await Promise.all([
    supabase
      .from('sessions_ontology')
      .select('session_id, ontology_vector, tagger_version')
      .in('session_id', allSessionIds)
      .not('ontology_vector', 'is', null),
    supabase
      .from('outcomes')
      .select('session_id, what_decided')
      .in('session_id', allSessionIds),
  ])

  // Build lookup maps
  const ontologyMap = new Map<string, { ontology_vector: any; tagger_version: string | null }>(
    ((ontologyRes.data ?? []) as any[]).map((r: any) => [
      r.session_id as string,
      { ontology_vector: r.ontology_vector, tagger_version: r.tagger_version as string | null },
    ])
  )

  const resolvedMap = new Map<string, string>(
    ((outcomesRes.data ?? []) as any[]).map((r: any) => [
      r.session_id as string,
      r.what_decided as string,
    ])
  )

  // ── Step 3: Enrich sessions with ontology data ────────────────────────────

  const enriched: SessionWithOntology[] = allSessions.map(s => {
    const ont = ontologyMap.get(s.id)
    const ov  = ont?.ontology_vector ?? null
    return {
      ...s,
      ontology_vector:    ov,
      tagger_version:     ont?.tagger_version ?? null,
      upstream_dep_score: extractUpstreamDep(ov),
    }
  })

  // Resolved sessions pool for structural echo computation
  const resolvedSessions: ResolvedSession[] = enriched
    .filter(s => resolvedMap.has(s.id))
    .map(s => ({ ...s, what_decided: resolvedMap.get(s.id)! }))

  // ── Step 4: Identify R11 candidates ──────────────────────────────────────
  // Gate: upstream_dep >= 4 AND days_open >= 45 AND no outcome filed

  const candidates = enriched.filter(s => {
    if ((s.upstream_dep_score ?? 0) < UPSTREAM_DEP_THRESHOLD) return false
    if (resolvedMap.has(s.id)) return false
    return daysOpen(s) >= AVOIDANCE_DAYS_THRESHOLD
  })

  if (candidates.length === 0) return { detected: 0, skipped: 0 }

  // ── Step 5: Filter already-alerted sessions ───────────────────────────────

  const { data: existingAlerts } = await supabase
    .from('avoidance_alerts')
    .select('session_id')
    .in('session_id', candidates.map(s => s.id))
    .is('dismissed_at', null)

  const alertedSet = new Set<string>(
    ((existingAlerts ?? []) as any[]).map((a: any) => a.session_id as string)
  )

  const toAlert = candidates.filter(s => !alertedSet.has(s.id))

  if (toAlert.length === 0) {
    skipped += candidates.length
    return { detected, skipped }
  }

  // ── Step 6: Write avoidance_alerts ────────────────────────────────────────

  for (const session of toAlert) {
    const days           = daysOpen(session)
    const structuralEcho = computeStructuralEcho(session, resolvedSessions)

    const { error } = await supabase
      .from('avoidance_alerts')
      .insert({
        user_id:                   userId,
        session_id:                session.id,
        days_open:                 days,
        upstream_dependency_score: session.upstream_dep_score,
        structural_echo:           structuralEcho ?? null,
        detected_at:               new Date().toISOString(),
      })

    if (error) {
      console.error(
        `[AvoidanceDetector] insert failed — session ${session.id}:`,
        error.message,
      )
      skipped++
    } else {
      console.log(
        `[AvoidanceDetector] Alert written — user ${userId.slice(0, 8)} ` +
        `session ${session.id.slice(0, 8)} ` +
        `(${days}d open, upstream_dep: ${session.upstream_dep_score}, ` +
        `echo: ${structuralEcho ? `${structuralEcho.matchScore}/100` : 'none'})`,
      )
      detected++
    }
  }

  skipped += candidates.length - toAlert.length
  return { detected, skipped }
}

// ── runAvoidanceDetectionPass ─────────────────────────────────────────────────
//
// Called by app/api/cron/avoidance-detect/route.ts.
// targetUserId — when provided, scoped to that user only (on-demand, D3).
// When omitted — processes all users with eligible sessions (daily cron path).
// Always resolves. Never throws to caller.

export async function runAvoidanceDetectionPass(
  targetUserId?: string,
): Promise<AvoidanceDetectionResult> {
  const supabase = createServiceClient()
  let detected   = 0
  let skipped    = 0
  let errors     = 0

  try {
    let userIds: string[] = []

    if (targetUserId) {
      userIds = [targetUserId]
    } else {
      // Find all distinct user_ids with at least one completed session
      // old enough to be a candidate (rough cutoff — exact per-session gate
      // in detectForUser uses COALESCE(last_action_at, created_at)).
      const roughCutoff = new Date(
        Date.now() - AVOIDANCE_DAYS_THRESHOLD * 24 * 60 * 60 * 1000,
      ).toISOString()

      const { data: rows } = await supabase
        .from('sessions')
        .select('user_id')
        .eq('status', 'completed')
        .not('user_id', 'is', null)
        .lt('created_at', roughCutoff)

      const uniqueIds = new Set<string>(
        ((rows ?? []) as any[])
          .map((r: any) => r.user_id as string | null)
          .filter((id): id is string => Boolean(id))
      )
      userIds = Array.from(uniqueIds)
    }

    console.log(`[AvoidanceDetector] Pass starting — ${userIds.length} user(s)`)

    for (const userId of userIds) {
      try {
        const result = await detectForUser(userId, supabase)
        detected += result.detected
        skipped  += result.skipped
      } catch (err) {
        console.error(`[AvoidanceDetector] Error — user ${userId.slice(0, 8)}:`, err)
        errors++
      }
    }

    console.log(
      `[AvoidanceDetector] Pass complete — ` +
      `detected: ${detected}, skipped: ${skipped}, errors: ${errors}`,
    )
  } catch (err) {
    console.error('[AvoidanceDetector] runAvoidanceDetectionPass failed:', err)
    errors++
  }

  return { detected, skipped, errors }
}
