// lib/chat-intake-reflection.ts
// ── Natural Intake (v9) — the "give something back" line (pure) ──────────────
//
// Between questions Quorum may say ONE short thing that is worth reading: a
// distinction, a connection between two answers, a possible tension, or why the
// next question matters. It must be grounded in what the person actually said or
// tapped, stay provisional, and never decide for them.
//
// The model proposes it (planner "reflection" field); this module decides whether
// it is good enough to show. A rejected reflection is simply omitted — the
// question goes out alone, as before — and the reason is reported to analytics
// so the rejection rate can be watched. Nothing is invented as a substitute:
// a generic fallback line ("That helps.") is exactly what the brief rules out.

// Internal machinery only. "the Council" is Quorum's own public word for what happens next, so it is allowed here.
const JARGON = /\b(examiner|ontology|checkpoint|slot|slots|brief|structural read|rule engine|synthesis|persona)\b/i

import { canon } from '@/lib/chat-intake-depth'

// Openers that are acknowledgement, not value.
const GENERIC_ACK = /^\s*(got it|thanks|thank you|makes sense|understood|great|good|okay|ok|sure|noted|i see|alright|right|that helps|that's helpful|that is helpful|interesting|absolutely)\b/i

// Premature advice.
const RECOMMENDS = /\b(you should|you ought|i recommend|i suggest|i'd (advise|recommend|suggest)|the best (option|choice|move|path)|you must|definitely|obviously|clearly the right)\b/i

// Invented motives / mind-reading stated as fact.
const MIND_READING = /\b(you('| a)re (really |secretly |just )?(afraid|scared|terrified|ashamed|running away|avoiding|in denial|burnt out|burned out)|deep down|what you really (want|feel|need)|you secretly|you obviously (want|feel))\b/i

// Provisional wording: it may, it sounds like, I can't tell yet...
const HEDGE = /\b(may|might|could|seems?|sounds? like|suggests?|possibly|perhaps|looks like|one reading|i can'?t tell|not sure yet|it'?s possible|can be|often|depends)\b/i

// Shape of something useful: a distinction, tension, connection or reason.
const SHAPE = /\b(but|yet|though|although|however|even if|even though|not just|not only|more about|less about|whether|while|whereas|rather than|two things|different|separate|apart|tension|both|either|between|depends|tangled|pull|pulls|pulling|at once|versus|instead of|which would|that would change|changes what|matters because|so the|before the council)\b/i

const STOP = new Set('the a an and or of to in on for with is are was were be been it this that these those you your yours i my me we our they their them what when where which who how why would could should can will do does did have has had about into from than then there here just also very really any some more most such not no yes'.split(' '))
// Short domain words like "job" must count for grounding; filler like "may" / "two" must not dilute the label-echo ratio.
const wordsMin = (t: string, min: number): string[] =>
  t.toLowerCase().replace(/[\u2019']/g, '').split(/[^a-z0-9]+/).filter(w => w.length >= min && !STOP.has(w)).map(canon)
const words = (t: string): string[] => wordsMin(t, 3)

export interface ReflectionContext {
  /** The person's latest message, exactly as sent (labels + their own words). */
  userText:       string
  /** Card labels they just tapped (for the "merely repeats the labels" check). */
  selectedLabels: string[]
  /** Everything else on file: fact values, earlier answers. */
  onFile:         string[]
  /** Hashed word-sets of recent reflections (never text), to reject a near-repeat of something already said. */
  previousPrints?: string[][]
}

const hash = (w: string): string => { let h = 5381; for (let i = 0; i < w.length; i++) h = ((h << 5) + h + w.charCodeAt(i)) | 0; return (h >>> 0).toString(36) }

/** A compact fingerprint of a reflection: hashes of its content words (up to 12). Stored in place of the text. */
export function reflectionPrint(text: string): string[] {
  return [...new Set(words(text))].slice(0, 12).map(hash)
}

export type ReflectionVerdict = { ok: true; text: string } | { ok: false; reason: string }

export function validateReflection(raw: unknown, ctx: ReflectionContext): ReflectionVerdict {
  if (typeof raw !== 'string') return { ok: false, reason: 'none' }
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text) return { ok: false, reason: 'none' }
  const n = text.split(' ').length
  if (n < 8)  return { ok: false, reason: 'too_short' }
  if (n > 48) return { ok: false, reason: 'too_long' }
  if (text.includes('?'))        return { ok: false, reason: 'is_a_question' }
  if (GENERIC_ACK.test(text))    return { ok: false, reason: 'generic_ack' }
  if (JARGON.test(text))         return { ok: false, reason: 'jargon' }
  if (RECOMMENDS.test(text))     return { ok: false, reason: 'recommends' }
  if (MIND_READING.test(text))   return { ok: false, reason: 'mind_reading' }
  if (!HEDGE.test(text))         return { ok: false, reason: 'not_provisional' }
  if (!SHAPE.test(text))         return { ok: false, reason: 'no_distinction' }

  const rw = new Set(words(text))
  const evidence = new Set(words([ctx.userText, ...ctx.selectedLabels, ...ctx.onFile].join(' ')))
  let grounded = 0
  rw.forEach(w => { if (evidence.has(w)) grounded += 1 })
  if (grounded < 2) return { ok: false, reason: 'not_grounded' }

  // Saying nearly the same thing again is not giving something new back.
  const print = reflectionPrint(text)
  for (const prev of ctx.previousPrints ?? []) {
    const have = new Set(prev)
    const same = print.filter(h => have.has(h)).length
    if (print.length >= 4 && same / print.length >= 0.7) return { ok: false, reason: 'repeats_earlier' }
  }

  // Merely repeating what they just tapped is not a reflection.
  const labelWords = new Set(wordsMin(ctx.selectedLabels.join(' '), 4))
  if (labelWords.size >= 3) {
    const rw4 = new Set(wordsMin(text, 4))
    let echo = 0
    rw4.forEach(w => { if (labelWords.has(w)) echo += 1 })
    if (rw4.size > 0 && echo / rw4.size >= 0.7) return { ok: false, reason: 'repeats_labels' }
  }
  return { ok: true, text }
}

/** At most one question turn in a row may go out without a reflection (from the person's second message on). */
export function reflectionDue(exchangeCount: number, turnsSinceReflection: number | undefined): boolean {
  return exchangeCount >= 2 && (turnsSinceReflection ?? 0) >= 1
}

/** The reply the person sees: the reflection (if any), a blank line, then the question. */
export function composeReply(reflection: string | null, question: string): string {
  return reflection ? `${reflection}\n\n${question}` : question
}
