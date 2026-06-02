// lib/independence-score.ts
// ── Mirror Module: Decision Independence Score (Sprint 7c — v2) ───────────────
//
// Measures whether a user is incorporating Quorum's reasoning frameworks
// in their own thinking — unprompted. Derived from examiner_responses text
// across all sessions for a given user_id.
//
// v2 fixes (vs original):
//
//   1. REALISTIC CEILING normalization.
//      Theoretical max is 70pts (all 9 signals firing). In practice a strong
//      response hits 3–4 signals ≈ 30–35pts. Normalizing against 70 makes
//      good responses score ~40/100. We normalize against REALISTIC_MAX (35)
//      so a good response scores 80–90 and a great one hits 100 (capped).
//
//   2. SKIP sessions with no examiner responses from the average.
//      Sessions run before Sprint 3, or where the user fully skipped the
//      Examiner, score null and are excluded. Pre-existing zero-response
//      sessions no longer suppress the score permanently.
//
//   3. BROADER signal patterns.
//      More natural phrasings caught. Threshold for response_depth lowered
//      from 80 to 60 words.
//
//   4. LOGGING per session.
//      Railway logs show exactly which signals fired, raw score, normalized
//      score, and word count per response.
// ─────────────────────────────────────────────────────────────────────────────

import { createServiceClient } from '@/lib/supabase'
import { decrypt }             from '@/lib/encryption'

// ── Realistic ceiling ─────────────────────────────────────────────────────────
// A strong, genuinely engaged response hits 3–4 signals.
// 35pts ≈ worst_case(10) + stakeholder(10) + depth(5) + answered(5) + one more.
// Above this ceiling is capped at 100.

const REALISTIC_MAX = 35

// ── Signal definitions ────────────────────────────────────────────────────────

const SIGNALS = {
  worst_case_framing: {
    points: 10,
    detect: (text: string) =>
      /worst[\s-]case|if this (fails?|doesn.t work|goes wrong|blows? up)|downside|what (goes|could go) wrong|catastrophic|biggest risk|risk here is|what I.?m worried|what worries me|could backfire|could blow|go sideways|what if (it|this|everything)|main (concern|fear|risk)|most concerned about/i
        .test(text),
  },

  stakeholder_surfacing: {
    points: 10,
    detect: (text: string, decisionText: string) => {
      const matches = text.match(
        /\b(my |our )?(partner|spouse|wife|husband|co[\s-]?founder|investor|board|team|family|children|kids|parent|parents|mentor|colleague|employee|staff|shareholder|cofound)/gi,
      ) ?? []
      if (matches.length === 0) return false
      return matches.some(m => !decisionText.toLowerCase().includes(m.toLowerCase().trim()))
    },
  },

  deadline_questioning: {
    points: 10,
    detect: (text: string) =>
      /is (the |this )?(deadline|timeline|date) (real|fixed|flexible|firm|arbitrary|negotiable|self.imposed)|who (set|decided|chose|picked) (this|the|that) (deadline|date|timeline)|can (we|I) (push|delay|extend|move|shift|negotiate|adjust)|why (by |that |this )?(date|deadline|time|month|week)|is (this|it|that) really urgent|artificial(ly)? urgent|manufactured urgency|does it (really|actually) need to be|timeline (negotiable|flexible|arbitrary|self.imposed)|why (now|the rush|so soon)/i
        .test(text),
  },

  values_outcome_separation: {
    points: 8,
    detect: (text: string) =>
      /(financially|money[\s-]?wise|economically|from a (financial|money|returns?) (perspective|standpoint)).{0,80}(but|vs\.?|versus|however|whereas|although|yet|still).{0,80}(personally|identity|who I am|what I (want|believe|value|care about)|my values?|my sense of)/i
        .test(text)
      || /(what (feels|is|seems) right|my values?|what I believe|what matters to me|what I care about).{0,80}(vs\.?|versus|over|above|despite|against|and yet).{0,80}(financial|profit|returns?|money|numbers?|the math)/i
        .test(text)
      || /separate (the )?(financial|money|economic).{0,60}(from|and) (the )?(personal|emotional|identity|values?|what I want|what I need)/i
        .test(text),
  },

  premortem_thinking: {
    points: 8,
    detect: (text: string) =>
      /if (I|we) look back|in (2|3|5|two|three|five) years?|assuming (this|it) (goes wrong|fails?|doesn.t work|blows up)|what would (have to be|need to be) true|imagine (it|this) (failing|fail)|post[\s-]?mortem|looking back from|future (me|self|version)|what (would I|will I) (regret|wish)|if this (goes|went) wrong|a year from now|six months from now|play (this|it) forward/i
        .test(text),
  },

  counter_questioning: {
    points: 7,
    detect: (text: string) => {
      const sentences = text.split(/(?<=[.!])\s+/)
      return sentences.some(s => s.trim().endsWith('?') && s.trim().length > 12)
    },
  },

  cross_session_reference: {
    points: 7,
    detect: (text: string) =>
      /last time|when I (did|made|took|tried|faced|went through)|similar to (my|a|the|when)|previously|before (I|we) (did|made|decided)|I.ve (done|seen|been|faced|gone through) (this|something like this)|same (pattern|mistake|situation|thing) (before|again|as)|I (remember|recall) when/i
        .test(text),
  },

  response_depth: {
    points: 5,
    detect: (text: string) => text.trim().split(/\s+/).filter(Boolean).length >= 60,
  },

  answered_not_skipped: {
    points: 5,
    detect: (text: string) => text.trim().length > 15,
  },
} as const

