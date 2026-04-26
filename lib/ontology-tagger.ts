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

DIMENSION 1 — DECISION TYPE
Choose the primary type that best describes what is fundamentally happening.

commitment: entering a binding agreement WITH another party (investor deal, employment contract, partnership with covenants)
allocation: distributing a resource (capital, time) between competing uses with no binding external party
transition: changing a stable personal state — role, city, life stage. The person moves from one identity context to another
acquisition: obtaining something new — asset, property, company
renunciation: giving up or exiting something already owned — selling equity, leaving a role, divesting
governance: deciding who has authority over what in a system the person controls or co-controls
delegation: handing an ongoing responsibility to another party to manage on your behalf

COMMON TYPE ERRORS:
- Selling founder equity = renunciation primary, commitment secondary. NEVER transition.
- Accepting a new job = transition primary, commitment secondary.
- Formalising family business governance = governance. NOT transition.
- Deploying savings into investments = allocation. NOT acquisition.
- Handing portfolio to wealth manager = delegation. NOT allocation.

DIMENSION 3 — DEADLINE CREDIBILITY
Measures whether time pressure is REAL or MANUFACTURED.

HIGH: Medical or biological trajectory (diagnosis, aging parent, progressive condition). Regulatory deadline. Irrevocable external event. Employment start date.
LOW: Investor or PE firm offer expiry — ALWAYS low. Strategic acquirer deadline — ALWAYS low. Any counterparty-imposed deadline in investment or M&A context. Vendor limited-time offers.
MEDIUM: Self-framing of narrowing window ("last realistic shot"). Market timing concerns with no contractual basis.
NONE: No deadline mentioned.

DEADLINE SOURCE:
- counterparty: set by the other party to the deal
- external: nature, regulation, biology, irrevocable events
- self: the decision-maker has framed it as urgent themselves
- none: no deadline

DIMENSION 8 — DECISION REGISTER (use the full range — do not default to 0.65/0.35)
instrumental_weight + constitutive_weight must sum exactly to 1.0.

INSTRUMENTAL: optimising for a measurable outcome. The right answer could in principle be calculated with enough data.
CONSTITUTIVE: choosing who the person wants to be, what kind of life or legacy they are building. Cannot be calculated — requires knowing your values.

CALIBRATION ANCHORS:

0.95 instrumental / 0.05 constitutive
Pure financial optimisation, no values conflict.
Example: deploying savings across mutual funds, stocks, and NPS. The wife's nervousness is a stakeholder concern, not a values question for this dimension.

0.80 instrumental / 0.20 constitutive
Financial decision with one values undercurrent.
Example: handing portfolio to a wealth manager when the person enjoys managing it themselves — primarily financial, control dimension is minor.

0.65 instrumental / 0.35 constitutive
Genuinely mixed — financial and personal identity both present.
Example: CBO role at startup with "last shot" framing — career economics matter AND identity timing narrative matters.

0.50 instrumental / 0.50 constitutive
Neither dimension clearly dominates.
Example: formalising family business governance — financial and legal structure AND family trust and values are equally at stake.

0.35 instrumental / 0.65 constitutive
Primarily constitutive with financial secondary.
Example: selling a 6-year founder stake where emotional attachment to what was built dominates the framing.

0.20 instrumental / 0.80 constitutive
Primarily constitutive — values question with financial consequences.
Example: relocating to care for an aging parent with a progressive illness. The core question is duty, guilt, family obligation. Not optimisable.

0.05 instrumental / 0.95 constitutive
Pure identity or duty decision with negligible financial component.

EXAMINER GAPS
Identify the 3 most critical pieces of information NOT in the description that would most change the analysis.
Be specific — name the exact gap.
Good: "PE firm's parallel portfolio obligations and current leverage position"
Bad: "More information about the PE firm"
Good: "Co-founder's personal financial situation and whether they need liquidity now"
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

    // ── Self-correction pass if register looks anchored ────────
    // If weights are exactly 0.65/0.35 AND we detect strong constitutive
    // or strong instrumental signals, force a re-assessment pass.
    const needsRegisterCorrection =
      corrected.instrumental_weight === 0.65 &&
      corrected.constitutive_weight === 0.35 &&
      hasStrongRegisterSignal(decisionText)

    if (needsRegisterCorrection) {
      console.log('[OntologyTagger] Register anchor detected — running correction pass')
      const correctionMsg = `${userMessage}

IMPORTANT CORRECTION REQUIRED:
Your previous response returned exactly 0.65/0.35 for the decision register.
This is almost certainly wrong — you have defaulted to a safe middle value.

Re-examine the text for these specific signals:

STRONG CONSTITUTIVE signals (push constitutive_weight toward 0.70–0.90):
- Mentions of duty, guilt, obligation to family
- Emotional attachment to what was built ("started 6 years ago", "my father built this")
- Aging parent, illness, care responsibility
- Legacy, generational, passing something on
- Identity language ("who I want to be", "what kind of person")

STRONG INSTRUMENTAL signals (push instrumental_weight toward 0.85–0.95):
- Pure financial optimisation with no personal identity conflict
- Multiple options compared by return rate, tax efficiency, XIRR
- No family, duty, or emotional attachment language

Re-assign the weights honestly. Return the complete JSON again with corrected weights.`

      const recorrected = await callModel(correctionMsg)
      if (recorrected) {
        corrected.instrumental_weight = recorrected.instrumental_weight
        corrected.constitutive_weight = recorrected.constitutive_weight
        // Keep all other fields from first pass — only register changes
      }
    }

    // Normalise weights to sum to 1.0
    const sum = corrected.instrumental_weight + corrected.constitutive_weight
    if (Math.abs(sum - 1.0) > 0.02) {
      const total = sum || 1
      corrected.instrumental_weight = +((corrected.instrumental_weight / total).toFixed(2))
      corrected.constitutive_weight = +((corrected.constitutive_weight / total).toFixed(2))
    }

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

