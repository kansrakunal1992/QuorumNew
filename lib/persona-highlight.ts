// lib/persona-highlight.ts
// Council card visual pass (round 12): picks the phrase inside a persona's
// one-line <position> that gets the emphasis treatment on the collapsed card.
//
// Why this is a client-side split and not a new tag from the model: every
// <tag> added to persona output has to be stripped correctly by each sink
// that re-implements its own stripping (see tests/persona-tag-wiring-
// guardrail.test.ts — the recurring "raw tag leaked on screen" bug class).
// This never touches the wire format. <position> is already specified in
// lib/personas.ts as "your actual verdict (what they should or should not do)
// and the single most important reason why" — verdict first, reason second —
// so the lead clause IS the part worth emphasising, and a split on the first
// natural break between the two is reliable enough without asking the model
// to mark anything up.
//
// Two shapes are handled:
//   1. "Verdict — reason" (the spec'd shape): the verdict clause up front is
//      emphasised.
//   2. "X isn't the problem — it's Y" (a contrast construction models produce
//      often): the punchline after the dash is what the advisor is actually
//      saying, so that is emphasised instead.
//
// Guarantees:
//   • before + emphasis + after === text, always (no characters added, dropped
//     or reordered), so copy/paste and screen readers see the original
//     sentence.
//   • Returns null — caller renders the sentence plain — whenever no clean
//     break is found. Never emphasises a whole sentence or a fragment too
//     short to be a phrase.
//   • Pure function, no React, no I/O.

export interface HighlightSplit {
  /** Text rendered before the emphasised phrase (empty for the verdict-first shape). */
  before: string
  /** The phrase that gets the emphasis treatment. */
  emphasis: string
  /** Text rendered after it, starting with its separator or closing punctuation. */
  after: string
}

const MIN_LEAD_WORDS = 3
const MAX_LEAD_WORDS = 14
const MIN_REST_WORDS = 3
// A lead that swallows most of the sentence isn't a highlight, it's the sentence.
const MAX_LEAD_SHARE = 0.72

const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length

// Ordered strongest → weakest. Each pattern finds the FIRST break of its kind;
// the lead ends just before the match and the matched separator stays in
// `rest`, so the sentence reads identically. Patterns intentionally require
// the break to be a real clause boundary:
// dashes with surrounding space, a colon/semicolon followed by a space, or a
// comma followed by a reason/contrast connector.
const BREAKS: RegExp[] = [
  /\s+[—–]\s+/,                                                        // "Wait — the terms aren't signed"
  /[—–]/,                                                              // "Wait—the terms aren't signed"
  /:\s+/,                                                              // "Don't sign: the terms are open"
  /;\s+/,                                                              // "Take it; the downside is capped"
  /,\s+(?:because|since|as|but|and|so|which|while|given|unless|until|otherwise)\b/i,
  /\s+(?:because|since|given that|so that)\s+/i,                       // no comma before the reason
  /,\s+/,                                                              // last resort: first comma
]

const NEGATION = /\b(?:isn['’]t|is not|aren['’]t|are not|wasn['’]t|not|never|no longer|doesn['’]t|don['’]t|won['’]t|can['’]t)\b/i
const CONTRAST_TAIL = /^(?:it['’]s|it is|that['’]s|but|rather|the real|what)\b/i
const TRAILING_PUNCT = /[.!?…]+$/

export function splitHighlight(text: string): HighlightSplit | null {
  const t = text.trim()
  if (!t) return null
  const total = wordCount(t)
  if (total < MIN_LEAD_WORDS + MIN_REST_WORDS) return null

  for (const re of BREAKS) {
    const m = re.exec(t)
    if (!m) continue
    const lead = t.slice(0, m.index).trimEnd()
    const leadWords = wordCount(lead)
    if (leadWords < MIN_LEAD_WORDS || leadWords > MAX_LEAD_WORDS) continue
    // whitespace trimmed off the lead's end belongs with what follows it
    const lost = t.slice(lead.length, m.index)
    const rest = lost + t.slice(m.index)
    if (wordCount(rest) < MIN_REST_WORDS) continue

    // Shape 2 — contrast: negation in the lead, and what follows the break
    // opens with "it's / but / rather …". Emphasise the tail, minus its
    // sentence-final punctuation and minus the separator itself.
    if (NEGATION.test(lead)) {
      const sepLen = m[0].length
      const afterSep = t.slice(m.index + sepLen)
      if (CONTRAST_TAIL.test(afterSep)) {
        const tailMatch = TRAILING_PUNCT.exec(afterSep)
        const tail = tailMatch ? afterSep.slice(0, tailMatch.index) : afterSep
        const tailWords = wordCount(tail)
        if (tailWords >= MIN_LEAD_WORDS && tailWords <= MAX_LEAD_WORDS) {
          return {
            before:   t.slice(0, m.index + sepLen),
            emphasis: tail,
            after:    tailMatch ? afterSep.slice(tailMatch.index) : '',
          }
        }
      }
    }

    // Shape 1 — verdict first. A lead that swallows most of the sentence
    // isn't a highlight, it's the sentence.
    if (leadWords / total > MAX_LEAD_SHARE) continue
    return { before: '', emphasis: lead, after: rest }
  }
  return null
}
