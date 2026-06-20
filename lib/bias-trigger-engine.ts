// lib/bias-trigger-engine.ts
// ── Personal Bias Trigger Engine (Phase 1 + 2a + 2b — Sprint BT) ─────────────
//
// bias_library records, per (user, bias_parameter), which sessions a bias
// fired in (session_ids[]) and the context of each firing (activation_contexts,
// keyed by session_id). What it's never asked is the question that actually
// matters: when this bias fires, does it correlate with worse outcomes — and
// specifically under what condition? classifyBiasSignal() in lib/bias-scorer.ts
// answers a related but different question ("is this bias structurally
// distorting in general, per a fixed universal rule") — this module asks
// "for THIS user specifically, what condition makes this bias actually cost
// them," discovered from their own outcome history rather than authored once
// for everyone.
//
// Four trigger types, found independently per bias — up to one of EACH may
// be kept per bias (best-of-each, not best-of-all). A bias can genuinely have
// several unrelated trigger conditions (e.g. FOMO under time pressure, AND
// separately FOMO on acquisition-type decisions); collapsing to one slot
// would silently drop a real finding. MAX_TRIGGERS_RETURNED caps the combined
// list across ALL of a user's biases and trigger types — the global cap does
// the real limiting, not a per-bias ceiling (confirmed).
//
//   DIMENSION triggers (Phase 1) — one of the 14 continuous ontology
//   dimensions. Firing sessions with a logged outcome are split into a HIGH
//   bucket (dim score >= 4) and LOW bucket (<= 2), bad-outcome rate compared.
//
//   FLAG triggers (Phase 2a) — one of two boolean activation-context fields
//   (urgency_present, counterparty_present). Same mechanism, split on
//   true/false instead of score thresholds.
//
//   CATEGORY triggers (Phase 2b) — one of two canonical categorical fields
//   already on sessions_ontology: decision_type_primary (commitment |
//   allocation | transition | acquisition | renunciation | governance |
//   delegation) and dominant_emotion (anxiety | excitement | obligation |
//   ambivalence | urgency | resignation). One-vs-rest bucketing: for each
//   candidate value, HIGH = firing sessions where the field equals that
//   value, LOW = all other firing sessions pooled. Best-fitting single value
//   kept per field per bias (so up to 2 category triggers per bias — one for
//   decision_type_primary, one for dominant_emotion — counted as 2 of the 4
//   total independent slots).
//
//   Originally bias-score's activation_context ALSO emits a free-text
//   decision_type/emotional_signature per firing — but those are loose,
//   LLM-generated strings with no fixed taxonomy (the bias-score prompt's own
//   examples, e.g. "financial_allocation", don't even match the ontology
//   tagger's real enum values like "allocation"). Bucketing on that drifting
//   free text would either fragment into buckets too small to ever clear
//   MIN_BUCKET_SIZE, or require its own normalization layer mapping noisy
//   strings into a taxonomy that already exists one table over. Category
//   triggers therefore bucket against sessions_ontology's decision_type_primary
//   / dominant_emotion — the canonical, already-structured fields — not
//   bias-score's free-text echo of the same concepts.
//
// All four trigger types use the same gates (MIN_BUCKET_SIZE per bucket,
// MIN_GAP on the bad-outcome-rate difference) and the same one-directional
// rule: a trigger is "the condition that makes this bias more dangerous,"
// never the reverse.
//
// ── Synthesis eligibility ────────────────────────────────────────────────────
// DIMENSION and CATEGORY triggers are synthesis-eligible: both check against
// fields (ontology_vector, decision_type_primary, dominant_emotion) that all
// live on sessions_ontology, written by the SAME early tagger call, well
// before synthesis runs for that decision — no ordering risk.
//
// FLAG triggers are NOT synthesis-eligible, and this is a deliberate,
// confirmed product decision, not an oversight: urgency_present /
// counterparty_present come from the bias scorer's activation_context, which
// is written by fireBiasScore() in app/api/examiner/route.ts as a
// fire-and-forget background call — there is no guaranteed ordering between
// that completing and synthesis running for the SAME decision. Gating a
// "MANDATORY" synthesis directive on a value that may not have landed yet
// risks an intermittent, silent miss. Flag triggers therefore surface only in
// the Mirror UI (always reading fully-settled historical data, no race).
//
// See isSynthesisEligibleTrigger() below — the single source of truth for
// this split, used by lib/bias-scorer.ts at the synthesis call site.
//
// Consumers:
//   lib/bias-scorer.ts: fetchUserBiasContext()      — synthesis directive (dimension + category triggers only)
//   lib/mirror-fingerprint.ts: buildFingerprint()    — Mirror UI, ALL types (BiasFingerprint.tsx)
//
// KDD (confirmed, unchanged since Phase 1): classifyBiasSignal() in
// lib/bias-scorer.ts and lib/rule-engine.ts are never touched by this module.
// Additive context only.
//
// Non-fatal throughout: any error or insufficient data resolves to [].
// ─────────────────────────────────────────────────────────────────────────────

