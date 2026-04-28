// lib/structural-retrieval.ts
// ── Sprint 5: Structural Retrieval Engine ────────────────────────────────────
//
// Scores the current session's ontology tag against all past sessions
// for the same user. Retrieves the top 1–2 structural matches.
// Fires an annotation call to explain WHY they match.
// Returns a structured context block ready to inject into persona prompts.
//
// Deliberately NOT vector-based — structural matching across 9 ontology
// dimensions is more interpretable, more controllable, and requires no
// embedding infrastructure. The signal is in the decision architecture,
// not the surface language.
//
// Scoring model (100 pts total):
//   Decision Type Match     — 30 pts  (primary alignment is the strongest signal)
//   Register Proximity      — 25 pts  (instrumental/constitutive weight distance)
//   Stakes Architecture     — 20 pts  (reversibility + bearer + timeline)
//   Counterparty Structure  — 15 pts  (presence + alignment + relationship type)
//   Time Pressure Pattern   —  10 pts (deadline source + credibility)
//
// Threshold: >= 45 pts qualifies as a structural match
// Minimum sessions: 5 past complete-tagged sessions required to activate
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OntologySnapshot {
  session_id: string
  decision_text: string
  created_at: string
  decision_type_primary: string
  decision_type_secondary: string[]
  stakes_reversibility: string
  stakes_bearer: string
  stakes_timeline: string
  has_stated_deadline: boolean
  deadline_source: string
  deadline_credibility: string
  counterparty_present: boolean
  counterparty_alignment: string
  relationship_type: string
  instrumental_weight: number
  constitutive_weight: number
  dominant_emotion: string
  // From sessions table (joined)
  outcome?: {
    what_decided: string
    council_helped: string
  } | null
}

export interface StructuralMatch {
  session_id: string
  decision_text: string
  created_at: string
  structural_score: number          // 0–100
  score_breakdown: ScoreBreakdown
  annotation: string                // 2-3 sentence explanation of why they match
  outcome?: {
    what_decided: string
    council_helped: string
  } | null
}

export interface ScoreBreakdown {
  decision_type:  number   // 0–30
  register:       number   // 0–25
  stakes:         number   // 0–20
  counterparty:   number   // 0–15
  time_pressure:  number   // 0–10
  total:          number
}

export interface StructuralRetrievalResult {
  matches: StructuralMatch[]
  context_block: string             // ready-to-inject prompt block
  session_count_used: number        // how many past sessions were scored
  threshold_met: boolean            // true if >= 45 pts on any match
}

// ── Scoring Engine ────────────────────────────────────────────────────────────

