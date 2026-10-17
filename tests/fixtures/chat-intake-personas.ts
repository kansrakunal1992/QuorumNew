// tests/fixtures/chat-intake-personas.ts
// ── Persona set for the adaptive intake ──────────────────────────────────────
// Each persona is a scripted person: what they open with, what the model would
// pull out of that opening, and how they answer when asked. The tests replay
// them through the REAL turn logic (lib/chat-intake-turn.ts) with a scripted
// stand-in for the model, so what is being pinned is the orchestration — how
// many questions each kind of person is asked, that nothing is asked twice,
// and that every conversation ends with a complete-or-flagged brief.
//
// `maxQuestions` are the product targets from the v7 plan:
//   power user  : 0–2 questions
//   rambler     : ≤ 3
//   novice      : every required specific known or flagged within ~6 questions
//   evasive     : never nagged — each slot asked once, ends with flagged unknowns
//   emotional   : still progresses even when the model extracts nothing

import type { DecisionKind } from '../../lib/types'

export type Behavior = 'normal' | 'evasive' | 'emotional'

export interface Persona {
  id:            string
  opening:       string
  kind:          DecisionKind
  statement:     string
  /** What the model would extract from the opening (slot key -> fact). */
  volunteered:   Record<string, string>
  /** What they say when asked about a slot (normal behaviour). */
  answers:       Record<string, string>
  behavior:      Behavior
  walkthrough?:  boolean
  /** Question the model's "sharp friend" check would propose, if any. */
  smartQuestion?: string
  maxQuestions:  number
  maxExchanges:  number
}

const RICH_OPENING =
  'I am a product manager at HDFC in Mumbai, 4 years in. I have an offer from a Bengaluru startup at 40 lakh with equity, versus staying at 28 lakh. I have about 9 months of savings, my partner works in Mumbai, and the offer expires in two weeks. My manager is also pushing me to take a bigger team, so I am torn.'

export const PERSONAS: Persona[] = [
  {
    id: 'power-user-job-offer',
    opening: RICH_OPENING,
    kind: 'job_offer',
    statement: 'Whether to take the Bengaluru startup offer or stay at HDFC',
    volunteered: {
      offer: '40 lakh + equity at a Bengaluru startup vs 28 lakh now',
      leaving: 'Mumbai, partner, stable bank job',
      hesitation: 'partner is in Mumbai; manager pushing a bigger team',
      deadline: 'expires in two weeks',
      alternatives: 'could negotiate or accept the bigger team',
    },
    answers: {},
    behavior: 'normal',
    smartQuestion: 'What would make you stay?',
    maxQuestions: 2, maxExchanges: 4,
  },
  {
    id: 'rambler-relocation',
    opening: 'So I have been in Pune for six years and honestly I keep thinking about moving to Berlin, my sister lives there, I work remote for a US company so work is fine, I would go alone, it just feels like now or never because my lease ends in March and I have been stuck on this for months',
    kind: 'relocation',
    statement: 'Whether to move from Pune to Berlin',
    volunteered: {
      from_to: 'Pune to Berlin',
      work_plan: 'same remote job for a US company',
      who_moves: 'just me; sister already in Berlin',
      why_now: 'lease ends in March',
    },
    answers: { alternatives: 'maybe try three months first' },
    behavior: 'normal',
    maxQuestions: 3, maxExchanges: 6,
  },
  {
    id: 'novice-quit-job',
    opening: 'I want to quit my job',
    kind: 'career_exit',
    statement: 'Whether to quit my job',
    volunteered: {},
    answers: {
      why_now: 'my manager took credit for my project',
      role: 'analyst at a bank, 3 years',
      next_step: 'Looking for one',
      runway: '3\u20136 months',
      alternatives: 'ask for a transfer',
    },
    behavior: 'normal',
    smartQuestion: 'Is the manager the only problem?',
    maxQuestions: 7, maxExchanges: 9,
  },
  {
    id: 'novice-vague-move',
    opening: 'Should I move to a different city',
    kind: 'relocation',
    statement: 'Whether to move to a different city',
    volunteered: {},
    answers: {
      from_to: 'Jaipur to Bengaluru',
      work_plan: 'Not sorted yet',
      who_moves: 'Just me',
      why_now: 'Something specific happened',
      alternatives: 'Trial it first',
    },
    behavior: 'normal',
    maxQuestions: 7, maxExchanges: 9,
  },
  {
    id: 'walkthrough-novice',
    opening: 'idk something about money',
    kind: 'money',
    statement: 'A money decision',
    volunteered: {},
    answers: {
      amount: 'about 5 lakh, to put into a flat',
      downside: 'It would hurt',
      horizon: '5+ years',
      alternatives: 'Start smaller',
    },
    behavior: 'normal',
    walkthrough: true,
    maxQuestions: 6, maxExchanges: 9,
  },
  {
    id: 'evasive-quit-job',
    opening: 'I want to quit my job',
    kind: 'career_exit',
    statement: 'Whether to quit my job',
    volunteered: {},
    answers: {},
    behavior: 'evasive',
    smartQuestion: 'What would make you stay?',
    maxQuestions: 7, maxExchanges: 9,
  },
  {
    id: 'emotional-relationship',
    opening: 'I cannot do this anymore',
    kind: 'relationship',
    statement: 'Whether to end a relationship',
    volunteered: {},
    answers: {},
    behavior: 'emotional',
    maxQuestions: 7, maxExchanges: 9,
  },
]
