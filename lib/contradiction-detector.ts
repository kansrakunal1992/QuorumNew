// lib/contradiction-detector.ts
// ── Sprint 9: Contradiction Detector ────────────────────────────────────────
//
// Two-pass AI pipeline:
//
//   Pass 1 — Principle extraction (one call per user, all sessions at once)
//     Input:  all examiner_responses + user pushback messages, grouped by session
//     Output: { sessionId, principles: string[] }[] — stated beliefs/rules
//
//   Pass 2 — Contradiction detection (one call, all principles at once)
//     Input:  all extracted principles with session context
//     Output: ContradictionRaw[] — pairs where principle A conflicts with action B
//
// Design decisions:
//   - Two separate AI calls (not one) keeps each prompt focused and output
//     predictable. One giant call produces hallucinated cross-references.
//   - createCompletion takes a single string — system prompt is prepended inline.
//   - Cap: process max 30 sessions, surface max 3 contradictions (quality > quantity).
//   - Minimum 3 sessions with examiner data before running. Below that, there is
//     not enough signal to distinguish a genuine contradiction from a context shift.
//   - Severity classification done by the AI in Pass 2, not post-hoc.
// ─────────────────────────────────────────────────────────────────────────────

import { createCompletion } from '@/lib/ai-client'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SessionEvidence {
  sessionId:    string
  decisionText: string
  createdAt:    string
  responses:    string[]   // examiner answers + pushback text, concatenated
}

export interface ExtractedPrinciple {
  sessionId:    string
  decisionText: string
  createdAt:    string
  principles:   string[]
}

export interface ContradictionRaw {
  principleText:       string
  principleSessionId:  string
  violationText:       string
  violationSessionId:  string
  severity:            'sharp' | 'notable' | 'forming'
  category:            string
}

// ── Pass 1: Extract stated principles from each session ───────────────────────
//
// Principles are implicit rules the person stated or implied:
//   "I always want to see the downside first"
//   "I don't act on verbal commitments alone"
//   "I require 3% withdrawal rate or I won't retire"
//
// Format rules:
//   - First-person, present tense
//   - Concrete enough to be testable against a future decision
//   - Max 3 per session (quality over coverage)
//   - Skip sessions where responses are too thin (< 30 chars total)

const PASS1_PROMPT = (evidence: SessionEvidence[]) => `
You are extracting implicit decision-making principles from a person's responses across multiple decisions.

A principle is a concrete, testable belief about how they decide — not a personality trait.
Good: "I won't commit without seeing a written term sheet."
Bad:  "They value careful analysis." (too abstract, not testable)

Rules:
- First-person present tense ("I always...", "I require...", "I don't act until...")
- Must be extractable directly from the text — do not invent
- Max 3 principles per session
- If a session has fewer than 30 words of content, return an empty principles array
- Return ONLY valid JSON. No markdown, no explanation.

Output format:
[
  {
    "sessionId": "...",
    "principles": ["...", "..."]
  }
]

Sessions to analyse:
${evidence.map(s => `
SESSION ${s.sessionId.slice(0, 8)} — "${s.decisionText.slice(0, 80)}" (${s.createdAt.slice(0, 10)})
Content:
${s.responses.join('\n')}
`).join('\n---\n')}
`.trim()

// ── Pass 2: Detect contradictions across principles ───────────────────────────
//
// A contradiction is when a principle stated in session A is structurally
// violated by the framing or action in session B.
//
// "I always check reversibility before committing" (session A)
// vs "I'll quit my job — I can always return" (session B)
// → Sharp contradiction: stated reversibility check, assumed reversibility instead.
//
// Severity:
//   sharp   — direct logical conflict ("I never do X" + "I did X")
//   notable — meaningful tension ("I prioritise Y" + "ignored Y here")
//   forming — only 2 data points, directionally inconsistent