export function scoreStructuralSimilarity(
  current: OntologySnapshot,
  past: OntologySnapshot,
): ScoreBreakdown {

  // ── 1. Decision Type (0–30) ──────────────────────────────────
  let decision_type = 0
  const pastSecondary = past.decision_type_secondary ?? []
  const currSecondary = current.decision_type_secondary ?? []

  if (current.decision_type_primary === past.decision_type_primary) {
    decision_type = 30
  } else if (pastSecondary.includes(current.decision_type_primary)) {
    decision_type = 18
  } else if (currSecondary.includes(past.decision_type_primary)) {
    decision_type = 12
  } else {
    // Partial credit for related type families
    const transitionFamily = ['transition', 'delegation', 'renunciation']
    const acquisitionFamily = ['acquisition', 'commitment', 'allocation']
    const governanceFamily  = ['governance', 'commitment', 'delegation']
    const families = [transitionFamily, acquisitionFamily, governanceFamily]
    for (const family of families) {
      if (family.includes(current.decision_type_primary) && family.includes(past.decision_type_primary)) {
        decision_type = 6
        break
      }
    }
  }

  // ── 2. Register Proximity (0–25) ─────────────────────────────
  // Instrumental weight distance — closer = stronger structural match
  let register = 0
  const registerDist = Math.abs(
    (current.instrumental_weight ?? 0.5) - (past.instrumental_weight ?? 0.5)
  )
  if (registerDist < 0.08)      register = 25
  else if (registerDist < 0.15) register = 20
  else if (registerDist < 0.22) register = 14
  else if (registerDist < 0.30) register = 8
  else                          register = 0

  // ── 3. Stakes Architecture (0–20) ────────────────────────────
  let stakes = 0
  if (current.stakes_reversibility === past.stakes_reversibility) stakes += 8
  if (current.stakes_bearer        === past.stakes_bearer)        stakes += 6
  if (current.stakes_timeline      === past.stakes_timeline)      stakes += 6

  // ── 4. Counterparty Structure (0–15) ─────────────────────────
  let counterparty = 0
  if (current.counterparty_present === past.counterparty_present) counterparty += 5
  if (current.counterparty_present && past.counterparty_present) {
    if (current.counterparty_alignment === past.counterparty_alignment) counterparty += 5
    if (current.relationship_type      === past.relationship_type)      counterparty += 5
  }

  // ── 5. Time Pressure Pattern (0–10) ──────────────────────────
  let time_pressure = 0
  if (current.has_stated_deadline === past.has_stated_deadline) time_pressure += 2
  if (current.has_stated_deadline && past.has_stated_deadline) {
    if (current.deadline_source      === past.deadline_source)      time_pressure += 5
    if (current.deadline_credibility === past.deadline_credibility) time_pressure += 3
  }

  const total = decision_type + register + stakes + counterparty + time_pressure

  return { decision_type, register, stakes, counterparty, time_pressure, total }
}

// ── Annotation Engine ─────────────────────────────────────────────────────────
// Once top matches are identified, fire a single annotaton call to explain
// the structural connection in plain language. This is the "you faced this
// structure before" moment.

async function annotateMatch(
  currentDecision: string,
  pastDecision: string,
  breakdown: ScoreBreakdown,
  pastCreatedAt: string,
): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const dateLabel = new Date(pastCreatedAt).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
  })

  const prompt = `You are the Quorum Structural Memory system. Your job is to write a precise 2-3 sentence explanation of why two decisions share structural similarity — not surface similarity, but the same underlying decision architecture.

CURRENT DECISION:
"${currentDecision.slice(0, 400)}"

PAST DECISION (from ${dateLabel}):
"${pastDecision.slice(0, 400)}"

STRUCTURAL MATCH SCORES (out of max):
- Decision type alignment: ${breakdown.decision_type}/30
- Register (instrumental/constitutive) proximity: ${breakdown.register}/25
- Stakes architecture: ${breakdown.stakes}/20
- Counterparty structure: ${breakdown.counterparty}/15
- Time pressure pattern: ${breakdown.time_pressure}/10
- Total: ${breakdown.total}/100

Write 2-3 sentences that explain what is structurally similar about these two decisions. Focus on the underlying mechanism — not the surface topic. Use precise language. Do not begin with "Both decisions" or "These decisions". Start with what the structure reveals about the decision-maker's situation. Keep it under 80 words.`

  try {
    const res = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',  // Fast + cheap for annotation
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = res.content[0].type === 'text' ? res.content[0].text : ''
    return text.trim()
  } catch (err) {
    console.error('[StructuralRetrieval] Annotation failed:', err)
    // Fallback: generate annotation from score breakdown directly
    const dominant = breakdown.decision_type >= 25
      ? 'the same type of decision architecture'
      : breakdown.register >= 20
        ? 'the same balance of instrumental and values-based reasoning'
        : 'similar stakes structure and counterparty dynamics'
    return `This past decision shares ${dominant} with the current one. The structural match score of ${breakdown.total}/100 indicates meaningful overlap in how the decision is organised, not just what it is about.`
  }
}

// ── Main retrieval function ───────────────────────────────────────────────────

