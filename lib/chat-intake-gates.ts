// lib/chat-intake-gates.ts
//
// Two things the Examiner used to do AFTER the chat — now done INSIDE it, without a new
// stage and without raising the number of questions people are asked.
//
// ── A. Examiner coverage ────────────────────────────────────────────────────────────────
// The Examiner always asks E0 (inward / feeling) and C0 (forward / what good looks like),
// then a rule question, then maybe S0 (thin brief). The chat only ever recorded `gutFeeling`
// and `successPicture` if the person happened to volunteer them (lib/chat-intake-planner.ts),
// so E0/C0 were nearly always re-asked in a second stage after the chat.
//
//   E0 + C0  → ONE combined "outlook" probe, asked in the chat's existing single
//              "smart friend" turn (only when neither is on file, only when stakes aren't
//              low) — one chat turn replaces two Examiner questions.
//   S0       → already satisfied: the chat IS the deepening (the brief must be filled).
//   R7       → the existing "what would change your mind" probe covers its intent.
//   rule Q   → still asked by the Examiner (needs the ontology tag, which only exists
//              after the checkpoint).
//
// ── B. Gating on an unresolved upstream decision ───────────────────────────────────────
// Examiner rule R1 ("what is the upstream decision that must resolve before this one becomes
// yours to make?") only fired AFTER the chat — after the Council had already run — and then
// blocked synthesis ("use Reanalyze once it is"). Here the dependency is caught while the
// person is still talking, confirmed once, and the person chooses: keep going (provisional)
// or park this decision until the upstream one is settled. Downstream the Examiner reads the
// recorded choice so it never blocks them a second time.
//
// Pure + dependency-free on purpose (same rule as lib/chat-intake-brief.ts): imported by
// server routes AND client components.

export const DEPENDS_LINE_PREFIX = 'This hinges on another decision still open: '
export const OUTLOOK_KEY = 'outlook'

// ── A. Outlook probe (E0 + C0 in one turn) ───────────────────────────────────────────────
export const OUTLOOK_ASK =
  'Picture it a year from now and it worked out. What does that look like — and what\u2019s the part that still worries you?'

export interface OutlookState {
  gutFeeling?:     string | null
  successPicture?: string | null
  facts?:          Record<string, string>
}

/** True once EITHER Examiner anchor is on file — the Examiner then only needs a one-tap confirm. */
export function outlookCovered(s: OutlookState): boolean {
  return !!(s.gutFeeling?.trim() || s.successPicture?.trim() || s.facts?.[OUTLOOK_KEY]?.trim())
}

/** Store the single free-text answer where both Examiner anchors can see it (never overwrites). */
export function applyOutlookAnswer<T extends OutlookState>(s: T, answer: string): T {
  const t = answer.replace(/\s+/g, ' ').trim().slice(0, 240)
  if (!t) return s
  return {
    ...s,
    gutFeeling:     s.gutFeeling?.trim()     ? s.gutFeeling     : t,
    successPicture: s.successPicture?.trim() ? s.successPicture : t,
    facts:          { ...(s.facts ?? {}), [OUTLOOK_KEY]: t },
  }
}

// ── B. Upstream-decision gate ────────────────────────────────────────────────────────────
export type DependencyChoice = 'keep_going' | 'park_this'
export interface DependencyState { text: string; choice?: DependencyChoice }

export const DEPENDENCY_CHIPS: readonly string[] = [
  'Keep going \u2014 treat it as unknown for now',
  'Park this until I\u2019ve decided that',
]

const tidy = (s: string): string =>
  s.replace(/\s+/g, ' ').replace(/^[\s,;:\-\u2014"\u201C]+|[\s,;:\-\u2014"\u201D.!?]+$/g, '').trim()

