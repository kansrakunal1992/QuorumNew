/**
 * QUORUM LEDGER — Decision Ontology Tagger
 * Sprint 1 — pure backend, no user-facing output
 *
 * Takes a decision description + optional context.
 * Returns a structured 9-dimension ontology tag as JSON.
 * Called async after session creation — never blocks the user.
 *
 * Provider-agnostic: uses the same AI_PROVIDER env variable
 * as the rest of the app (Anthropic or DeepSeek).
 */

import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

const PROVIDER = (process.env.AI_PROVIDER ?? 'anthropic').toLowerCase()
const ANTHROPIC_MODEL = process.env.AI_MODEL ?? 'claude-sonnet-4-20250514'
const DEEPSEEK_MODEL  = process.env.AI_MODEL ?? 'deepseek-chat'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })
const deepseek  = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY ?? '',
  baseURL: 'https://api.deepseek.com',
})

// ── Ontology schema types ──────────────────────────────────────

export type DecisionType =
  | 'commitment'     // entering a binding relationship or agreement
  | 'allocation'     // deploying a resource between competing uses
  | 'transition'     // changing a stable state (role, city, structure)
  | 'acquisition'    // obtaining something new (asset, partnership)
  | 'renunciation'   // giving something up or exiting a position
  | 'governance'     // deciding who has authority over what
  | 'delegation'     // handing an ongoing responsibility to another

export interface OntologyTag {
  // Dimension 1: Decision Type
  decision_type_primary: DecisionType
  decision_type_secondary: DecisionType[]

  // Dimension 2: Stakes
  stakes_reversibility: 'full' | 'partial' | 'irreversible'
  stakes_bearer: 'self' | 'family' | 'organisation' | 'third-parties'
  stakes_timeline: 'immediate' | '1-3yr' | '5yr+' | 'generational'

  // Dimension 3: Time Pressure
  has_stated_deadline: boolean
  deadline_source: 'self' | 'counterparty' | 'external' | 'none'
  deadline_credibility: 'high' | 'medium' | 'low' | 'none'

  // Dimension 4: Information
  known_unknowns_surfaced: boolean
  unknown_unknown_categories: Array<
    'counterparty_health' | 'regulatory' | 'market' | 'family' | 'execution' | 'succession'
  >

  // Dimension 5: Counterparty
  counterparty_present: boolean
  counterparty_alignment: 'aligned' | 'partial' | 'misaligned' | 'unknown'
  info_asymmetry: 'favor_dm' | 'equal' | 'favor_counterparty' | 'unknown'
  relationship_type: 'transactional' | 'relational' | 'fiduciary' | 'adversarial'

  // Dimension 6: Emotional Signature
  dominant_emotion: 'anxiety' | 'excitement' | 'obligation' | 'ambivalence' | 'urgency' | 'resignation'
  emotion_source: 'self' | 'external'
  emotion_analysis_aligned: boolean

  // Dimension 7: Stakeholder Complexity
  stakeholder_count: '1' | '2-3' | '4+'
  hidden_stakeholder_probability: 'low' | 'medium' | 'high'

  // Dimension 8: Decision Register
  instrumental_weight: number  // 0.0 to 1.0
  constitutive_weight: number  // 0.0 to 1.0 (sum to 1.0)

  // Dimension 9: Examiner Priority Gaps
  // The 3 most critical unknown unknowns for Phase 1 questions
  examiner_gap_1: string
  examiner_gap_2: string
  examiner_gap_3: string
}

// ── System prompt for the tagger ──────────────────────────────

const TAGGER_SYSTEM = `You are a decision ontology classifier for Quorum, a private decision intelligence system.

Your job is to analyse a decision description and extract a precise structural classification across 9 dimensions. This classification is used to retrieve structurally similar past decisions and weight advisory personas appropriately.

CRITICAL: Return ONLY valid JSON. No explanation. No preamble. No markdown. Just the JSON object.

Be precise and literal. Do not infer beyond what the text contains. When uncertain, choose the most conservative option (e.g. 'unknown' over 'misaligned').

For the Decision Register (instrumental vs constitutive):
- INSTRUMENTAL: decisions optimising for a measurable outcome (return, salary, efficiency)
- CONSTITUTIVE: decisions about who the person wants to be, what they value, what kind of life/family/legacy they are building
- Most decisions are mixed. Assign weights that sum to 1.0.
- A PE deal with family legacy concerns: instrumental 0.65, constitutive 0.35
- A career move driven by meaning over money: instrumental 0.30, constitutive 0.70
- A relocation for aging parents: instrumental 0.20, constitutive 0.80

For examiner_gap_1/2/3: identify the 3 most critical pieces of information NOT present in the decision description that would most change the analysis if known. State each as a specific gap, not a question. Example: "PE firm's parallel portfolio obligations and leverage position" not "What is the PE firm's financial health?"`

// ── Main tagger function ───────────────────────────────────────

