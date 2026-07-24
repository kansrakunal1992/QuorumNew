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