const PASS2_PROMPT = (principles: ExtractedPrinciple[]) => `
You are detecting genuine contradictions in a person's decision-making across time.

A contradiction requires the SAME person to have violated their own stated principle —
not two different principles applied to two different contexts.

STRICT DEFINITION — a valid contradiction must satisfy ONE of:
  (a) DIRECT VIOLATION: They stated "I always/never do X" and then demonstrably did the opposite in another decision
  (b) BROKEN PREREQUISITE: They stated "I require Y before deciding" and then decided without Y
  (c) LOGICAL INCOMPATIBILITY: Principle A and Principle B are logically irreconcilable — not just different in tone or emphasis

AUTOMATIC DISQUALIFIERS — do NOT flag these:
  - Two cautious approaches applied to two different decision types (both being cautious ≠ contradiction)
  - Different frameworks for different stakes (more rigorous for bigger decisions is rational, not contradictory)
  - Context shift (career decision vs financial decision can legitimately use different criteria)
  - One principle being more specific than another (specificity ≠ contradiction)
  - Two process requirements that could both be true simultaneously

SEVERITY — apply the same strict bar to all severity levels:
  "sharp":   The violation is direct and explicit. "I stated X" + "I then did not-X"
  "notable": The tension is real and specific — not just two cautious instincts phrased differently
  "forming": Only 2 data points but the directional conflict is structurally clear, not interpretive

Before flagging anything as "notable" or "forming", ask: could both principles be true at the same time?
If yes — it is NOT a contradiction. Do not flag it.

Rules:
- Max 3 contradictions total — quality over quantity — return [] if none meet the bar
- Category must be one of: risk_tolerance, urgency, stakeholder, reversibility, process, evidence, autonomy
- Return ONLY valid JSON. No markdown, no preamble.

Output format:
[
  {
    "principleText": "...",
    "principleSessionId": "...",
    "violationText": "...",
    "violationSessionId": "...",
    "severity": "sharp" | "notable" | "forming",
    "category": "..."
  }
]

Principles by session:
${principles.map(s => `
SESSION ${s.sessionId.slice(0, 8)} — "${s.decisionText.slice(0, 80)}" (${s.createdAt.slice(0, 10)})
Principles:
${s.principles.map(p => `  - ${p}`).join('\n')}
`).join('\n')}
`.trim()

// ── Main entry point ──────────────────────────────────────────────────────────

export async function detectContradictions(
  evidence: SessionEvidence[],
): Promise<ContradictionRaw[]> {
  if (evidence.length < 3) {
    // Fewer than 3 sessions with evidence — not enough signal
    return []
  }

  // Cap at 30 sessions for token budget
  const capped = evidence.slice(-30)

  // ── Pass 1: Extract principles ────────────────────────────────────────────
  let extracted: ExtractedPrinciple[] = []

  try {
    const raw1 = await createCompletion(PASS1_PROMPT(capped), 1200, { provider: 'anthropic' })
    const clean1 = raw1.replace(/```json|```/g, '').trim()

    const parsed1 = JSON.parse(clean1) as Array<{ sessionId: string; principles: string[] }>

    extracted = parsed1
      .map(item => {
        const session = capped.find(s => s.sessionId.startsWith(item.sessionId) || item.sessionId.startsWith(s.sessionId.slice(0, 8)))
        if (!session) return null
        return {
          sessionId:    session.sessionId,
          decisionText: session.decisionText,
          createdAt:    session.createdAt,
          principles:   (item.principles ?? []).filter(p => typeof p === 'string' && p.trim().length > 10),
        }
      })
      .filter((x): x is ExtractedPrinciple => x !== null && x.principles.length > 0)
  } catch (err) {
    console.error('[contradiction-detector] Pass 1 parse error:', err)
    return []
  }

  if (extracted.length < 2) {
    // Need principles from at least 2 different sessions to find contradictions
    return []
  }

  // ── Pass 2: Detect contradictions ─────────────────────────────────────────
  try {
    const raw2 = await createCompletion(PASS2_PROMPT(extracted), 800, { provider: 'anthropic' })
    const clean2 = raw2.replace(/```json|```/g, '').trim()

    const parsed2 = JSON.parse(clean2) as ContradictionRaw[]

    if (!Array.isArray(parsed2)) return []

    return parsed2
      .filter(c =>
        typeof c.principleText      === 'string' &&
        typeof c.principleSessionId === 'string' &&
        typeof c.violationText      === 'string' &&
        typeof c.violationSessionId === 'string' &&
        ['sharp', 'notable', 'forming'].includes(c.severity)
      )
      .slice(0, 3)  // cap at 3
  } catch (err) {
    console.error('[contradiction-detector] Pass 2 parse error:', err)
    return []
  }
}