export async function tagDecision(
  decisionText: string,
  contextText?: string | null
): Promise<OntologyTag | null> {
  const contextBlock = contextText
    ? `\nADDITIONAL CONTEXT:\n${contextText}`
    : ''

  const userMessage = `DECISION TO CLASSIFY:\n${decisionText}${contextBlock}\n\nReturn the ontology JSON now.`

  const schema = `{
  "decision_type_primary": "commitment|allocation|transition|acquisition|renunciation|governance|delegation",
  "decision_type_secondary": ["...array, may be empty"],
  "stakes_reversibility": "full|partial|irreversible",
  "stakes_bearer": "self|family|organisation|third-parties",
  "stakes_timeline": "immediate|1-3yr|5yr+|generational",
  "has_stated_deadline": true,
  "deadline_source": "self|counterparty|external|none",
  "deadline_credibility": "high|medium|low|none",
  "known_unknowns_surfaced": true,
  "unknown_unknown_categories": ["counterparty_health","regulatory","market","family","execution","succession"],
  "counterparty_present": true,
  "counterparty_alignment": "aligned|partial|misaligned|unknown",
  "info_asymmetry": "favor_dm|equal|favor_counterparty|unknown",
  "relationship_type": "transactional|relational|fiduciary|adversarial",
  "dominant_emotion": "anxiety|excitement|obligation|ambivalence|urgency|resignation",
  "emotion_source": "self|external",
  "emotion_analysis_aligned": true,
  "stakeholder_count": "1|2-3|4+",
  "hidden_stakeholder_probability": "low|medium|high",
  "instrumental_weight": 0.65,
  "constitutive_weight": 0.35,
  "examiner_gap_1": "specific gap description",
  "examiner_gap_2": "specific gap description",
  "examiner_gap_3": "specific gap description"
}`

  const fullUserMessage = `${userMessage}\n\nYour output must match this schema exactly:\n${schema}`

  try {
    let rawText: string

    if (PROVIDER === 'deepseek') {
      const response = await deepseek.chat.completions.create({
        model: DEEPSEEK_MODEL,
        max_tokens: 800,
        temperature: 0,  // deterministic for structured extraction
        messages: [
          { role: 'system', content: TAGGER_SYSTEM },
          { role: 'user',   content: fullUserMessage },
        ],
      })
      rawText = response.choices[0]?.message?.content ?? ''
    } else {
      const response = await anthropic.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 800,
        system: TAGGER_SYSTEM,
        messages: [{ role: 'user', content: fullUserMessage }],
      })
      rawText = response.content
        .filter(b => b.type === 'text')
        .map(b => (b as { type: 'text'; text: string }).text)
        .join('')
    }

    // Strip markdown fences if model added them
    const clean = rawText
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g,      '')
      .trim()

    const parsed = JSON.parse(clean) as OntologyTag

    // Validate register weights sum to ~1.0
    const sum = (parsed.instrumental_weight ?? 0) + (parsed.constitutive_weight ?? 0)
    if (Math.abs(sum - 1.0) > 0.05) {
      // Normalise if off
      const total = sum || 1
      parsed.instrumental_weight = +(parsed.instrumental_weight / total).toFixed(2)
      parsed.constitutive_weight = +(parsed.constitutive_weight / total).toFixed(2)
    }

    return parsed
  } catch (err) {
    console.error('[OntologyTagger] Failed to parse response:', err)
    return null
  }
}

// ── Validate a tag (basic sanity check) ───────────────────────

export function validateTag(tag: OntologyTag): boolean {
  const validTypes = ['commitment','allocation','transition','acquisition','renunciation','governance','delegation']
  if (!validTypes.includes(tag.decision_type_primary)) return false
  if (typeof tag.instrumental_weight !== 'number') return false
  if (typeof tag.constitutive_weight !== 'number') return false
  if (!tag.examiner_gap_1 || !tag.examiner_gap_2 || !tag.examiner_gap_3) return false
  return true
}

// ── Map tag to Supabase insert shape ──────────────────────────

export function tagToInsert(sessionId: string, tag: OntologyTag) {
  return {
    session_id:                  sessionId,
    decision_type_primary:       tag.decision_type_primary,
    decision_type_secondary:     tag.decision_type_secondary ?? [],
    stakes_reversibility:        tag.stakes_reversibility,
    stakes_bearer:               tag.stakes_bearer,
    stakes_timeline:             tag.stakes_timeline,
    has_stated_deadline:         tag.has_stated_deadline,
    deadline_source:             tag.deadline_source,
    deadline_credibility:        tag.deadline_credibility,
    known_unknowns_surfaced:     tag.known_unknowns_surfaced,
    unknown_unknown_categories:  tag.unknown_unknown_categories ?? [],
    counterparty_present:        tag.counterparty_present,
    counterparty_alignment:      tag.counterparty_alignment,
    info_asymmetry:              tag.info_asymmetry,
    relationship_type:           tag.relationship_type,
    dominant_emotion:            tag.dominant_emotion,
    emotion_source:              tag.emotion_source,
    emotion_analysis_aligned:    tag.emotion_analysis_aligned,
    stakeholder_count:           tag.stakeholder_count,
    hidden_stakeholder_probability: tag.hidden_stakeholder_probability,
    instrumental_weight:         tag.instrumental_weight,
    constitutive_weight:         tag.constitutive_weight,
    examiner_gap_1:              tag.examiner_gap_1,
    examiner_gap_2:              tag.examiner_gap_2,
    examiner_gap_3:              tag.examiner_gap_3,
    raw_ontology_json:           tag,
    tagger_status:               'complete',
    tagger_version:              'v1.0',
  }
}
