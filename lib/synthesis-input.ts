// lib/synthesis-input.ts
//
// What the synthesis model is shown for each advisor.
//
// ROOT CAUSE this fixes ("Disagree / follow-up isn't updating the Council
// Synthesis"): SynthesisCard used `content.slice(0, 800)` per advisor. An
// advisor's stored content is  [original analysis] + [pushbacks…] + [updates…]
// — the original alone (header tags + ~200 words) is already longer than 800
// characters, so every challenge and every reassessment was cut off BEFORE the
// model saw it. Synthesis re-ran on identical inputs and, with the
// VERDICT STABILITY instruction, faithfully reproduced the same verdict.
//
// The digest below keeps the advisor's thesis (position / real cost / lean),
// a short slice of the original prose, and — with priority — every later
// exchange, newest last, with the advisor's CURRENT lean stated explicitly.

import { parsePersonaContent } from '@/lib/persona-history'
import { stripDisplayTags } from '@/lib/display-tags'

export interface DigestOptions {
  /** Advisor's current lean from SessionView.personaLeans (proceed|wait|mixed). */
  currentLean?: string
  /** Hard cap for one advisor's digest. 6 advisors × this ≈ synthesis input. */
  maxChars?: number
}

const tag = (raw: string, name: string): string => {
  const m = raw.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))
  return m ? m[1].trim() : ''
}

/** Remove machine/header tags and display-tag markers, keep prose. */
export function cleanAdvisorProse(raw: string): string {
  return stripDisplayTags(
    raw
      .replace(/<(lens|position|realcost|lean|structural|pushback_classification)>[\s\S]*?<\/(?:\1|pushback)>/g, '')
      .replace(/<(?:lens|position|realcost|lean|structural|pushback_classification)>[\s\S]*$/, '')
      .replace(/<\/?(?:proceed|wait|mixed)>\s*/gi, ''),
  ).replace(/\s+/g, ' ').trim()
}

const clip = (s: string, n: number): string => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…')

export function buildAdvisorDigest(content: string, opts: DigestOptions = {}): string {
  const maxChars = opts.maxChars ?? 2200
  const { initial, history } = parsePersonaContent(content)

  const position   = tag(initial, 'position')
  const realCost   = tag(initial, 'realcost')
  const origLean   = tag(initial, 'lean').toLowerCase()
  const currentLean = (opts.currentLean || origLean || '').toLowerCase()
  const originalProse = cleanAdvisorProse(initial)

  const head: string[] = []
  if (position) head.push(`Position: ${clip(position, 260)}`)
  if (realCost) head.push(`Real cost: ${clip(realCost, 200)}`)
  if (origLean) head.push(`Original lean: ${origLean}`)

  const later: string[] = history.map((seg, i) => {
    const label = seg.kind === 'pushback'
      ? `Challenge ${i + 1} — the person said: "${clip(seg.user, 280)}"`
      : `New information ${i + 1}${seg.info ? ` — "${clip(seg.info, 280)}"` : ''}`
    return `${label}\nAdvisor's reassessment: ${clip(cleanAdvisorProse(seg.reply), 520)}`
  })

  // Budget: later exchanges win. The original prose gets whatever is left
  // (never less than 260 chars, so the advisor's reasoning is still present).
  const fixed = head.join('\n').length + later.join('\n\n').length + 160
  const proseBudget = Math.max(260, maxChars - fixed)

  const lines: string[] = [...head, `Original analysis: ${clip(originalProse, proseBudget)}`]
  if (later.length > 0) {
    lines.push(
      'LATER EXCHANGES (these come AFTER the original and supersede it wherever they differ):',
      ...later,
      `CURRENT LEAN (use this, not the original): ${currentLean || 'unchanged'}`,
    )
  }
  return lines.join('\n')
}

/** Full ADVISOR RESPONSES block for the synthesis user message. */
export function buildAdvisorBlock(
  responses: Record<string, string>,
  leans: Record<string, string> = {},
): string {
  return Object.entries(responses)
    .map(([k, v]) => `[${k.toUpperCase().replace(/_/g, ' ')}]\n${buildAdvisorDigest(v, { currentLean: leans[k] })}`)
    .join('\n\n---\n\n')
}
