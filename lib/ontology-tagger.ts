/**
 * QUORUM — Decision Ontology Tagger v2.0
 * Sprint 11a — Full 14-dimensional scored vector
 *
 * WHAT CHANGED FROM v1.0:
 *   - Outputs `scored_vector` (14 dimensions, each with score 1-5,
 *     confidence 0-1, rationale string) in addition to all existing
 *     categorical fields (backward-compatible — no existing columns removed).
 *   - scored_vector stored as `ontology_vector` JSONB in sessions_ontology.
 *   - tagger_version bumped to 'v2.0' for sessions tagged with this prompt.
 *   - All existing columns still populated identically to v1.0.
 *
 * WHAT STAYS IDENTICAL TO v1.0:
 *   - Provider abstraction (AI_PROVIDER env var)
 *   - All 9 existing categorical dimension fields
 *   - examiner_gap_1/2/3 fields
 *   - DB write logic (additive only)
 */

import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

const PROVIDER        = (process.env.AI_PROVIDER ?? 'anthropic').toLowerCase()
const ANTHROPIC_MODEL = process.env.AI_MODEL ?? 'claude-sonnet-4-20250514'
const DEEPSEEK_MODEL  = process.env.AI_MODEL ?? 'deepseek-chat'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })
const deepseek  = new OpenAI({
  apiKey:  process.env.DEEPSEEK_API_KEY ?? '',
  baseURL: 'https://api.deepseek.com',
})

// ── Dimension score type ───────────────────────────────────────────────────────

export interface DimensionScore {
  score:      1 | 2 | 3 | 4 | 5   // 1 = low, 5 = high (see scale per dimension)
  confidence: number               // 0.0 – 1.0
  rationale:  string               // 1–2 sentences explaining the score
}

// ── 14-dimensional scored vector ──────────────────────────────────────────────

export interface ScoredVector {
  // ── Phase 1 (highest leverage + novel) ──────────────────────
  reversibility:                DimensionScore  // 1=fully reversible → 5=irreversible
  time_horizon:                 DimensionScore  // 1=days/weeks → 5=generational (10yr+)
  stakes_magnitude:             DimensionScore  // 1=minor → 5=life-defining
  outcome_uncertainty:          DimensionScore  // 1=predictable → 5=highly uncertain
  value_conflict:               DimensionScore  // 1=no conflict → 5=irreconcilable conflict
  identity_alignment:           DimensionScore  // 1=purely instrumental → 5=deeply constitutive
  regret_asymmetry:             DimensionScore  // 1=symmetric errors → 5=one error far worse
  upstream_dependency:          DimensionScore  // 1=no prior dependency → 5=blocked by prior unresolved decision

  // ── Phase 2 (established dimensions) ────────────────────────
  ambiguity:                    DimensionScore  // 1=question is clear → 5=question itself is unclear
  task_complexity:              DimensionScore  // 1=simple → 5=many interdependencies
  decision_discriminating_info: DimensionScore  // 1=no info would change this → 5=specific info would change everything
  time_pressure:                DimensionScore  // 1=no real deadline → 5=hard external deadline imminent
  decision_unit:                DimensionScore  // 1=self only → 5=large group (family/org/third parties)
  emotional_intensity:          DimensionScore  // 1=calm/analytical → 5=highly emotionally charged

  vector_version: 'v2.0'
}

// ── Existing categorical tag (v1.0, kept for backward compat) ─────────────────

export type DecisionType =
  | 'commitment' | 'allocation' | 'transition'
  | 'acquisition' | 'renunciation' | 'governance' | 'delegation'

