// lib/bias-trigger-engine.ts
// ── Personal Bias Trigger Engine (Phase 1 / Sprint BT) ───────────────────────
//
// bias_library already records, per (user, bias_parameter), which sessions a
// bias fired in (session_ids[]) and the context of each firing
// (activation_contexts, keyed by session_id). What it's never asked is the
// question that actually matters: when this bias fires, does it correlate
// with worse outcomes — and specifically under what structural condition?
// classifyBiasSignal() in lib/bias-scorer.ts answers a related but different
// question ("is this bias structurally distorting in general, per a fixed
// universal rule") — this module asks "for THIS user specifically, what
// condition makes this bias actually cost them," discovered from their own
// outcome history rather than authored once for everyone.
//
// Mechanism (deterministic, no LLM call — same philosophy and same shape as
// lib/calibration-engine.ts):
//   For a given (user, bias), restrict to firing-sessions with a logged
//   outcome (excludes 'too_early' — not yet resolved). Split those sessions
//   into a HIGH bucket (ontology dim score >= 4) and LOW bucket (<= 2) for
//   each of the 14 VECTOR_DIMS, and compare the proportion of
//   'worse_than_expected' outcomes between buckets. A dimension only
//   qualifies as a personal trigger when both buckets clear a minimum sample
//   size AND the bad-outcome-rate gap clears a noise floor.
//
// Deliberately one-directional: a trigger is "the condition that makes this
// bias more dangerous." A dimension that correlates with FEWER bad outcomes
// when elevated isn't an actionable warning, so it's never surfaced even if
// the gap technically clears in that direction.
//
// At most one trigger dimension is kept per bias (the strongest one found),
// and at most MAX_TRIGGERS_RETURNED across all of a user's biases — same
// "don't overwhelm with noise" discipline as lib/calibration-engine.ts.
//
// Consumers:
//   lib/bias-scorer.ts: fetchUserBiasContext()      — synthesis directive
//   lib/mirror-fingerprint.ts: buildFingerprint()    — Mirror UI (BiasFingerprint.tsx)
//
// KDD (confirmed): classifyBiasSignal() in lib/bias-scorer.ts is never
// touched by this module and stays the universal, deterministic classifier
// for every user. This module is additive context only — same boundary
// lib/calibration-engine.ts draws around lib/rule-engine.ts, applied here to
// a different deterministic classifier instead.
//
// Phase 2 (not in this module yet): activation_contexts also carries
// categorical context per firing — decision_type, emotional_signature,
// urgency_present, counterparty_present — which is a second, richer trigger
// signal beyond the 14 continuous ontology dimensions. Deliberately deferred
// until this phase's pattern is proven in production.
//
// Non-fatal throughout: any error or insufficient data resolves to [].
// ─────────────────────────────────────────────────────────────────────────────

import { createServiceClient } from '@/lib/supabase'
import { decrypt } from '@/lib/encryption'
import { VECTOR_DIMS, DIM_LABELS, type VectorDimName, type OntologyVector } from '@/lib/structural-retrieval'
import { BIAS_PARAMETERS, type BiasParameterKey } from '@/lib/bias-scorer'

const HIGH_THRESHOLD            = 4     // score >= 4 on the 1–5 scale
const LOW_THRESHOLD             = 2     // score <= 2 on the 1–5 scale
const MIN_BUCKET_SIZE            = 3     // each bucket needs >= 3 outcome-logged firings
const MIN_GAP                    = 0.4   // bad-outcome-rate gap (0–1 scale) to count as signal, not noise
const MAX_EVIDENCE_PER_TRIGGER   = 2
const MAX_TRIGGERS_RETURNED      = 3

export interface BiasTriggerEvidence {
  session_id:       string
  decision_text:    string   // decrypted, sliced to 140 chars
  created_at:        string
  outcome_quality:  string   // always 'worse_than_expected' for this evidence set — see selection below
}

export interface PersonalBiasTrigger {
  biasKey:          BiasParameterKey
  biasLabel:        string
  triggerDim:       VectorDimName
  triggerDimLabel:  string
  badRateHigh:      number   // 0–1, proportion of HIGH-bucket firings that went worse than expected
  badRateLow:       number   // 0–1, same for LOW-bucket
  gap:              number
  sampleSize:       { high: number; low: number }
  evidence:         BiasTriggerEvidence[]
}

interface FiringRow {
  session_id:         string
  decision_text_enc:  string
  created_at:          string
  outcome_quality:    string
  isBad:              boolean
  vector:             OntologyVector
}

