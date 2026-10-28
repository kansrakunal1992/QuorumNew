// lib/chat-intake-priority.ts
// ── A suggestion for "What matters most here?", from the person's own words (pure) ──
//
// The confirm screen asks where you lean and what matters most. The second is often already evident from what the
// person said in the chat ("more pay", "stability", "the kids"), so it is PRE-SUGGESTED: shown selected, labelled as a
// suggestion, one tap to change — and only when the evidence is clear. The person's tap on Convene is what saves it.
//
// Rules, because this value feeds Quorum's prediction and Mirror:
//   • built ONLY from the person's own messages and taps — never from Quorum's own summary or reading of them;
//   • a suggestion needs real evidence (at least two hits) and a clear lead (at least two) over the runner-up, so a
//     borderline sentence gets no suggestion rather than a nudge; otherwise none is
//     made and the person chooses, exactly as before;
//   • this module never suggests the LEAN (where they lean is their own gut reaction and is the baseline for
//     "you changed your mind" — it stays a manual choice);
//   • returns only a value from PRIORITIES (lib/chat-intake-lean.ts), or null.

import { PRIORITIES } from '@/lib/chat-intake-lean'

type Value = 'career_growth' | 'security' | 'money' | 'time_freedom' | 'family'

const SIGNALS: Record<Value, RegExp> = {
  security:     /\b(stabilit\w*|stable|secur\w+|safe\w*|steady|predictab\w+|routine|runway|savings|cushion|laid off|layoffs?|protect\w*)\b/gi,
  money:        /(\b(pay|paid|salary|ctc|money|income|raise|compensation|earn\w*|afford\w*|debt|loan|bonus|equity|price|cost|budget|invest\w*|lakhs?|crores?)\b|[%$\u20B9\u00A3\u20AC])/gi,
  career_growth:/\b(growth|grow|promotion|promoted|title|career|skills?|learn\w*|opportunit\w+|ambition|ambitious|leadership|scope|impact|trajectory)\b/gi,
  time_freedom: /\b(time|freedom|flexib\w+|remote|hours|burn\w*out|balance|commute|autonomy|independen\w+|weekends?|leisure)\b/gi,
  family:       /\b(family|kids?|child|children|wife|husband|spouse|partner|parents?|mother|father|mom|dad|baby|pregnan\w+)\b/gi,
}

export const MIN_HITS = 2
export const MIN_LEAD = 2

/** The most evident priority in what the person said, or null when it is not clear. */
export function suggestPriority(userWords: string[] | null | undefined): string | null {
  const text = (userWords ?? []).join(' \n ')
  if (!text.trim()) return null
  const scored = (Object.keys(SIGNALS) as Value[])
    .map(v => ({ v, n: (text.match(SIGNALS[v]) ?? []).length }))
    .sort((a, b) => b.n - a.n)
  const [top, next] = scored
  if (top.n < MIN_HITS || top.n - (next?.n ?? 0) < MIN_LEAD) return null
  return PRIORITIES.some(p => p.value === top.v) ? top.v : null
}
