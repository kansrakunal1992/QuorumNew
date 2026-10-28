// lib/chat-intake-quantity.ts
// ── Tap-first answers for "how much / how long / how many / yes-or-no" questions (pure) ──
//
// Any question that needs an amount or a one-word answer is the slowest thing to type on a phone. When the planner (or a
// slot) gave no tappable options for such a question, this supplies a small, GENERIC set — ranges that make sense for the
// kind of quantity being asked, never currency amounts or anything domain-specific. Typing stays available, and "Not
// sure" is added by the screen as before, so a chip is only ever a shortcut.
//
// Deliberately conservative: a question that doesn't clearly match a pattern gets nothing (as it did before), and
// anything that offers a choice ("A or B?") is left alone. Chips are short (<= 34 chars) and at most 5, matching
// sanitizeChips in lib/chat-intake-brief.ts.

const PERCENT   = /(\bpercent(age)?\b|%)/
const ASKS_HOW_MUCH = /\b(how much|by how much|what)\b/
const MONTHS    = /\bhow many (months|weeks)\b|\bhow long (could|can|would|will|do) (you|your savings|that|it|this)\b.*\b(last|cover|live|survive|manage|stretch)\b|\brunway\b.*\b(how long|how many|months)\b|\bhow (long|many months) (of )?(runway|savings)\b/
const TENURE    = /\bhow long (have|has|had) (you|they|she|he)\b/
const HEADCOUNT = /\bhow many (people|dependents?|kids|children|employees|team members|co-?founders|reports|customers|clients)\b/
const WH_WORD   = /\b(what|which|how|when|where|why|who|whom|whose)\b/
const YES_NO    = /^(do|does|did|have|has|had|are|is|was|were|will|would|could|can|should|am)\b/

export function quantityChipsFor(question: string | null | undefined): string[] {
  const q = String(question ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
  if (!q) return []

  // "(exact or percentage)" is a hint about HOW to answer, not a choice between two things.
  if (PERCENT.test(q) && ASKS_HOW_MUCH.test(q)) return ['Under 10%', '10\u201325%', '25\u201350%', 'Over 50%']
  if (MONTHS.test(q))    return ['Under 3 months', '3\u20136 months', '6\u201312 months', 'Over a year']
  if (TENURE.test(q))    return ['Under a year', '1\u20133 years', '3\u20135 years', 'Over 5 years']
  if (HEADCOUNT.test(q)) return ['None', '1\u20132', '3\u20135', 'More than 5']

  // A plain yes/no question: starts with an auxiliary verb, offers no choice, asks for nothing else.
  if (q.length <= 180 && YES_NO.test(q) && !/\bor\b/.test(q) && !WH_WORD.test(q)) return ['Yes', 'No']

  return []
}