// Deliberately CONSERVATIVE: only phrasings where the person themself says another DECISION
// (or its answer) comes first. External events ("it will be acquired next year") are NOT
// gates — they are unknowns, and stay in the brief as such. A false positive costs one tap,
// because the gate is a single confirmable question, never an automatic block.
// A capture ends at sentence punctuation, a comma, or a clause connector ("...whether to sell the flat, then...").
const END = String.raw`(?:[.;!?\n]|,\s|\s+(?:then|so|and|but|because|i'll|i\s+will|i\s+can|i\s+would|i\s+might)\b|$)`
const PATTERNS: RegExp[] = [
  new RegExp(String.raw`\b(?:depends?|depending|hinges?|hinging|hangs?|contingent)\s+(?:entirely\s+|largely\s+|mostly\s+)?on\s+(?:whether\s+|if\s+)?(?:i\s+)?(.{6,90}?)${END}`, 'i'),
  new RegExp(String.raw`\b(?:until|before)\s+i\s+(?:decide|figure\s+out|know|hear|find\s+out|choose|settle)\s+(?:whether\s+|if\s+|about\s+|on\s+)?(.{4,80}?)${END}`, 'i'),
  new RegExp(String.raw`\b(?:once|after)\s+i(?:'ve|\s+have)?\s+(?:decided|chosen|settled|sorted\s+out|figured\s+out)\s+(?:whether\s+|if\s+|about\s+|on\s+)?(.{4,80}?)${END}`, 'i'),
  new RegExp(String.raw`\bwaiting\s+(?:on|for)\s+(?:a\s+|the\s+|my\s+)?(?:decision|answer|verdict)\s+(?:on|about|from)\s+(.{4,80}?)${END}`, 'i'),
  new RegExp(String.raw`\bfirst\s+i\s+(?:need|have|must)\s+to\s+(?:decide|figure\s+out|choose)\s+(?:whether\s+|if\s+|about\s+|on\s+)?(.{4,80}?)${END}`, 'i'),
]

/** The upstream decision the person named, or null. */
export function detectUpstreamDecision(raw: string): string | null {
  // Phones auto-insert curly quotes ("I\u2019ve"); the patterns are written with straight ones.
  const text = raw.replace(/[\u2018\u2019]/g, "'")
  for (const re of PATTERNS) {
    const m = re.exec(text)
    if (m?.[1]) {
      const t = tidy(m[1])
      if (t.split(' ').length >= 2 && t.length <= 90) return t
    }
  }
  return null
}

export function dependencyQuestion(dep: string): string {
  return `It sounds like this hinges on \u201C${dep}\u201D \u2014 and that\u2019s still open. Do you want to keep going with it treated as unknown, or park this one until you\u2019ve settled that?`
}

export function parseDependencyChoice(answer: string): DependencyChoice | null {
  const a = answer.toLowerCase()
  if (/\bpark\b|\bhold\b|\blater\b|\bsettle\b.*\bfirst\b|decide that first|\bpause\b/.test(a)) return 'park_this'
  if (/keep going|carry on|continue|go on|treat it as unknown|\bproceed\b|\bnot now\b|move on/.test(a)) return 'keep_going'
  return null
}

export function parkedReply(dep: string): string {
  return `Parked \u2014 I\u2019ll hold this on your Watchlist until you\u2019ve settled \u201C${dep}\u201D. When you\u2019re ready, bring that one to me first; it\u2019s the one that unlocks this.`
}

// ── Reading the recorded results back out of a session's context_text ───────────────────
// (app/api/examiner/route.ts only has context_text, not the chat's decision_state.)
const GUT_PREFIX     = 'How they feel about it: '
const SUCCESS_PREFIX = 'What a good outcome looks like to them: '

export interface ContextCoverage {
  gut?:        string
  success?:    string
  dependency?: { text: string; choice: DependencyChoice | null }
}

export function readCoverageFromContext(contextText: string): ContextCoverage {
  const out: ContextCoverage = {}
  for (const raw of contextText.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith(GUT_PREFIX))      out.gut     = line.slice(GUT_PREFIX.length).trim()
    else if (line.startsWith(SUCCESS_PREFIX)) out.success = line.slice(SUCCESS_PREFIX.length).trim()
    else if (line.startsWith(DEPENDS_LINE_PREFIX)) {
      const rest = line.slice(DEPENDS_LINE_PREFIX.length)
      const m = rest.match(/^(.*?)(?:\s+\((keep_going|park_this)\))?$/)
      if (m) out.dependency = { text: m[1].trim(), choice: (m[2] as DependencyChoice | undefined) ?? null }
    }
  }
  return out
}

export function dependencyContextLine(dep: DependencyState | null | undefined): string | null {
  if (!dep?.text) return null
  return `${DEPENDS_LINE_PREFIX}${dep.text}${dep.choice ? ` (${dep.choice})` : ''}`
}
