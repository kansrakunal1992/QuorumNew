// lib/brief-markdown.ts
//
// Shared parsing for the Decision Brief persona's markdown-lite output
// (lib/personas.ts DECISION_BRIEF). The model formats this content with
// **bold** spans and section headers, but picks inconsistently between three
// conventions across runs:
//   "## Header"           (markdown heading, seen from the live "Generate
//                          Decision Brief" button — sessions/[id] flow)
//   "**Header**" / "**Header**:"   (bold-only line, seen on some persisted
//                          decision_brief messages)
//   "HEADER"              (plain ALL-CAPS line — the only convention
//                          components/SynthesisCard.tsx's live brief
//                          previously recognized, and the reason "## Decision
//                          Brief" / "**Key Insights**" rendered as literal
//                          punctuation instead of a heading)
//
// Both app/record/[id]/page.tsx and components/SynthesisCard.tsx used to
// carry their own copy of this detection (or, for SynthesisCard, a much
// narrower one) — exactly the kind of per-file duplication that let
// <action_plan>/<confidence_to_act> silently break in some places but not
// others (see tests/tag-wiring-guardrail.test.ts). Centralizing the PARSING
// here means the two call sites can only differ in presentation (colors,
// sizing, fonts) from here on, not in what counts as a header/bold span.

export type BriefSegment = { text: string; bold: boolean }

// Splits a line into plain/bold segments on **...** markers.
export function parseBriefInline(line: string): BriefSegment[] {
  const segments: BriefSegment[] = []
  const regex = /\*\*(.+?)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = regex.exec(line)) !== null) {
    if (m.index > last) segments.push({ text: line.slice(last, m.index), bold: false })
    segments.push({ text: m[1], bold: true })
    last = regex.lastIndex
  }
  if (last < line.length) segments.push({ text: line.slice(last), bold: false })
  return segments.length ? segments : [{ text: line, bold: false }]
}

// Detects a standalone section header line in any of the three conventions
// above and returns its plain text (no markdown markers), or null if the
// line is not a header.
export function briefLineHeader(trimmed: string): string | null {
  const mdHeading = trimmed.match(/^#{1,6}\s+(.+?)\s*$/)
  if (mdHeading) return mdHeading[1].replace(/\*\*/g, '').trim()
  const boldOnly = trimmed.match(/^\*\*(.+?)\*\*:?\s*$/)
  if (boldOnly) return boldOnly[1].trim()
  if (/^[A-Z][A-Z\s/&-]+$/.test(trimmed) && trimmed.length > 2 && trimmed.length < 40) return trimmed
  return null
}

export function briefLineIsBullet(trimmed: string): boolean {
  return /^[-*]\s+/.test(trimmed)
}

export function briefBulletContent(trimmed: string): string {
  return trimmed.replace(/^[-*]\s+/, '')
}

// Bug fix: the decision_brief persona sometimes opens its own output with a
// redundant title line — e.g. "── Decision Brief ──", "## Decision Brief",
// or similar — restating the section name every surface already provides as
// a header (the record page's card title, SessionView's "Decision Brief"
// label, and the PDF's own gold section band). Two visible symptoms trace
// back to this single line:
//  1. On the record page / live SessionView, it renders as an extra,
//     redundant "DECISION BRIEF" heading right above "KEY INSIGHTS" — a
//     stray duplicate of framing that's already on screen.
//  2. In the PDF, this specific persona is more prone to using em-dash/
//     box-drawing decoration around the title (rather than the "##"/"**"
//     forms), and jsPDF's base Helvetica encoding doesn't support those
//     characters — instead of failing to detect it as a heading, it fell
//     through to being drawn as plain text, and the unsupported characters
//     rendered as a run of literal "?" glyphs.
// Rather than special-casing Unicode decoration support in three separate
// renderers (record page JSX, live SessionView JSX, and this PDF's jsPDF
// text layout), all three skip the line entirely when it's just a redundant
// restatement of "Decision Brief" — checked structurally (strip any
// decoration, compare the remaining words) so it survives whichever
// decoration convention the model reaches for on a given run.
export function briefLineIsRedundantTitle(trimmed: string): boolean {
  const core = trimmed
    .replace(/^#{1,6}\s*/, '')                 // leading markdown heading hashes
    .replace(/^\*\*|\*\*$/g, '')                // surrounding **bold** markers
    // leading/trailing decoration: hyphen, en/em dash, box-drawing lines,
    // underscore, equals, tilde, hash, asterisk, punctuation, whitespace, and
    // literal "?" — the PDF route sanitises unsupported Unicode dash/
    // box-drawing characters to "?" before this ever runs, so by the time it
    // gets here the decoration may already be a run of "?" rather than the
    // original dash characters.
    .replace(/^[\s\-–—_=~#*.:?\u2500-\u257F]+|[\s\-–—_=~#*.:?\u2500-\u257F]+$/g, '')
    .trim()
    .toLowerCase()
  return core === 'decision brief' || core === 'the decision brief' || core === 'quorum decision brief'
}