function getBiasLabel(key: string): string {
  // Local lookup rather than importing from lib/mirror-fingerprint.ts — that
  // file imports this module for buildFingerprint(), so importing back from
  // it here would create a circular dependency.
  const found = BIAS_PARAMETERS.find(b => b.key === key)
  return found?.label ?? key.replace(/_/g, ' ')
}

// ── computePersonalBiasTriggers ───────────────────────────────────────────────
export async function computePersonalBiasTriggers(
  userId:   string,
  supabase: ReturnType<typeof createServiceClient>,
): Promise<PersonalBiasTrigger[]> {
  if (!userId) return []

  try {
    const { data: biasRows } = await supabase
      .from('bias_library')
      .select('bias_parameter, session_ids')
      .eq('user_id', userId)

    if (!biasRows || biasRows.length === 0) return []

    const allTriggers: PersonalBiasTrigger[] = []

    for (const biasRow of biasRows as Array<{ bias_parameter: string; session_ids: string[] | null }>) {
      const biasKey    = biasRow.bias_parameter as BiasParameterKey
      const sessionIds = biasRow.session_ids ?? []
      if (sessionIds.length < MIN_BUCKET_SIZE * 2) continue

      const [sessionsResult, ontologyResult] = await Promise.all([
        supabase
          .from('sessions')
          .select(`
            id, decision_text, created_at, status,
            outcomes ( outcome_quality )
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
        outcomes:
          | { outcome_quality: string | null }
          | Array<{ outcome_quality: string | null }>
          | null
      }

      const rows: FiringRow[] = []
      for (const s of (sessionsResult.data ?? []) as RawSessionRow[]) {
        const outcome = Array.isArray(s.outcomes) ? s.outcomes[0] : s.outcomes
        const vector  = ontologyBySession.get(s.id)
        if (!outcome?.outcome_quality || !vector) continue
        if (outcome.outcome_quality === 'too_early') continue

        rows.push({
          session_id:        s.id,
          decision_text_enc: s.decision_text,
          created_at:         s.created_at,
          outcome_quality:    outcome.outcome_quality,
          isBad:              outcome.outcome_quality === 'worse_than_expected',
          vector,
        })
      }

      if (rows.length < MIN_BUCKET_SIZE * 2) continue

      let bestTrigger: PersonalBiasTrigger | null = null

      for (const dim of VECTOR_DIMS) {
        const high: FiringRow[] = []
        const low:  FiringRow[] = []

        for (const row of rows) {
          const d = row.vector[dim]
          if (!d || typeof d.score !== 'number') continue
          if (d.score >= HIGH_THRESHOLD) high.push(row)
          else if (d.score <= LOW_THRESHOLD) low.push(row)
        }

        if (high.length < MIN_BUCKET_SIZE || low.length < MIN_BUCKET_SIZE) continue

        const badRateHigh = high.filter(r => r.isBad).length / high.length
        const badRateLow  = low.filter(r => r.isBad).length / low.length
        const gap          = badRateHigh - badRateLow

        // One-directional — see header note. A dimension correlating with
        // FEWER bad outcomes when elevated is not a trigger to warn about.
        if (gap < MIN_GAP) continue
        if (bestTrigger && gap <= bestTrigger.gap) continue

        const evidenceRows = high
          .filter(r => r.isBad)
          .slice()
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))  // most recent first
          .slice(0, MAX_EVIDENCE_PER_TRIGGER)

        const evidence: BiasTriggerEvidence[] = evidenceRows.map(r => ({
          session_id:       r.session_id,
          decision_text:    (decrypt(r.decision_text_enc) ?? '').slice(0, 140),
          created_at:        r.created_at,
          outcome_quality:  r.outcome_quality,
        }))

        bestTrigger = {
          biasKey,
          biasLabel:       getBiasLabel(biasKey),
          triggerDim:      dim,
          triggerDimLabel: DIM_LABELS[dim],
          badRateHigh:     round2(badRateHigh),
          badRateLow:      round2(badRateLow),
          gap:             round2(gap),
          sampleSize:      { high: high.length, low: low.length },
          evidence,
        }
      }

      if (bestTrigger) allTriggers.push(bestTrigger)
    }

    return allTriggers
      .sort((a, b) => b.gap - a.gap)
      .slice(0, MAX_TRIGGERS_RETURNED)

  } catch (err) {
    console.error('[BiasTriggerEngine] computePersonalBiasTriggers failed:', err)
    return []
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