type SignalKey = keyof typeof SIGNALS

// ── Per-response scoring ──────────────────────────────────────────────────────

function scoreResponse(
  responseText: string,
  decisionText: string,
): { signals: Record<SignalKey, boolean>; rawScore: number; normalizedScore: number; wordCount: number } {
  const text = responseText ?? ''
  const signals = {} as Record<SignalKey, boolean>
  let rawScore = 0

  for (const [key, signal] of Object.entries(SIGNALS) as [SignalKey, (typeof SIGNALS)[SignalKey]][]) {
    const fired = (signal.detect as (t: string, d: string) => boolean)(text, decisionText)
    signals[key] = fired
    if (fired) rawScore += signal.points
  }

  return {
    signals,
    rawScore,
    normalizedScore: Math.min(100, Math.round((rawScore / REALISTIC_MAX) * 100)),
    wordCount:       text.trim().split(/\s+/).filter(Boolean).length,
  }
}

// ── Per-session aggregation ───────────────────────────────────────────────────
// Returns null for sessions with no responses — excluded from average.

function scoreSession(
  responses: Array<{ response_text: string | null; question_order: number }>,
  decisionText: string,
  sessionId: string,
): number | null {
  const answered = responses.filter(
    r => r.response_text && r.response_text.trim().length > 0,
  )

  if (answered.length === 0) {
    console.log(`[IndependenceScore] ${sessionId.slice(0, 8)}: no responses — excluded`)
    return null
  }

  const scores = answered.map(r => {
    const result    = scoreResponse(r.response_text!, decisionText)
    const fired     = Object.entries(result.signals).filter(([, v]) => v).map(([k]) => k)
    console.log(
      `[IndependenceScore] ${sessionId.slice(0, 8)} Q${r.question_order}: ` +
      `raw=${result.rawScore}/${REALISTIC_MAX} norm=${result.normalizedScore} ` +
      `words=${result.wordCount} fired=[${fired.join(', ') || 'none'}]`,
    )
    return result
  })

  const avg             = scores.reduce((s, r) => s + r.normalizedScore, 0) / scores.length
  const completionBonus = answered.length >= 3 ? 10 : 0  // flat 10pt bonus for full completion
  const sessionScore    = Math.min(100, Math.round(avg + completionBonus))

  console.log(`[IndependenceScore] ${sessionId.slice(0, 8)}: session_score=${sessionScore} (avg=${Math.round(avg)} bonus=${completionBonus})`)
  return sessionScore
}