export interface OntologyTag {
  // Dimension 1
  decision_type_primary:    DecisionType
  decision_type_secondary:  DecisionType[]
  // Dimension 2
  stakes_reversibility:     'full' | 'partial' | 'irreversible'
  stakes_bearer:            'self' | 'family' | 'organisation' | 'third-parties'
  stakes_timeline:          'immediate' | '1-3yr' | '5yr+' | 'generational'
  // Dimension 3
  has_stated_deadline:      boolean
  deadline_source:          'self' | 'counterparty' | 'external' | 'none'
  deadline_credibility:     'high' | 'medium' | 'low' | 'none'
  // Dimension 4
  known_unknowns_surfaced:        boolean
  unknown_unknown_categories:     string[]
  // Dimension 5
  counterparty_present:     boolean
  counterparty_alignment:   'aligned' | 'partial' | 'misaligned' | 'unknown'
  info_asymmetry:           'favor_dm' | 'equal' | 'favor_counterparty' | 'unknown'
  relationship_type:        'transactional' | 'relational' | 'fiduciary' | 'adversarial'
  // Dimension 6
  dominant_emotion:         'anxiety' | 'excitement' | 'obligation' | 'ambivalence' | 'urgency' | 'resignation'
  emotion_source:           'self' | 'external'
  emotion_analysis_aligned: boolean
  // Dimension 7
  stakeholder_count:                  '1' | '2-3' | '4+'
  hidden_stakeholder_probability:     'low' | 'medium' | 'high'
  // Dimension 8
  instrumental_weight:      number    // 0.0 – 1.0
  constitutive_weight:      number    // 0.0 – 1.0
  // Dimension 9 (examiner gaps)
  examiner_gap_1:           string
  examiner_gap_2:           string
  examiner_gap_3:           string

  // ── NEW in v2.0 ──────────────────────────────────────────────
  scored_vector:            ScoredVector
}

// ── Tagger system prompt ───────────────────────────────────────────────────────