import { createServiceClient } from '@/lib/supabase'
import { decrypt } from '@/lib/encryption'
import { VECTOR_DIMS, DIM_LABELS, type VectorDimName, type OntologyVector } from '@/lib/structural-retrieval'
import { BIAS_PARAMETERS, type BiasParameterKey } from '@/lib/bias-scorer'
import { CATEGORY_VALUE_LABELS } from '@/lib/calibration-copy'

const HIGH_THRESHOLD            = 4     // score >= 4 on the 1–5 scale (dimension triggers)
const LOW_THRESHOLD             = 2     // score <= 2 on the 1–5 scale (dimension triggers)
const MIN_BUCKET_SIZE            = 3     // each bucket needs >= 3 outcome-logged firings — all trigger types
const MIN_GAP                    = 0.4   // bad-outcome-rate gap (0–1 scale) to count as signal — all trigger types
const MAX_EVIDENCE_PER_TRIGGER   = 2
const MAX_TRIGGERS_RETURNED      = 4    // global cap across ALL biases and ALL trigger types (confirmed)

export type BooleanFlagKey = 'urgency_present' | 'counterparty_present'

export const FLAG_LABELS: Record<BooleanFlagKey, string> = {
  urgency_present:      'time pressure is present',
  counterparty_present: 'another party is directly involved',
}

// Phase 2b — canonical categorical fields, sourced from sessions_ontology
// (NOT bias-score's free-text activation_context — see header note).
export type CategoryField = 'decision_type_primary' | 'dominant_emotion'

export const DECISION_TYPE_VALUES = [
  'commitment', 'allocation', 'transition', 'acquisition',
  'renunciation', 'governance', 'delegation',
] as const
export type DecisionTypeValue = typeof DECISION_TYPE_VALUES[number]

export const DOMINANT_EMOTION_VALUES = [
  'anxiety', 'excitement', 'obligation',
  'ambivalence', 'urgency', 'resignation',
] as const
export type DominantEmotionValue = typeof DOMINANT_EMOTION_VALUES[number]

// Moved to lib/calibration-copy.ts — that file is client-safe (no path to
// lib/ai-client.ts), this one isn't. Importing it back here is safe (a
// server file importing a client-safe file has no risk), just not exported
// from here anymore — see CATEGORY_VALUE_LABELS in calibration-copy.ts.

const CATEGORY_FIELD_LABELS: Record<CategoryField, string> = {
  decision_type_primary: 'decision type',
  dominant_emotion:      'dominant emotion',
}

export interface BiasTriggerEvidence {
  session_id:       string
  decision_text:    string   // decrypted, sliced to 140 chars
  created_at:        string
  outcome_quality:  string   // always 'worse_than_expected' for this evidence set — see selection below
}

interface BaseTrigger {
  biasKey:          BiasParameterKey
  biasLabel:        string
  badRateHigh:      number   // 0–1, proportion of HIGH-bucket firings that went worse than expected
  badRateLow:       number   // 0–1, same for LOW-bucket
  gap:              number
  sampleSize:       { high: number; low: number }
  evidence:         BiasTriggerEvidence[]
}

export interface DimensionTrigger extends BaseTrigger {
  triggerType:      'dimension'
  triggerDim:       VectorDimName
  triggerDimLabel:  string
}

export interface FlagTrigger extends BaseTrigger {
  triggerType:      'flag'
  triggerFlag:      BooleanFlagKey
  triggerFlagLabel: string
}

export interface CategoryTrigger extends BaseTrigger {
  triggerType:        'category'
  categoryField:      CategoryField
  categoryFieldLabel: string
  categoryValue:      string
  categoryValueLabel: string
}

export type PersonalBiasTrigger = DimensionTrigger | FlagTrigger | CategoryTrigger

// Used by lib/bias-scorer.ts to filter to dimension triggers only — kept for
// any call site that specifically wants just this one type.
export function isDimensionTrigger(t: PersonalBiasTrigger): t is DimensionTrigger {
  return t.triggerType === 'dimension'
}