export async function retrieveStructuralMatches(
  currentSnapshot: OntologySnapshot,
  pastSnapshots: OntologySnapshot[],
): Promise<StructuralRetrievalResult> {
  const MATCH_THRESHOLD = 45
  const MIN_SESSIONS    = 5
  const MAX_MATCHES     = 2

  // Guard: need at least MIN_SESSIONS past sessions to activate
  if (pastSnapshots.length < MIN_SESSIONS) {
    return {
      matches: [],
      context_block: '',
      session_count_used: pastSnapshots.length,
      threshold_met: false,
    }
  }

  // Score all past sessions against current
  const scored = pastSnapshots
    .map(past => ({
      past,
      breakdown: scoreStructuralSimilarity(currentSnapshot, past),
    }))
    .filter(s => s.breakdown.total >= MATCH_THRESHOLD)
    .sort((a, b) => b.breakdown.total - a.breakdown.total)
    .slice(0, MAX_MATCHES)

  if (scored.length === 0) {
    return {
      matches: [],
      context_block: '',
      session_count_used: pastSnapshots.length,
      threshold_met: false,
    }
  }

  // Annotate matches in parallel (fast — uses Haiku)
  const annotated = await Promise.all(
    scored.map(async ({ past, breakdown }) => {
      const annotation = await annotateMatch(
        currentSnapshot.decision_text,
        past.decision_text,
        breakdown,
        past.created_at,
      )
      return {
        session_id:        past.session_id,
        decision_text:     past.decision_text,
        created_at:        past.created_at,
        structural_score:  breakdown.total,
        score_breakdown:   breakdown,
        annotation,
        outcome:           past.outcome ?? null,
      } as StructuralMatch
    })
  )

  // Build injection block
  const context_block = buildContextBlock(annotated)

  return {
    matches: annotated,
    context_block,
    session_count_used: pastSnapshots.length,
    threshold_met: true,
  }
}

// ── Context block builder ─────────────────────────────────────────────────────
// Formats the matches into a prompt-injectable block.
// Injected into Pattern Analyst, Risk Architect, and Elder only.
// The other personas don't benefit from temporal context in the same way.

function buildContextBlock(matches: StructuralMatch[]): string {
  if (matches.length === 0) return ''

  const blocks = matches.map((m, i) => {
    const dateLabel = new Date(m.created_at).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'long', year: 'numeric',
    })
    const snippet = m.decision_text.length > 250
      ? m.decision_text.slice(0, 250) + '…'
      : m.decision_text

    const outcomeBlock = m.outcome?.what_decided
      ? `\nWhat was decided: "${m.outcome.what_decided}"`
      : '\nOutcome: Not yet logged.'

    return `STRUCTURAL MATCH ${i + 1} (Score: ${m.structural_score}/100 — ${dateLabel}):
"${snippet}"
${outcomeBlock}
Why this is structurally relevant: ${m.annotation}`
  }).join('\n\n---\n\n')

  return `STRUCTURAL MEMORY — PATTERN CONTEXT:
The Quorum system has identified ${matches.length === 1 ? 'a past decision' : 'past decisions'} by this user that share structural architecture with the current decision. This is not surface similarity — it is the same underlying decision type, register, and stakes pattern.

${blocks}

INSTRUCTION: Use this structural memory if it genuinely illuminates your analysis. Reference it as "you have faced a structurally similar decision before" rather than repeating the past decision's details verbatim. Do not force the parallel if it does not apply to your angle. If it does apply, use it as one specific data point — not the entire frame.`
}

// ── Personas that receive structural context ──────────────────────────────────
// Pattern Analyst: directly in their mandate (analogues + historical patterns)
// Risk Architect: past failure modes of same structure are pre-mortem fuel
// Elder: temporal perspective benefits from knowing this structure recurs
// Others: receive no injection — forcing pattern context onto Contrarian,
// Stakeholder Mirror, or Competitor would dilute their specific angles.

export const PERSONAS_WITH_STRUCTURAL_CONTEXT = new Set([
  'pattern_analyst',
  'risk_architect',
  'elder',
])
