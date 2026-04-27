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

const TAGGER_SYSTEM = `You are an expert decision ontology classifier for Quorum, a private decision intelligence system.

Classify the decision across 9 dimensions. Return ONLY valid JSON — no explanation, no markdown, no preamble.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DIMENSION 1 — DECISION TYPE (reason about the core action, not the surface description)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Ask: what is the person fundamentally doing?

commitment   → binding themselves to an ongoing relationship or agreement with another party
               (investor deal, employment contract, partnership with terms)
allocation   → choosing how to distribute a resource between uses where no binding external party exists
               (which fund to invest in, how to split a budget)
transition   → moving from one stable personal state to another
               (changing city, role, life phase — the self is what changes)
acquisition  → obtaining a specific new asset, property, or company
               (buying a flat, acquiring a business unit)
renunciation → giving up or permanently exiting something currently held
               (selling equity stake, leaving a position, divesting)
governance   → deciding who has authority over what in a shared system
               (board structure, succession of control, shareholder agreements)
delegation   → handing an ongoing process to another party to manage
               (outsourcing portfolio management, hiring a CEO to run operations)

REASONING CHAIN FOR TYPE:
Before choosing, ask three questions:
1. Is there a binding agreement with an external party? → likely commitment or renunciation
2. Is the person's own identity/role/location the thing that changes? → likely transition
3. Is the person choosing between uses of a resource they already hold? → likely allocation
4. Is the person giving up something they currently own? → likely renunciation
5. Is a specific asset being obtained? → likely acquisition

Secondary types: most decisions have 1–2. A job acceptance is transition (primary) + commitment (secondary). A founder equity sale is renunciation (primary) + commitment (secondary, if lock-in exists).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DIMENSION 3 — DEADLINE CREDIBILITY (reason about who controls the deadline and whether it is real)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Ask: if the deadline passes, does the opportunity actually disappear — or does the other party still need the deal?

HIGH: The deadline is controlled by nature, biology, or irrevocable external events.
      Medical progression (Parkinson's, cancer, cognitive decline), regulatory filing dates,
      auction dates, school/university registration deadlines set by institutions.
      These cannot be negotiated. They pass and the window closes.

MEDIUM: The deadline is self-created or partially real.
        "This may be my last realistic shot" — the window is genuinely narrowing but
        the timing is driven by the person's own narrative, not an external constraint.
        Market timing concerns without a contractual basis.

LOW: The deadline is counterparty-created as a tactical pressure mechanism.
     Investment offers, PE term sheets, strategic acquirer LOIs, vendor promotions,
     wealth manager pitches — these parties WANT the deal. If you call their bluff,
     90% of the time the deadline extends. Treat all counterparty-imposed investment
     and M&A deadlines as low credibility unless there is a specific contractual penalty
     for missing the date.

NONE: No deadline exists in the description.

IMPORTANT: A healthy parent expressing a wish to step back or transfer while they can
still guide the process is NOT a deadline. It is a preference. Set credibility: none.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DIMENSION 8 — DECISION REGISTER (the most important dimension — reason carefully)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The weights must sum to 1.0. Use the full range 0.05–0.95. Do not default to 0.65/0.35.

INSTRUMENTAL: The "right answer" could in principle be calculated if you had enough data.
              The core question is about outcomes — return, salary, efficiency, market share.

CONSTITUTIVE: The "right answer" cannot be calculated. The core question is about identity —
              who the person wants to be, what kind of family or legacy they are building,
              what they stand for. Values questions, duty questions, identity questions.

THE CRITICAL DISTINCTION:
The presence of large money does NOT make a decision instrumental.
The presence of emotion does NOT make a decision constitutive.
Ask: is the core question "what will produce the best outcome?" (instrumental)
  or "what kind of person / family / builder do I want to be?" (constitutive)

REASONING CHAIN FOR REGISTER:
Step 1: What is the person actually asking? Underline the real question in the text.
Step 2: Could a spreadsheet answer it? → more instrumental
Step 3: Does the answer require knowing the person's values? → more constitutive
Step 4: Is identity, legacy, duty, or guilt the emotional core — not just texture? → push constitutive

REFERENCE SCALE:
0.95i / 0.05c — Pure financial optimisation. Multiple options compared by return rates, tax, XIRR.
                No family tension, no identity language. "Where should I put ₹50L?"
0.80i / 0.20c — Financial decision with a control or enjoyment undercurrent.
                Wealth manager delegation where the person enjoys managing it.
0.65i / 0.35c — Genuinely mixed. Financial logic AND personal identity both matter.
                Startup CBO role: economics matter AND "last realistic shot" identity narrative.
0.50i / 0.50c — Neither dominates. Family business governance: legal structure AND family trust values.
0.35i / 0.65c — Primarily constitutive. Financial consequences real but identity is the core.
                Founder selling a 6-year-old company they built — the attachment is the real question.
0.20i / 0.80c — Primarily constitutive. Relocating to care for a parent with a progressive illness.
                Income impact exists but guilt, duty, and family obligation are the core.
0.05i / 0.95c — Pure identity/values decision. Negligible financial component.

WATCH FOR INFLATION: Guilt language, health mentions, and emotional attachment push constitutive
up in models. Ask whether these are the CORE of the decision or just texture around a financial one.
A founder buyout at ₹4 crore where the person needs the capital to fund their next 3 years is
primarily instrumental even if guilt is present.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXAMINER GAPS — be specific, not generic
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Identify the 3 most critical pieces of information NOT in the description.
Name the exact gap — not a category.

Good: "PE firm's parallel portfolio obligations and whether they have a fund deadline forcing this deal"
Bad: "More information about the PE firm"

Good: "Co-founder's personal financial situation and whether they need liquidity now for personal reasons"
Bad: "Co-founder's motivations"`