// Single source of truth for the synthesis-eligibility split (see header note).
// DIMENSION + CATEGORY triggers check fields with no ordering risk relative to
// synthesis. FLAG triggers are deliberately excluded — Mirror-UI-only.
export function isSynthesisEligibleTrigger(
  t: PersonalBiasTrigger,
): t is DimensionTrigger | CategoryTrigger {
  return t.triggerType === 'dimension' || t.triggerType === 'category'
}

interface FiringRow {
  session_id:           string
  decision_text_enc:    string
  created_at:            string
  outcome_quality:      string
  isBad:                boolean
  vector:               OntologyVector
  urgencyPresent?:      boolean
  counterpartyPresent?: boolean
  decisionTypePrimary?: string
  dominantEmotion?:     string
}

function getBiasLabel(key: string): string {
  // Local lookup rather than importing from lib/mirror-fingerprint.ts — that
  // file imports this module for buildFingerprint(), so importing back from
  // it here would create a circular dependency.
  const found = BIAS_PARAMETERS.find(b => b.key === key)
  return found?.label ?? key.replace(/_/g, ' ')
}

function buildEvidence(rows: FiringRow[]): BiasTriggerEvidence[] {
  return rows
    .filter(r => r.isBad)
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))  // most recent first
    .slice(0, MAX_EVIDENCE_PER_TRIGGER)
    .map(r => ({
      session_id:      r.session_id,
      decision_text:   (decrypt(r.decision_text_enc) ?? '').slice(0, 140),
      created_at:       r.created_at,
      outcome_quality: r.outcome_quality,
    }))
}

function findBestDimensionTrigger(
  rows:     FiringRow[],
  biasKey:  BiasParameterKey,
  biasLabel: string,
): DimensionTrigger | null {
  let best: DimensionTrigger | null = null

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

    // One-directional — see header note. A dimension correlating with FEWER
    // bad outcomes when elevated is not a trigger to warn about.
    if (gap < MIN_GAP) continue
    if (best && gap <= best.gap) continue

    best = {
      biasKey,
      biasLabel,
      triggerType:     'dimension',
      triggerDim:      dim,
      triggerDimLabel: DIM_LABELS[dim],
      badRateHigh:     round2(badRateHigh),
      badRateLow:      round2(badRateLow),
      gap:             round2(gap),
      sampleSize:      { high: high.length, low: low.length },
      evidence:        buildEvidence(high),
    }
  }

  return best
}

function findBestFlagTrigger(
  rows:     FiringRow[],
  biasKey:  BiasParameterKey,
  biasLabel: string,
): FlagTrigger | null {
  let best: FlagTrigger | null = null

  const flagKeys: BooleanFlagKey[] = ['urgency_present', 'counterparty_present']

  for (const flag of flagKeys) {
    const high: FiringRow[] = []  // flag === true
    const low:  FiringRow[] = []  // flag === false

    for (const row of rows) {
      const v = flag === 'urgency_present' ? row.urgencyPresent : row.counterpartyPresent
      if (typeof v !== 'boolean') continue  // pre-Sprint-20 sessions may lack this field
      if (v) high.push(row)
      else low.push(row)
    }

    if (high.length < MIN_BUCKET_SIZE || low.length < MIN_BUCKET_SIZE) continue

    const badRateHigh = high.filter(r => r.isBad).length / high.length
    const badRateLow  = low.filter(r => r.isBad).length / low.length
    const gap          = badRateHigh - badRateLow

    if (gap < MIN_GAP) continue
    if (best && gap <= best.gap) continue

    best = {
      biasKey,
      biasLabel,
      triggerType:      'flag',
      triggerFlag:      flag,
      triggerFlagLabel: FLAG_LABELS[flag],
      badRateHigh:      round2(badRateHigh),
      badRateLow:       round2(badRateLow),
      gap:              round2(gap),
      sampleSize:       { high: high.length, low: low.length },
      evidence:         buildEvidence(high),
    }
  }

  return best
}

