// lib/synthesis-highlights.ts
// Minimal, read-only extraction of the pieces the "Share my decision" feature
// needs from a synthesis message's raw content: the verdict sentence,
// conditions ("Conditional on"), the key question ("Worth confirming"), and
// the action plan.
//
// Deliberately NOT the full parser: app/record/[id]/page.tsx's
// parseVerdictTension() also extracts counterfactual/confidenceToAct and the
// remaining tension-highlighted prose for on-page rendering, none of which
// the share feature needs. That fuller parser (and SynthesisCard.tsx's own,
// and RecordExport.tsx's own) already exist as three independent copies of
// this same tag-handling logic — this file is intentionally the shared
// dependency for the share route and share page, not a fourth independent copy.
//
// Same tag shapes as the other three parsers: <verdict>, <conditions>
// (pipe-separated), <key_question>, <action_plan> (pipe-separated,
// "**lead** — rest" items). Guards for an unclosed tag (a truncated
// synthesis run) return null/empty rather than leaking raw markup, matching
// the other parsers' behavior.

export interface ActionItem {
  lead: string
  rest: string
}

export interface SynthesisHighlights {
  verdict:      string | null
  conditions:   string[]
  keyQuestion:  string | null
  actionPlan:   ActionItem[]
}

function firstSentence(text: string): string {
  const m = text.match(/^[^.!?]*[.!?]/)
  return m ? m[0].trim() : text.trim()
}

function parseActionItems(raw: string): ActionItem[] {
  return raw.split('|').map(s => s.trim()).filter(Boolean).map(item => {
    const m = item.match(/^\*\*(.+?)\*\*\s*[—-]\s*(.*)$/)
    return m ? { lead: m[1].trim(), rest: m[2].trim() } : { lead: '', rest: item }
  })
}

export function parseSynthesisHighlights(raw: string): SynthesisHighlights {
  const vMatch = raw.match(/<verdict>([\s\S]*?)<\/verdict>/)
  const verdict = vMatch?.[1]?.trim() ? firstSentence(vMatch[1].trim()) : null

  const cMatch = raw.match(/<conditions>([\s\S]*?)<\/conditions>/)
  const conditions = cMatch?.[1] ? cMatch[1].split('|').map(s => s.trim()).filter(Boolean) : []

  const kqMatch = raw.match(/<key_question>([\s\S]*?)<\/key_question>/)
  const keyQuestion = kqMatch?.[1]?.trim() ?? null

  const apMatch = raw.match(/<action_plan>([\s\S]*?)<\/action_plan>/)
  const actionPlan = apMatch?.[1] ? parseActionItems(apMatch[1]) : []

  return { verdict, conditions, keyQuestion, actionPlan }
}

// Word-boundary truncate — same "don't cut mid-word" rule the codebase
// already uses elsewhere. Caps the verdict/worth-confirming/action lines in
// the compact share message so a long sentence doesn't blow out the
// WhatsApp preview.
export function truncateWords(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max).replace(/\s+\S*$/, '') + '…'
}

// Builds the compact message shared via WhatsApp/LinkedIn/Reddit/copy-link.
// Two variants, same wording and same section order — "Council verdict",
// "Worth confirming", "Next step", "Full breakdown" are unchanged in both:
//
//   buildShareMessage()         — plain text. Used for LinkedIn (clipboard,
//                                  since LinkedIn's share-offsite endpoint
//                                  has no pre-filled-text param) and the
//                                  in-app "Copy message" preview, which can
//                                  be pasted anywhere — neither renders
//                                  WhatsApp's asterisk-bold syntax, so this
//                                  version stays plain rather than showing
//                                  literal asterisks.
//   buildWhatsAppShareMessage() — same content, labels bolded with
//                                  WhatsApp's native single-asterisk syntax
//                                  and on their own line above their
//                                  content. Only ever used for the wa.me
//                                  deep link. No emoji in either variant.
//
//   Plain:                          WhatsApp:
//   A decision I ran through        *A decision I ran through
//   Quorum:                          Quorum:*
//   "<decision>"                    "<decision>"
//
//   Council verdict:                *Council verdict:*
//   <verdict>                       <verdict>
//
//   Worth confirming:               *Worth confirming:*
//   <keyQuestion>                   <keyQuestion>
//     ← or, if none, "Next step:" / "*Next step:*" with <topAction> →
//
//   Full breakdown:                 *Full breakdown:*
//   <url>                           <url>
function buildShareLines(
  params: {
    decisionText: string
    url:          string
    highlights:   SynthesisHighlights | null
  },
  label: (text: string) => string,
): string[] {
  const { decisionText, url, highlights } = params

  const decision = truncateWords(decisionText.trim(), 140)
  const lines = [label('A decision I ran through Quorum:'), `"${decision}"`]

  if (highlights?.verdict) {
    lines.push('', label('Council verdict:'), truncateWords(highlights.verdict, 180))
  }

  const topAction = highlights?.actionPlan?.[0] ?? null
  if (highlights?.keyQuestion) {
    lines.push('', label('Worth confirming:'), truncateWords(highlights.keyQuestion, 180))
  } else if (topAction) {
    const actionLine = topAction.lead ? `${topAction.lead} — ${topAction.rest}` : topAction.rest
    lines.push('', label('Next step:'), truncateWords(actionLine, 180))
  }

  lines.push('', label('Full breakdown:'), url)
  return lines
}

const plainLabel      = (text: string) => text
const whatsappLabel    = (text: string) => `*${text}*`

export function buildShareMessage(params: {
  decisionText: string
  url:          string
  highlights:   SynthesisHighlights | null
}): string {
  return buildShareLines(params, plainLabel).join('\n')
}

export function buildWhatsAppShareMessage(params: {
  decisionText: string
  url:          string
  highlights:   SynthesisHighlights | null
}): string {
  return buildShareLines(params, whatsappLabel).join('\n')
}
