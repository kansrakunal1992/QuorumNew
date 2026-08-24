// Fabrication Guard — heuristic detector for invented named analogues in
// Pattern Analyst output.
//
// WHY THIS EXISTS: prior to this change, lib/personas.ts's PATTERN_ANALYST
// prompt explicitly instructed the model to "always attempt to name a
// specific documented case or study... if no named case is available, say
// so explicitly rather than describing a category." That instruction
// pressures the model to fabricate plausible-sounding specifics (a named
// person + a year, e.g. "Consultant X, 2016") when it doesn't actually have
// a verifiable one — which is exactly what showed up in the reviewed
// session output this fix responds to. The prompt itself has been rewritten
// (see lib/personas.ts, PATTERN_ANALYST core mandate #5) to default to
// structural analogues and only name real entities when well-established.
// This file is the verification half of that fix: a way to catch a
// regression — in the prompt, in a future edit, or in a specific model's
// behavior under the new prompt — before it reaches a user.
//
// WHAT THIS IS NOT: a semantic fact-checker. It cannot tell you whether a
// named case is real or accurate. It is a narrow, explainable heuristic
// that flags the *shape* least model output takes when it's inventing a
// specific to sound documented — an anonymized-but-oddly-specific label
// ("Consultant X"), or a proper noun paired tightly with a year, that isn't
// one of a short list of genuinely well-established macro
// events/datasets. Anything it flags is a candidate for human review, not
// a confirmed fabrication — and anything it doesn't flag is not a
// guarantee of accuracy. Treat this the same as every other "documents the
// manual verification procedure" note elsewhere in this test suite (see
// tests/sprint6-negative-path-suite.test.ts): automation narrows the
// review surface, it doesn't replace judgment.

export interface FabricationFlag {
  snippet: string
  reason: string
}

// Well-established macro events/datasets the Pattern Analyst prompt itself
// names as acceptable to cite directly (lib/personas.ts core mandate #5–6).
// Extend this list only for things that meet the same bar: broadly known,
// not case-specific, not the kind of thing that could be quietly swapped
// for a fabricated alternative without anyone noticing.
const ALLOWED_NAMED_ANCHORS = [
  /\bspiva\b/i,
  /\bs&p\s*(500|dow|index)?\b/i,
  /\b2008\b.{0,25}(housing|financial|mortgage|crisis)/i,
  /(housing|financial|mortgage|crisis).{0,25}\b2008\b/i,
  /\bdot[\s-]?com\b/i,
  /\bgreat depression\b/i,
  /\bgreat recession\b/i,
]

// Pattern A: an anonymized-but-specific placeholder label — the classic
// "I can't name a real one so I'll invent a stand-in that reads as if it
// were redacted from a real one" move. E.g. "Consultant X", "Founder Y",
// "Client Z (2016)". The comma/parenthetical-year pairing is what
// distinguishes this from a legitimate generic reference like "Company X"
// used as an illustrative placeholder without a fabricated date attached.
const PLACEHOLDER_NAME_WITH_YEAR = /\b(?:named case:?\s*)?['"“]?[A-Z][a-z]+\s+[A-Z]\b[\s,"'”)(]{0,4}(?:19|20)\d{2}\b/g

// Pattern B: a capitalized proper-noun phrase (2+ title-case words, i.e. a
// plausible specific company/person/institution name) immediately paired
// with a year, in either order — "Kodak (2016)", "in 2016, Meridian
// Capital collapsed". This catches specific-sounding attributions the
// model has no real basis for, while allowing generic category language
// ("a mid-career operator," "an adjacent revenue stream") through
// untouched, since those have no proper noun to match. The "in 2016, ..."
// branch matches "in"/"In" specifically (not a blanket case-insensitive
// flag on the whole pattern) so the proper-noun branch doesn't start
// matching lowercase words too.
const PROPER_NOUN_WITH_YEAR = /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,3})\s*[,(]\s*((?:19|20)\d{2})\)?|\b[Ii]n\s+((?:19|20)\d{2}),?\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,3})\b/g

function isAllowedAnchor(snippet: string, fullText: string, matchIndex: number): boolean {
  // Check a window around the match, not just the matched snippet itself —
  // "the 2008 housing market" might match PROPER_NOUN_WITH_YEAR as
  // "2008" + "housing" depending on capitalization, and the allow-list
  // regexes are written to match across that kind of nearby context.
  const windowStart = Math.max(0, matchIndex - 40)
  const windowEnd = Math.min(fullText.length, matchIndex + snippet.length + 40)
  const window = fullText.slice(windowStart, windowEnd)
  return ALLOWED_NAMED_ANCHORS.some(re => re.test(window))
}

/**
 * Scan Pattern Analyst output (or any persona text) for the shape of an
 * invented named analogue. Returns one flag per suspicious match, each
 * with the exact snippet and a plain-language reason, so a reviewer can
 * jump straight to the spot in the text.
 */
export function detectSuspiciousAnalogue(text: string): FabricationFlag[] {
  const flags: FabricationFlag[] = []
  const seen = new Set<string>()

  const record = (snippet: string, index: number, reason: string) => {
    if (isAllowedAnchor(snippet, text, index)) return
    const key = `${index}:${snippet}`
    if (seen.has(key)) return
    seen.add(key)
    flags.push({ snippet: snippet.trim(), reason })
  }

  for (const m of text.matchAll(PLACEHOLDER_NAME_WITH_YEAR)) {
    record(m[0], m.index ?? 0, 'Anonymized-placeholder name paired with a specific year — the pattern a model produces when it invents a stand-in for a case it cannot actually name.')
  }

  for (const m of text.matchAll(PROPER_NOUN_WITH_YEAR)) {
    record(m[0], m.index ?? 0, 'Specific proper noun paired tightly with a year, outside the prompt\'s allow-listed macro anchors — a specific, unverifiable attribution.')
  }

  return flags
}

/** Convenience boolean for call sites that just need a pass/fail gate. */
export function hasSuspiciousAnalogue(text: string): boolean {
  return detectSuspiciousAnalogue(text).length > 0
}
