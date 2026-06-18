// lib/calibration-engine.ts
// ── Dimensional Calibration Engine (Sprint CAL) ──────────────────────────────
//
// Extends the existing global calibration_delta average (lib/bias-scorer.ts:
// fetchCalibrationContext) with a per-ontology-dimension breakdown: does this
// specific user's confidence reliability change when a given structural
// dimension (stakes, irreversibility, stakeholder complexity, etc.) is
// elevated, versus when it isn't?
//
// Mechanism (deterministic, no LLM call — same philosophy as rule-engine.ts
// and session-score.ts: auditable, identical inputs always produce identical
// outputs):
//   For each of the 14 VECTOR_DIMS, split the user's outcome-logged sessions
//   into a HIGH bucket (dim score >= 4) and a LOW bucket (dim score <= 2).
//   Compare average calibration_delta (retro − pre) between the two buckets.
//   A dimension only qualifies as a "personal calibration zone" when both
//   buckets clear a minimum sample size AND the gap between bucket averages
//   clears a noise floor. Small samples and small gaps are suppressed rather
//   than reported as a false pattern — same "no noise for users who don't
//   have this pattern" discipline as fetchCalibrationContext.
//
// Evidence: for each qualifying zone, the 1–2 most extreme sessions in the
// HIGH bucket (in the direction that produced the pattern) are retained as
// proof — decision text, date, and the actual confidence numbers — rather
// than asking the user to trust an unsupported claim about their own
// psychology.
//
// Consumers:
//   lib/bias-scorer.ts: fetchUserBiasContext()    — synthesis context block
//   lib/persona-relevance.ts: computePersonaRelevance() — Council weighting
//   app/api/mirror/calibration/route.ts            — Mirror UI (CalibrationSparkline.tsx)
//
// KDD (confirmed): this module never touches lib/rule-engine.ts. Rule
// thresholds stay global and uniform across all users so the admin R7/R8
// calibration-sensitivity tooling — which assumes one threshold per rule
// across the whole corpus — remains valid. Personalisation from this module
// is injected only into LLM context and persona relevance weighting, never
// into the deterministic gate logic.
//
// Non-fatal throughout: any error or insufficient data resolves to [].
// ─────────────────────────────────────────────────────────────────────────────

import { createServiceClient } from '@/lib/supabase'
import { decrypt } from '@/lib/encryption'
import { VECTOR_DIMS, DIM_LABELS, type VectorDimName, type OntologyVector } from '@/lib/structural-retrieval'

const HIGH_THRESHOLD       = 4     // score >= 4 on the 1–5 scale
const LOW_THRESHOLD        = 2     // score <= 2 on the 1–5 scale
const MIN_BUCKET_SIZE      = 3     // each bucket needs >= 3 outcome-logged sessions
const MIN_GAP              = 0.4   // bucket averages must differ by >= 0.4 to count as signal, not noise
const MAX_EVIDENCE_PER_ZONE = 2
const MAX_ZONES_RETURNED    = 3

export interface CalibrationEvidence {
  session_id:               string
  decision_text:            string   // decrypted, sliced to 140 chars
  created_at:                string
  pre_decision_confidence:  number
  retrospective_confidence: number
  calibration_delta:        number
  outcome_quality:          string | null
}

export interface DimensionalCalibrationZone {
  dim:          VectorDimName
  dimLabel:     string
  direction:    'overconfident' | 'underconfident'
  highAvgDelta: number
  lowAvgDelta:  number
  gap:          number
  sampleSize:   { high: number; low: number }
  evidence:     CalibrationEvidence[]
}

interface SessionRow {
  session_id:               string
  decision_text_enc:        string
  created_at:                string
  pre_decision_confidence:  number
  retrospective_confidence: number
  calibration_delta:        number
  outcome_quality:          string | null
  vector:                   OntologyVector
}