// ── Main tagger function ───────────────────────────────────────

export async function tagDecision(
  decisionText: string,
  contextText?: string | null
): Promise<OntologyTag | null> {
  const contextBlock = contextText
    ? `\nADDITIONAL CONTEXT:\n${contextText}`
    : ''

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

  const userMessage = `DECISION TO CLASSIFY:
${decisionText}${contextBlock}

Your output must match this schema exactly:
${schema}

Return ONLY the JSON object.`

  try {
    const rawTag = await callModel(userMessage)
    if (!rawTag) return null

    // ── Rule-based post-processing ─────────────────────────────
    // Catches systematic model failures regardless of which model is used.
    // These rules encode domain knowledge that models under-apply.
    const corrected = applyDomainRules(rawTag, decisionText)

    return corrected
  } catch (err) {
    console.error('[OntologyTagger] tagDecision failed:', err)
    return null
  }
}

// ── Model call (provider-agnostic) ────────────────────────────

async function callModel(userMessage: string): Promise<OntologyTag | null> {
  try {
    let rawText: string

    if (PROVIDER === 'deepseek') {
      const response = await deepseek.chat.completions.create({
        model: DEEPSEEK_MODEL,
        max_tokens: 900,
        temperature: 0, // deterministic for structured extraction
        messages: [
          { role: 'system', content: TAGGER_SYSTEM },
          { role: 'user',   content: userMessage },
        ],
      })
      rawText = response.choices[0]?.message?.content ?? ''
    } else {
      const response = await anthropic.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 900,
        system: TAGGER_SYSTEM,
        messages: [{ role: 'user', content: userMessage }],
      })
      rawText = response.content
        .filter(b => b.type === 'text')
        .map(b => (b as { type: 'text'; text: string }).text)
        .join('')
    }

    const clean = rawText
      .replace(/\`\`\`json\s*/gi, '')
      .replace(/\`\`\`\s*/g, '')
      .trim()

    return JSON.parse(clean) as OntologyTag
  } catch (err) {
    console.error('[OntologyTagger] callModel failed:', err)
    return null
  }
}

// ── Factual domain corrections ────────────────────────────────
// These are the ONLY two rules retained. Both encode facts,
// not inferences — they are always true regardless of context.
// All other classification is handled by the improved prompt.

function applyDomainRules(tag: OntologyTag, text: string): OntologyTag {
  const t = text.toLowerCase()
  const result = { ...tag }

  // FACT 1: Counterparty-imposed investment/M&A deadlines are always low credibility.
  // PE firms, strategic investors, and acquirers use expiring offers as pressure.
  // They want the deal — the deadline is a tactic, not a constraint.
  const counterpartyInvestmentKeywords = [
    'pe firm', 'private equity', 'strategic investor', 'acquirer',
    'term sheet', 'loi expires', 'offer expires', 'offer expir',
    'investor offer', 'the offer', 'valid for', 'expires in'
  ]
  const hasInvestorDeadline = counterpartyInvestmentKeywords.some(k => t.includes(k))
  if (hasInvestorDeadline && tag.deadline_source === 'counterparty') {
    result.deadline_credibility = 'low'
  }

  // FACT 2: Medical/biological progression is always high credibility urgency.
  // These timelines are set by biology, not tactics.
  const medicalKeywords = [
    "parkinson", "alzheimer", "cancer", "diagnosis", "diagnosed",
    "surgery", "terminal", "dementia", "stroke", "progressive",
    "prognosis", "unwell", "ill and", "heart condition"
  ]
  const hasMedicalUrgency = medicalKeywords.some(k => t.includes(k))
  if (hasMedicalUrgency && tag.deadline_source !== 'none') {
    result.deadline_credibility = 'high'
    result.deadline_source = 'external'
    result.has_stated_deadline = true
  }

  return result
}


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