const TAGGER_SYSTEM = `You are an expert decision ontology classifier for Quorum, a private decision intelligence system.

Classify the decision across ALL sections below. Return ONLY valid JSON — no explanation, no markdown, no preamble.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART A — CATEGORICAL CLASSIFICATION (existing fields, unchanged)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DIMENSION 1 — DECISION TYPE
Primary type (one only): commitment | allocation | transition | acquisition | renunciation | governance | delegation
- commitment: binding relationship/agreement with external party
- allocation: distributing a resource between uses (no binding external party)
- transition: person's own identity/role/location changes
- acquisition: obtaining a specific new asset or company
- renunciation: giving up or exiting something currently held
- governance: deciding authority structure in a shared system
- delegation: handing an ongoing process to another to manage
Secondary types: 0–2 additional types that also apply.

DIMENSION 2 — STAKES
stakes_reversibility: "full" (can be undone), "partial" (costly to undo), "irreversible"
stakes_bearer: "self" | "family" | "organisation" | "third-parties" (primary bearer)
stakes_timeline: "immediate" | "1-3yr" | "5yr+" | "generational"

DIMENSION 3 — TIME PRESSURE
has_stated_deadline: true/false
deadline_source: "self" | "counterparty" | "external" | "none"
deadline_credibility: "high" | "medium" | "low" | "none"

DIMENSION 4 — INFORMATION
known_unknowns_surfaced: true if decision-maker has explicitly named what they don't know
unknown_unknown_categories: array of 0–3 values from: "counterparty_health" | "regulatory" | "market" | "family" | "execution" | "succession"

DIMENSION 5 — COUNTERPARTY
counterparty_present: true if another party's response materially affects the outcome
counterparty_alignment: "aligned" | "partial" | "misaligned" | "unknown"
info_asymmetry: "favor_dm" | "equal" | "favor_counterparty" | "unknown"
relationship_type: "transactional" | "relational" | "fiduciary" | "adversarial"

DIMENSION 6 — EMOTIONAL SIGNATURE
dominant_emotion: "anxiety" | "excitement" | "obligation" | "ambivalence" | "urgency" | "resignation"
emotion_source: "self" (internal) | "external" (social/family/market pressure)
emotion_analysis_aligned: true if emotion is congruent with the analytical stakes; false if disproportionate

DIMENSION 7 — STAKEHOLDER COMPLEXITY
stakeholder_count: "1" | "2-3" | "4+"
hidden_stakeholder_probability: "low" | "medium" | "high"

DIMENSION 8 — DECISION REGISTER
instrumental_weight: 0.0–1.0 (how much this is a means-to-an-end decision)
constitutive_weight: 0.0–1.0 (how much this is about who the person is/becomes)
Note: instrumental_weight + constitutive_weight = 1.0

DIMENSION 9 — EXAMINER PRIORITY GAPS
The 3 most critical unknown unknowns — things the decision-maker has NOT addressed that most affect the decision outcome.
examiner_gap_1, examiner_gap_2, examiner_gap_3: each is a terse phrase (5–10 words) naming the gap. Not questions — gap descriptions.
Example: "Exit conditions and personal liquidity not examined"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART B — 14-DIMENSIONAL SCORED VECTOR (new in v2.0)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For each dimension below, output a score (1–5), confidence (0.0–1.0), and rationale (1–2 sentences).
Score 1 = low end of the scale, score 5 = high end. Use the scale descriptions strictly.

SCORING GUIDE:

reversibility
  1 = decision is easily reversed with minimal cost (try → undo)
  3 = reversal is possible but costly or time-consuming
  5 = decision is essentially irreversible once made

time_horizon
  1 = impact is immediate to weeks
  3 = impact plays out over 1–3 years
  5 = impact spans a decade or is generational

stakes_magnitude
  1 = minor consequence; life is largely unaffected either way
  3 = significant but bounded consequence
  5 = life-defining; material, relational, or identity consequences at the highest level

outcome_uncertainty
  1 = outcome is largely predictable given available information
  3 = meaningful uncertainty; could go either way
  5 = outcome is highly uncertain; multiple plausible very different futures

value_conflict
  1 = no value conflict; decision is consistent with all the person's values
  3 = some tension between competing values
  5 = irreconcilable conflict; proceeding requires betraying one core value

identity_alignment
  1 = purely instrumental; this decision is about means, not about who the person is
  3 = some identity stakes; outcome will moderately affect how person sees themselves
  5 = deeply constitutive; this decision is about who the person fundamentally is or becomes

regret_asymmetry
  1 = symmetric; not acting and acting carry roughly equal regret risk
  3 = moderate asymmetry; one error is somewhat worse
  5 = highly asymmetric; one error (acting or not acting) would be vastly harder to live with

upstream_dependency
  1 = this decision stands alone; no prior unresolved question blocks it
  3 = some upstream ambiguity exists but is not blocking
  5 = a prior decision is unresolved and directly determines the answer to this one; working on this now produces an answer that won't hold

ambiguity
  1 = the question being decided is clear and well-formed
  3 = some ambiguity in what exactly is being decided
  5 = the question itself is unclear; the decision-maker may be solving the wrong problem

task_complexity
  1 = simple decision; few variables, clear trade-offs
  3 = moderate complexity; several interdependencies
  5 = extremely complex; many parties, variables, and second-order effects

decision_discriminating_info
  1 = no additional information would change this decision
  3 = some information would be useful but not decisive
  5 = specific obtainable information would completely change what to do; acting now may be premature

time_pressure
  1 = no real deadline; decision can wait without cost
  3 = some time pressure; delay has moderate cost
  5 = hard external deadline is imminent; delay closes options permanently

decision_unit
  1 = affects the decision-maker alone
  3 = affects 2–3 people who must live with the consequence
  5 = affects a large group (family system, organisation, or third parties at scale)

emotional_intensity
  1 = decision-maker is calm and primarily analytical
  3 = noticeable emotional engagement; not overwhelming
  5 = decision is highly emotionally charged; emotion is the dominant register

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT — COMPLETE JSON STRUCTURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return exactly this structure:
{
  "decision_type_primary": "...",
  "decision_type_secondary": [],
  "stakes_reversibility": "...",
  "stakes_bearer": "...",
  "stakes_timeline": "...",
  "has_stated_deadline": false,
  "deadline_source": "...",
  "deadline_credibility": "...",
  "known_unknowns_surfaced": false,
  "unknown_unknown_categories": [],
  "counterparty_present": false,
  "counterparty_alignment": "...",
  "info_asymmetry": "...",
  "relationship_type": "...",
  "dominant_emotion": "...",
  "emotion_source": "...",
  "emotion_analysis_aligned": true,
  "stakeholder_count": "...",
  "hidden_stakeholder_probability": "...",
  "instrumental_weight": 0.5,
  "constitutive_weight": 0.5,
  "examiner_gap_1": "...",
  "examiner_gap_2": "...",
  "examiner_gap_3": "...",
  "scored_vector": {
    "reversibility":                { "score": 3, "confidence": 0.85, "rationale": "..." },
    "time_horizon":                 { "score": 3, "confidence": 0.90, "rationale": "..." },
    "stakes_magnitude":             { "score": 3, "confidence": 0.80, "rationale": "..." },
    "outcome_uncertainty":          { "score": 3, "confidence": 0.85, "rationale": "..." },
    "value_conflict":               { "score": 2, "confidence": 0.90, "rationale": "..." },
    "identity_alignment":           { "score": 3, "confidence": 0.85, "rationale": "..." },
    "regret_asymmetry":             { "score": 2, "confidence": 0.80, "rationale": "..." },
    "upstream_dependency":          { "score": 1, "confidence": 0.90, "rationale": "..." },
    "ambiguity":                    { "score": 2, "confidence": 0.85, "rationale": "..." },
    "task_complexity":              { "score": 3, "confidence": 0.80, "rationale": "..." },
    "decision_discriminating_info": { "score": 2, "confidence": 0.75, "rationale": "..." },
    "time_pressure":                { "score": 2, "confidence": 0.85, "rationale": "..." },
    "decision_unit":                { "score": 1, "confidence": 0.90, "rationale": "..." },
    "emotional_intensity":          { "score": 3, "confidence": 0.80, "rationale": "..." },
    "vector_version": "v2.0"
  }
}`