// ── computeDimensionalCalibration ─────────────────────────────────────────────
//
// sessionIds: pre-fetched by the caller. fetchUserBiasContext already fetches
// a user's session IDs once and shares them across fetchUserPrinciplesBlock +
// fetchRecurringRegretBlock — this function follows that same convention
// rather than re-querying. app/api/mirror/calibration/route.ts derives its
// own sessionIds from the rows it already fetched for the sparkline.
// ─────────────────────────────────────────────────────────────────────────────
export async function computeDimensionalCalibration(
  sessionIds: string[],
  supabase:   ReturnType<typeof createServiceClient>,
): Promise<DimensionalCalibrationZone[]> {
  if (sessionIds.length < MIN_BUCKET_SIZE * 2) return []

  try {
    const [sessionsResult, ontologyResult] = await Promise.all([
      supabase
        .from('sessions')
        .select(`
          id,
          decision_text,
          created_at,
          pre_decision_confidence,
          status,
          outcomes ( retrospective_confidence, calibration_delta, outcome_quality )
        `)
        .in('id', sessionIds)
        .eq('status', 'completed'),
      supabase
        .from('sessions_ontology')
        .select('session_id, ontology_vector')
        .in('session_id', sessionIds)
        .eq('tagger_version', 'v2.0')
        .not('ontology_vector', 'is', null),
    ])

    const ontologyBySession = new Map<string, OntologyVector>(
      (ontologyResult.data ?? []).map((r: { session_id: string; ontology_vector: unknown }) => [
        r.session_id,
        r.ontology_vector as OntologyVector,
      ]),
    )

    type RawSessionRow = {
      id: string
      decision_text: string
      created_at: string
      pre_decision_confidence: number | null
      outcomes:
        | { retrospective_confidence: number | null; calibration_delta: number | null; outcome_quality: string | null }
        | Array<{ retrospective_confidence: number | null; calibration_delta: number | null; outcome_quality: string | null }>
        | null
    }

    const rows: SessionRow[] = []
    for (const s of (sessionsResult.data ?? []) as RawSessionRow[]) {
      const outcome = Array.isArray(s.outcomes) ? s.outcomes[0] : s.outcomes
      const vector  = ontologyBySession.get(s.id)
      if (!outcome || !vector) continue
      if (s.pre_decision_confidence == null) continue
      if (outcome.retrospective_confidence == null || outcome.calibration_delta == null) continue

      rows.push({
        session_id:               s.id,
        decision_text_enc:        s.decision_text,
        created_at:               s.created_at,
        pre_decision_confidence:  s.pre_decision_confidence,
        retrospective_confidence: outcome.retrospective_confidence,
        calibration_delta:        outcome.calibration_delta,
        outcome_quality:          outcome.outcome_quality,
        vector,
      })
    }

    if (rows.length < MIN_BUCKET_SIZE * 2) return []

    const zones: DimensionalCalibrationZone[] = []

    for (const dim of VECTOR_DIMS) {
      const high: SessionRow[] = []
      const low:  SessionRow[] = []

      for (const row of rows) {
        const d = row.vector[dim]
        if (!d || typeof d.score !== 'number') continue
        if (d.score >= HIGH_THRESHOLD) high.push(row)
        else if (d.score <= LOW_THRESHOLD) low.push(row)
      }

      if (high.length < MIN_BUCKET_SIZE || low.length < MIN_BUCKET_SIZE) continue

      const highAvgDelta = avg(high.map(r => r.calibration_delta))
      const lowAvgDelta  = avg(low.map(r => r.calibration_delta))
      const gap          = highAvgDelta - lowAvgDelta

      if (Math.abs(gap) < MIN_GAP) continue

      // calibration_delta = retro − pre. A more negative delta on the HIGH
      // bucket than the LOW bucket means this user is specifically more
      // overconfident when this dimension is elevated.
      const direction: 'overconfident' | 'underconfident' = gap < 0 ? 'overconfident' : 'underconfident'

      // Evidence: the most extreme examples in the HIGH bucket, in the
      // direction that produced the pattern — proof, not just an assertion.
      const evidenceRows = high
        .slice()
        .sort((a, b) => direction === 'overconfident'
          ? a.calibration_delta - b.calibration_delta    // most negative first
          : b.calibration_delta - a.calibration_delta)    // most positive first
        .slice(0, MAX_EVIDENCE_PER_ZONE)

      const evidence: CalibrationEvidence[] = evidenceRows.map(r => ({
        session_id:               r.session_id,
        decision_text:            (decrypt(r.decision_text_enc) ?? '').slice(0, 140),
        created_at:               r.created_at,
        pre_decision_confidence:  r.pre_decision_confidence,
        retrospective_confidence: r.retrospective_confidence,
        calibration_delta:        r.calibration_delta,
        outcome_quality:          r.outcome_quality,
      }))

      zones.push({
        dim,
        dimLabel:     DIM_LABELS[dim],
        direction,
        highAvgDelta: round1(highAvgDelta),
        lowAvgDelta:  round1(lowAvgDelta),
        gap:          round1(gap),
        sampleSize:   { high: high.length, low: low.length },
        evidence,
      })
    }

    return zones
      .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
      .slice(0, MAX_ZONES_RETURNED)

  } catch (err) {
    console.error('[CalibrationEngine] computeDimensionalCalibration failed:', err)
    return []
  }
}

// ── isZoneActiveForVector ─────────────────────────────────────────────────────
// Checks whether a confirmed personal zone is "live" for a specific decision —
// i.e. the current session's vector is elevated on that same dimension.
// Param is intentionally loosely typed (not OntologyVector) so it accepts both
// lib/structural-retrieval.ts's OntologyVector and lib/bias-scorer.ts's
// OntologyScoreMap without forcing either file to import the other's type.
// ─────────────────────────────────────────────────────────────────────────────
export function isZoneActiveForVector(
  zone:   DimensionalCalibrationZone,
  vector: Record<string, { score?: number } | undefined> | null,
): boolean {
  if (!vector) return false
  const d = vector[zone.dim]
  return !!d && typeof d.score === 'number' && d.score >= HIGH_THRESHOLD
}

function avg(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
