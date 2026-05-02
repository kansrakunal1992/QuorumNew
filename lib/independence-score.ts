// lib/independence-score.ts
// ── Mirror Module: Decision Independence Score (Sprint 7c) ────────────────────
//
// Measures whether a user is incorporating Quorum's reasoning frameworks
// in their own thinking — unprompted. Derived entirely from examiner_responses
// text across all sessions for a given user.
//
// Why examiner responses:
//   The Examiner forces users to write in their own words BEFORE receiving
//   any AI analysis. This makes it the cleanest signal of how they actually
//   reason — not reactive, not self-reported. A user who mentions "worst case"
//   in their Examiner answers without being asked is demonstrating framework
//   absorption. A user who gives one-sentence answers is not.
//
// Score: 0–100 rolling weighted average across all sessions.
//   Recency-weighted: recent sessions contribute more than older ones.
//   Delta: change vs 5 sessions ago (or first session if < 5).
//
// No AI call. Pure signal extraction from text + metadata.
// ─────────────────────────────────────────────────────────────────────────────

import { createServiceClient } from '@/lib/supabase'

// ── Signal definitions ────────────────────────────────────────────────────────
// Each signal detects a specific reasoning behaviour.
// Points are intentionally unequal — depth signals worth more than length.

const SIGNALS = {
  // Names a specific worst-case scenario unprompted
  worst_case_framing: {
    points:  10,
    detect: (text: string) =>
      /worst[\s-]case|if this fails|downside|what goes wrong|if it doesn't work|catastrophic|blow up|go sideways/i.test(text),
  },

  // Surfaces a stakeholder not mentioned in decision text
  stakeholder_surfacing: {
    points:  10,
    detect: (text: string, decisionText: string) => {
      // Look for named people or relationship terms not in the original decision
      const names = text.match(/\b(my |our )?(partner|spouse|wife|husband|co-founder|investor|board|team|family|children|kids|parent|mentor)\b/gi) ?? []
      if (names.length === 0) return false
      // Check they aren't already in the decision text
      return names.some(n => !decisionText.toLowerCase().includes(n.toLowerCase().trim()))
    },
  },

  // Questions the legitimacy of a deadline or external constraint
  deadline_questioning: {
    points:  10,
    detect: (text: string) =>
      /is the deadline real|why (by |that date|then)|can we (push|delay|extend|negotiate)|who set this|is this (really|actually) urgent|manufactured urgency|artificial deadline/i.test(text),
  },

  // Separates financial outcome from identity or values
  values_outcome_separation: {
    points:  8,
    detect: (text: string) =>
      /(financially|money[\s-]wise|economically).{0,40}(but|vs|versus|however|whereas|although).{0,40}(personally|identity|values|who I am|what I believe|my sense of)/i.test(text)
      || /(what (makes|is) right|values|principles).{0,40}(vs|versus|over|above|despite).{0,40}(financial|profit|return|money)/i.test(text),
  },

  // Uses pre-mortem or scenario inversion unprompted
  premortem_thinking: {
    points:  8,
    detect: (text: string) =>
      /if I look back|in (2|3|5|two|three|five) years|assuming this (goes wrong|fails|doesn't work)|what would have to be true|imagine it failed|post[\s-]mortem|looking back from/i.test(text),
  },

  // Asks a counter-question (engaged, not just answering)
  counter_questioning: {
    points:  7,
    detect: (text: string) => {
      // Response contains a genuine question directed outward
      const sentences = text.split(/[.!]/)
      return sentences.some(s => s.trim().endsWith('?') && s.trim().length > 15)
    },
  },

  // Response references a prior decision or personal pattern
  cross_session_reference: {
    points:  7,
    detect: (text: string) =>
      /last time|when I (did|made|took|tried)|similar to (my|a|the|when)|previously|before (I|we)|I've (done|seen|been|faced) this/i.test(text),
  },

  // Elaborated response (depth signal)
  response_depth: {
    points:  5,
    detect: (text: string) => text.trim().split(/\s+/).length >= 80,
  },

  // Answered rather than skipped (baseline engagement)
  answered_not_skipped: {
    points:  5,
    detect: (text: string) => text.trim().length > 20,
  },
} as const

type SignalKey = keyof typeof SIGNALS

// ── Per-response scoring ──────────────────────────────────────────────────────

interface ResponseSignals {
  signals: Record<SignalKey, boolean>
  rawScore: number          // sum of points for signals that fired
  normalizedScore: number   // 0–100
  wordCount: number
}

function scoreResponse(
  responseText: string,
  decisionText: string,
): ResponseSignals {
  const text = responseText ?? ''
  const signals = {} as Record<SignalKey, boolean>
  let rawScore = 0
  const maxPossible = Object.values(SIGNALS).reduce((sum, s) => sum + s.points, 0)

  for (const [key, signal] of Object.entries(SIGNALS) as [SignalKey, typeof SIGNALS[SignalKey]][]) {
    const fired = 'detect' in signal
      ? (signal.detect as (t: string, d: string) => boolean)(text, decisionText)
      : false
    signals[key] = fired
    if (fired) rawScore += signal.points
  }

  return {
    signals,
    rawScore,
    normalizedScore: Math.round((rawScore / maxPossible) * 100),
    wordCount: text.trim().split(/\s+/).filter(Boolean).length,
  }
}

// ── Per-session aggregation ───────────────────────────────────────────────────
// A session can have up to 3 examiner responses.
// Session score = average of response scores (responses that were answered).
// Skipped sessions (no responses) → session score 0.

function scoreSession(
  responses: Array<{ response_text: string | null; question_order: number }>,
  decisionText: string,
): number {
  const answered = responses.filter(r => r.response_text && r.response_text.trim().length > 0)
  if (answered.length === 0) return 0

  const scores = answered.map(r => scoreResponse(r.response_text!, decisionText))
  const avg = scores.reduce((sum, s) => sum + s.normalizedScore, 0) / scores.length

  // Bonus for answering all 3 questions (already a signal, but also a multiplier)
  const completionBonus = answered.length === 3 ? 5 : 0
  return Math.min(100, Math.round(avg + completionBonus))
}

// ── Rolling weighted average ──────────────────────────────────────────────────
// More recent sessions weighted higher.
// Decay factor: each session back is worth 85% of the next more recent one.
// This ensures improvement is visible without being volatile.

const DECAY = 0.85

function weightedAverage(sessionScores: number[]): number {
  if (sessionScores.length === 0) return 0

  // sessionScores[0] = oldest, sessionScores[last] = most recent
  const n = sessionScores.length
  let weightedSum = 0
  let totalWeight = 0

  for (let i = 0; i < n; i++) {
    // i=0 is oldest → lowest weight; i=n-1 is most recent → weight 1.0
    const age = n - 1 - i
    const weight = Math.pow(DECAY, age)
    weightedSum += sessionScores[i] * weight
    totalWeight += weight
  }

  return Math.round(weightedSum / totalWeight)
}

// ── Score band interpretation ─────────────────────────────────────────────────

export interface ScoreBand {
  label: string
  interpretation: string
}

export function getScoreBand(score: number): ScoreBand {
  if (score >= 75) return {
    label: 'Judgment compounding',
    interpretation: 'You\'re applying structured thinking before you even open Quorum — the frameworks are becoming yours.',
  }
  if (score >= 50) return {
    label: 'Reasoning visibly shifting',
    interpretation: 'Quorum\'s approach is starting to show up in how you frame questions before the analysis begins.',
  }
  if (score >= 25) return {
    label: 'Frameworks starting to appear',
    interpretation: 'Some signals of structured thinking are emerging, though not yet consistent across decisions.',
  }
  return {
    label: 'Using Quorum as a report generator',
    interpretation: 'Your reasoning in the Examiner phase is minimal — the frameworks aren\'t yet showing up unprompted.',
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface IndependenceResult {
  score: number
  delta: number | null
  band: ScoreBand
  sessionCount: number
  sessionScores: number[]       // for storage in signals jsonb
  calculatedAt: string
}

export async function calculateIndependenceScore(userId: string): Promise<IndependenceResult | null> {
  const supabase = createServiceClient()

  // ── 1. Fetch all sessions for this user (ordered oldest first) ─────────────
  const { data: sessions } = await supabase
    .from('sessions')
    .select('id, decision_text, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (!sessions || sessions.length === 0) return null

  // ── 2. Fetch all examiner_responses for these sessions in one query ─────────
  const sessionIds = sessions.map(s => s.id)

  const { data: allResponses } = await supabase
    .from('examiner_responses')
    .select('session_id, response_text, question_order')
    .in('session_id', sessionIds)

  const responsesBySession = new Map<string, Array<{ response_text: string | null; question_order: number }>>()
  for (const r of allResponses ?? []) {
    if (!responsesBySession.has(r.session_id)) responsesBySession.set(r.session_id, [])
    responsesBySession.get(r.session_id)!.push(r)
  }

  // ── 3. Score each session ───────────────────────────────────────────────────
  const sessionScores: number[] = sessions.map(session => {
    const responses = responsesBySession.get(session.id) ?? []
    return scoreSession(responses, session.decision_text ?? '')
  })

  // ── 4. Rolling weighted average ────────────────────────────────────────────
  const score = weightedAverage(sessionScores)

  // ── 5. Delta: current score vs score from 5 sessions ago ───────────────────
  let delta: number | null = null
  if (sessionScores.length >= 2) {
    const lookback = Math.min(5, sessionScores.length - 1)
    const baselineScores = sessionScores.slice(0, sessionScores.length - lookback)
    const baselineScore  = weightedAverage(baselineScores)
    delta = score - baselineScore
  }

  return {
    score,
    delta,
    band:          getScoreBand(score),
    sessionCount:  sessions.length,
    sessionScores,
    calculatedAt:  new Date().toISOString(),
  }
}