// ── Rolling weighted average ──────────────────────────────────────────────────

const DECAY = 0.85

function weightedAverage(scores: number[]): number {
  if (scores.length === 0) return 0
  const n = scores.length
  let weightedSum = 0
  let totalWeight = 0
  for (let i = 0; i < n; i++) {
    const weight = Math.pow(DECAY, n - 1 - i)
    weightedSum += scores[i] * weight
    totalWeight += weight
  }
  return Math.round(weightedSum / totalWeight)
}

// ── Score band ────────────────────────────────────────────────────────────────

export interface ScoreBand {
  label:          string
  interpretation: string
}

export function getScoreBand(score: number): ScoreBand {
  if (score >= 75) return {
    label:          'Judgment compounding',
    interpretation: 'You\'re applying structured thinking before you even open Quorum — the frameworks are becoming yours.',
  }
  if (score >= 50) return {
    label:          'Reasoning visibly shifting',
    interpretation: 'Quorum\'s approach is starting to show up in how you frame questions before the analysis begins.',
  }
  if (score >= 25) return {
    label:          'Frameworks starting to appear',
    interpretation: 'Some signals of structured thinking are emerging, though not yet consistent across decisions.',
  }
  return {
    label:          'Using Quorum as a report generator',
    interpretation: 'Your reasoning in the Examiner phase is minimal — the frameworks aren\'t yet showing up unprompted.',
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface IndependenceResult {
  score:         number
  delta:         number | null
  band:          ScoreBand
  sessionCount:  number
  scoredCount:   number
  sessionScores: (number | null)[]
  calculatedAt:  string
}

export async function calculateIndependenceScore(
  userId: string,
): Promise<IndependenceResult | null> {
  const supabase = createServiceClient()

  const { data: sessions } = await supabase
    .from('sessions')
    .select('id, decision_text, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (!sessions || sessions.length === 0) return null

  const sessionIds = sessions.map(s => s.id)

  const { data: allResponses } = await supabase
    .from('examiner_responses')
    .select('session_id, response_text, question_order')
    .in('session_id', sessionIds)

  const bySession = new Map<string, Array<{ response_text: string | null; question_order: number }>>()
  for (const r of allResponses ?? []) {
    if (!bySession.has(r.session_id)) bySession.set(r.session_id, [])
    bySession.get(r.session_id)!.push({
      response_text: decrypt(r.response_text) ?? null,
      question_order: r.question_order,
    })
  }

  const rawSessionScores: (number | null)[] = sessions.map(s =>
    scoreSession(bySession.get(s.id) ?? [], decrypt(s.decision_text) ?? '', s.id),
  )

  const scoredSessions = rawSessionScores.filter((s): s is number => s !== null)

  if (scoredSessions.length === 0) return null

  const score = weightedAverage(scoredSessions)

  let delta: number | null = null
  if (scoredSessions.length >= 2) {
    const lookback      = Math.min(5, scoredSessions.length - 1)
    const baseline      = scoredSessions.slice(0, scoredSessions.length - lookback)
    const baselineScore = weightedAverage(baseline)
    delta = score - baselineScore
    console.log(`[IndependenceScore] ${userId.slice(0, 8)}: final=${score} delta=${delta} baseline=${baselineScore}`)
  } else {
    console.log(`[IndependenceScore] ${userId.slice(0, 8)}: final=${score} (first scored session)`)
  }

  return {
    score,
    delta,
    band:          getScoreBand(score),
    sessionCount:  sessions.length,
    scoredCount:   scoredSessions.length,
    sessionScores: rawSessionScores,
    calculatedAt:  new Date().toISOString(),
  }
}