// ── AI call ────────────────────────────────────────────────────────────────────

async function callTagger(decisionText: string, contextText: string | null): Promise<string> {
  const userMsg = contextText
    ? `Decision: ${decisionText}\n\nAdditional context: ${contextText}`
    : `Decision: ${decisionText}`

  if (PROVIDER === 'deepseek') {
    const res = await deepseek.chat.completions.create({
      model:       DEEPSEEK_MODEL,
      max_tokens:  2000,
      temperature: 0.1,
      messages: [
        { role: 'system', content: TAGGER_SYSTEM },
        { role: 'user',   content: userMsg },
      ],
    })
    return res.choices[0]?.message?.content ?? ''
  } else {
    const res = await anthropic.messages.create({
      model:      ANTHROPIC_MODEL,
      max_tokens: 2000,
      system:     TAGGER_SYSTEM,
      messages:   [{ role: 'user', content: userMsg }],
    })
    return res.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('')
  }
}

// ── Parse + validate ───────────────────────────────────────────────────────────

function parseTag(raw: string): OntologyTag | null {
  try {
    const clean  = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(clean)

    // Validate scored_vector exists and has required dimensions
    const sv = parsed.scored_vector
    if (!sv || typeof sv !== 'object') return null

    const required = [
      'reversibility', 'time_horizon', 'stakes_magnitude', 'outcome_uncertainty',
      'value_conflict', 'identity_alignment', 'regret_asymmetry', 'upstream_dependency',
      'ambiguity', 'task_complexity', 'decision_discriminating_info',
      'time_pressure', 'decision_unit', 'emotional_intensity',
    ]
    for (const dim of required) {
      if (!sv[dim] || typeof sv[dim].score !== 'number' || sv[dim].score < 1 || sv[dim].score > 5) {
        console.warn(`[Tagger] scored_vector missing or invalid: ${dim}`)
        return null
      }
    }

    return parsed as OntologyTag
  } catch (err) {
    console.error('[Tagger] JSON parse failed:', err)
    return null
  }
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function tagDecision(
  decisionText: string,
  contextText: string | null
): Promise<OntologyTag | null> {
  try {
    const raw = await callTagger(decisionText, contextText)
    return parseTag(raw)
  } catch (err) {
    console.error('[Tagger] callTagger failed:', err)
    return null
  }
}