// Phase 2b — one-vs-rest bucketing over a categorical field's candidate
// values. For each candidate value: HIGH = firing sessions where the field
// equals that value, LOW = ALL OTHER firing sessions pooled (not split
// pairwise per other value — pooling keeps bucket sizes viable given how few
// outcome-logged firings most users will have for a while).
function findBestCategoryTrigger(
  rows:            FiringRow[],
  field:           CategoryField,
  candidateValues: readonly string[],
  biasKey:         BiasParameterKey,
  biasLabel:       string,
): CategoryTrigger | null {
  let best: CategoryTrigger | null = null

  for (const value of candidateValues) {
    const high: FiringRow[] = []  // field === value
    const low:  FiringRow[] = []  // field === any other candidate value

    for (const row of rows) {
      const v = field === 'decision_type_primary' ? row.decisionTypePrimary : row.dominantEmotion
      if (!v) continue  // missing/null — excluded from both buckets, not counted as "other"
      if (v === value) high.push(row)
      else low.push(row)
    }

    if (high.length < MIN_BUCKET_SIZE || low.length < MIN_BUCKET_SIZE) continue

    const badRateHigh = high.filter(r => r.isBad).length / high.length
    const badRateLow  = low.filter(r => r.isBad).length / low.length
    const gap          = badRateHigh - badRateLow

    if (gap < MIN_GAP) continue
    if (best && gap <= best.gap) continue

    best = {
      biasKey,
      biasLabel,
      triggerType:        'category',
      categoryField:      field,
      categoryFieldLabel: CATEGORY_FIELD_LABELS[field],
      categoryValue:      value,
      categoryValueLabel: CATEGORY_VALUE_LABELS[field][value] ?? value,
      badRateHigh:        round2(badRateHigh),
      badRateLow:         round2(badRateLow),
      gap:                round2(gap),
      sampleSize:         { high: high.length, low: low.length },
      evidence:           buildEvidence(high),
    }
  }

  return best
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
      .select('bias_parameter, session_ids, activation_contexts')
      .eq('user_id', userId)

    if (!biasRows || biasRows.length === 0) return []

    const allTriggers: PersonalBiasTrigger[] = []

    for (const biasRow of biasRows as Array<{
      bias_parameter: string
      session_ids: string[] | null
      activation_contexts: Record<string, { urgency_present?: boolean; counterparty_present?: boolean }> | null
    }>) {
      const biasKey    = biasRow.bias_parameter as BiasParameterKey
      const biasLabel  = getBiasLabel(biasKey)
      const sessionIds = biasRow.session_ids ?? []
      const contexts   = biasRow.activation_contexts ?? {}
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
          // Phase 2b: +decision_type_primary, +dominant_emotion — the
          // canonical categorical fields category triggers bucket against.
          .select('session_id, ontology_vector, decision_type_primary, dominant_emotion')
          .in('session_id', sessionIds)
          .eq('tagger_version', 'v2.0')
          .not('ontology_vector', 'is', null),
      ])

      type OntologyRow = {
        session_id: string
        ontology_vector: unknown
        decision_type_primary: string | null
        dominant_emotion: string | null
      }
      const ontologyBySession = new Map<string, OntologyRow>(
        (ontologyResult.data ?? []).map((r: OntologyRow) => [r.session_id, r]),
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
        const ont     = ontologyBySession.get(s.id)
        if (!outcome?.outcome_quality || !ont?.ontology_vector) continue
        if (outcome.outcome_quality === 'too_early') continue

        const ctx = contexts[s.id]

        rows.push({
          session_id:           s.id,
          decision_text_enc:    s.decision_text,
          created_at:            s.created_at,
          outcome_quality:      outcome.outcome_quality,
          isBad:                outcome.outcome_quality === 'worse_than_expected',
          vector:               ont.ontology_vector as OntologyVector,
          urgencyPresent:       ctx?.urgency_present,
          counterpartyPresent:  ctx?.counterparty_present,
          decisionTypePrimary:  ont.decision_type_primary ?? undefined,
          dominantEmotion:      ont.dominant_emotion ?? undefined,
        })
      }

      if (rows.length < MIN_BUCKET_SIZE * 2) continue

      // Independent best-of-each across all 4 trigger types — any/all may
      // qualify for the same bias. Global MAX_TRIGGERS_RETURNED cap below
      // does the real limiting, not a per-bias ceiling (confirmed).
      const dimTrigger          = findBestDimensionTrigger(rows, biasKey, biasLabel)
      const flagTrigger         = findBestFlagTrigger(rows, biasKey, biasLabel)
      const decisionTypeTrigger = findBestCategoryTrigger(rows, 'decision_type_primary', DECISION_TYPE_VALUES, biasKey, biasLabel)
      const emotionTrigger      = findBestCategoryTrigger(rows, 'dominant_emotion', DOMINANT_EMOTION_VALUES, biasKey, biasLabel)

      if (dimTrigger)          allTriggers.push(dimTrigger)
      if (flagTrigger)         allTriggers.push(flagTrigger)
      if (decisionTypeTrigger) allTriggers.push(decisionTypeTrigger)
      if (emotionTrigger)      allTriggers.push(emotionTrigger)
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