// ── Rule-based domain corrections ────────────────────────────
// These rules encode domain knowledge that all current LLMs under-apply.
// Applied AFTER model output. Model-agnostic safety net.

function applyDomainRules(tag: OntologyTag, text: string): OntologyTag {
  const t = text.toLowerCase()
  const result = { ...tag }

  // RULE 1: Investor/PE/strategic acquirer deadlines are ALWAYS low credibility
  // All current models systematically get this wrong
  const investorDeadlineKeywords = [
    'offer expires', 'offer expir', 'expires in', 'valid for',
    'pe firm', 'private equity', 'strategic investor', 'acquirer',
    'term sheet', 'loi expires', 'letter of intent'
  ]
  const hasInvestorDeadline = investorDeadlineKeywords.some(k => t.includes(k))
  if (hasInvestorDeadline && tag.deadline_source === 'counterparty') {
    result.deadline_credibility = 'low'
  }

  // RULE 2: Medical/biological urgency is ALWAYS high credibility
  const medicalKeywords = [
    "parkinson", "alzheimer", "cancer", "diagnosis", "diagnosed",
    "surgery", "terminal", "dementia", "stroke", "heart", "aging parent",
    "father is", "mother is", "parent is"
  ]
  const hasMedicalUrgency = medicalKeywords.some(k => t.includes(k))
  if (hasMedicalUrgency) {
    result.deadline_credibility = 'high'
    result.deadline_source = 'external'
    result.has_stated_deadline = true
  }

  // RULE 3: Selling founder equity is renunciation, not transition
  const founderSaleKeywords = [
    'selling my stake', 'sell my stake', 'selling my equity',
    'sell my equity', 'sell my shares', 'selling my shares',
    'divest', 'exit my position', 'sell my %', 'sell my position'
  ]
  const isFounderSale = founderSaleKeywords.some(k => t.includes(k))
  if (isFounderSale && tag.decision_type_primary === 'transition') {
    result.decision_type_primary = 'renunciation'
    if (!result.decision_type_secondary.includes('commitment')) {
      // Lock-ins and control rights make it a commitment too
      const hasLockIn = t.includes('lock-in') || t.includes('lock in') || t.includes('control rights')
      if (hasLockIn) {
        result.decision_type_secondary = ['commitment', ...result.decision_type_secondary.filter(s => s !== 'renunciation')]
      }
    }
  }

  // RULE 4: Pure financial optimisation (multiple options with return rates, no identity conflict)
  // should never have constitutive_weight above 0.20 unless emotional language is present
  const isPureFinancial = (
    (t.includes('xirr') || t.includes('returns') || t.includes('mutual fund')) &&
    !t.includes('father') && !t.includes('mother') && !t.includes('guilt') &&
    !t.includes('attached') && !t.includes('legacy') && !t.includes('built') &&
    !t.includes('relocat')
  )
  if (isPureFinancial && tag.constitutive_weight > 0.20) {
    result.constitutive_weight = 0.10
    result.instrumental_weight = 0.90
  }

  // RULE 5: Care/duty for aging/ill parent pushes constitutive high
  const isCareDecision = (
    medicalKeywords.some(k => t.includes(k)) &&
    (t.includes('relocat') || t.includes('move back') || t.includes('return') || t.includes('care'))
  )
  if (isCareDecision && tag.constitutive_weight < 0.65) {
    result.constitutive_weight = 0.75
    result.instrumental_weight = 0.25
    result.dominant_emotion = 'obligation'
  }

  // RULE 6: Stakes bearer — if family members are named and materially affected,
  // stakes_bearer should not be 'self'
  const namedFamilyAffected = (
    (t.includes('wife') || t.includes('spouse') || t.includes('husband') ||
     t.includes('children') || t.includes('son') || t.includes('daughter') ||
     t.includes('father') || t.includes('mother') || t.includes('co-founder')) &&
    tag.stakes_bearer === 'self'
  )
  if (namedFamilyAffected) {
    result.stakes_bearer = 'family'
  }

  return result
}

// ── Detect strong register signal (breaks the 0.65/0.35 anchor) ──

function hasStrongRegisterSignal(text: string): boolean {
  const t = text.toLowerCase()

  const strongConstitutive = [
    'guilt', 'duty', 'obligation', 'legacy', 'emotionally attached',
    'feel attached', 'father built', 'mother built', 'built this',
    'parkinson', 'alzheimer', 'diagnosed', 'aging parent', 'care for',
    'relocat', 'move back', 'last realistic shot', 'who i am',
    'what i stand for'
  ]

  const strongInstrumental = [
    'xirr', 'return on', 'tax efficiency', 'expense ratio',
    'portfolio allocation', 'asset allocation', 'diversif'
  ]

  const hasConstitutive = strongConstitutive.some(k => t.includes(k))
  const hasInstrumental = strongInstrumental.some(k => t.includes(k))

  // Signal is strong if EITHER a clear constitutive OR clear instrumental
  // marker is present — meaning the 0.65/0.35 middle is likely wrong
  return hasConstitutive || hasInstrumental
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
