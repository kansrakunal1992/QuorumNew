// tests/persona-tag-wiring-guardrail.test.ts
//
// Companion to tag-wiring-guardrail.test.ts. That test deliberately scopes
// itself to tags instructed inside the SYNTHESIS template literal and says,
// in its own comments, that persona-level tags — <lens>, <position>,
// <realcost>, <lean>, <assumption>, <pushback_classification>, plus
// <structural> (injected at runtime by app/api/persona/route.ts, not
// present in lib/personas.ts at all) — have "their own separate rendering
// path in PersonaPanel.tsx" and were left for a follow-up test. This is
// that follow-up.
//
// Same failure mode, same five sinks: components/PersonaPanel.tsx (live
// render), components/RecordExport.tsx (persona-card PDF export, used from
// PersonaPanel.tsx), app/api/session/[id]/observation/route.ts (Mirror
// observation-feed prompt), app/record/[id]/page.tsx (the permanent-record
// page), and app/api/record/[id]/brief/route.ts (the "Download PDF" brief).
// Each keeps its own independent copy of persona-tag-stripping logic.
// Nothing enforces that a new persona-level tag, or a new failure mode for
// an existing one, gets added to all five.
//
// Confirmed live example this test is built to catch (found by manual
// review, not by this test, since it didn't exist yet): app/record/[id]
// /page.tsx was the only one of the five sinks still using a strict
// </pushback_classification>-only close with no </pushback> tolerance —
// unlike the other four, which already handle the model's occasional
// closing-tag drift. Separately, four of the five sinks (all but
// PersonaPanel.tsx) had no truncation-guard fallback for
// pushback_classification at all, meaning a generation cut off mid-tag
// (no closing tag of any kind — see lib/ai-client.ts's max_tokens note)
// would leak raw markup. Both classes are fixed as of this test's
// introduction; it exists so the next new persona-level tag doesn't
// silently reintroduce either one.
//
// Re-run automatically by `npm test`. No network access in this sandbox,
// so vitest itself can't be executed here — this was verified by
// reimplementing the same logic in plain Node.js against the actual repo
// files before being committed, same as the rest of this session's work.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)
const REPO_ROOT  = join(__dirname, '..')

const PERSONAS_PATH = 'lib/personas.ts'

// Every file that independently parses/strips persona-level tags out of
// the raw AI text. If a new sink is ever added, add its path here.
const SINK_FILES = [
  'components/PersonaPanel.tsx',
  'components/RecordExport.tsx',
  'app/api/session/[id]/observation/route.ts',
  'app/record/[id]/page.tsx',
  'app/api/record/[id]/brief/route.ts',
]

// Unlike SYNTHESIS, the persona-level tags aren't instructed inside one
// contiguous template literal — <lens>/<position>/<realcost>/<lean> live
// in WORD_LIMIT_PREFIX, <pushback_classification> lives in
// WORD_LIMIT_SUFFIX, and <assumption> is redefined with different wording
// inside each of the six persona blocks (CONTRARIAN..COMPETITOR), which are
// concatenated together at runtime (see the PERSONAS object below these
// blocks in lib/personas.ts: PUSHBACK_DETECTION_PREFIX + WORD_LIMIT_PREFIX
// + <persona> + WORD_LIMIT_SUFFIX). So instead of one start/end pair, this
// pulls every block in that concatenation and unions the tags found across
// all of them.
const BLOCK_MARKERS = [
  'export const CONTRARIAN = `',
  'export const RISK_ARCHITECT = `',
  'export const PATTERN_ANALYST = `',
  'export const STAKEHOLDER_MIRROR = `',
  'export const ELDER = `',
  'export const COMPETITOR = `',
  'const PUSHBACK_DETECTION_PREFIX = `',
  'const WORD_LIMIT_PREFIX = `',
  'const WORD_LIMIT_SUFFIX = `',
]
const BLOCKS_END_MARKER = '\nexport const SYNTHESIS = `'

// <structural> is the one persona-level tag that can never be found this
// way — app/api/persona/route.ts builds it dynamically at request time
// (wrapping a conditional sentence about structural-match continuity) and
// it never appears anywhere in lib/personas.ts as static text. If that
// file ever renames the tag, this list has to be updated by hand; nothing
// here will catch that automatically.
const KNOWN_TAGS_NOT_IN_PERSONAS_TS = ['structural']

function extractPersonaLevelBlocks(personasSrc: string): string {
  const positions = BLOCK_MARKERS.map(marker => {
    const idx = personasSrc.indexOf(marker)
    if (idx === -1) {
      throw new Error(`Could not find "${marker}" in lib/personas.ts — has a persona prompt been renamed or restructured?`)
    }
    return { marker, idx }
  }).sort((a, b) => a.idx - b.idx)

  const endIdx = personasSrc.indexOf(BLOCKS_END_MARKER)
  if (endIdx === -1) {
    throw new Error('Could not find "export const SYNTHESIS" boundary after the persona-level blocks in lib/personas.ts')
  }

  let combined = ''
  for (let i = 0; i < positions.length; i++) {
    const blockStart = positions[i].idx + positions[i].marker.length
    const blockEnd = i + 1 < positions.length ? positions[i + 1].idx : endIdx
    combined += personasSrc.slice(blockStart, blockEnd) + '\n'
  }
  return combined
}

// Unique opening tag names instructed within those blocks.
function extractInstructedTags(blocksText: string): string[] {
  const matches = blocksText.matchAll(/<([a-z_]+)>/g)
  const tags = new Set<string>()
  for (const m of matches) tags.add(m[1])
  return [...tags]
}

describe('Persona-tag-wiring guardrail — every persona-level tag reaches every sink file', () => {
  const personasSrc = readFileSync(join(REPO_ROOT, PERSONAS_PATH), 'utf-8')
  const personaBlocks = extractPersonaLevelBlocks(personasSrc)
  const instructedTags = [...extractInstructedTags(personaBlocks), ...KNOWN_TAGS_NOT_IN_PERSONAS_TS]

  const sinkContents = SINK_FILES.map(relPath => ({
    relPath,
    content: readFileSync(join(REPO_ROOT, relPath), 'utf-8'),
  }))

  it('found tags instructed across the persona-level blocks', () => {
    expect(instructedTags.length).toBeGreaterThan(0)
  })

  it('found all expected sink files on disk', () => {
    expect(sinkContents.length).toBe(SINK_FILES.length)
    for (const { relPath, content } of sinkContents) {
      expect(content.length, `${relPath} was empty or unreadable`).toBeGreaterThan(0)
    }
  })

  // Sanity check, same purpose as the SYNTHESIS test's own: names the tags
  // this test was built to protect, by name, so a future refactor of the
  // extraction logic above can't accidentally stop finding them and pass
  // vacuously.
  it('sanity check: the known persona-level tags are actually detected', () => {
    expect(instructedTags).toContain('lens')
    expect(instructedTags).toContain('position')
    expect(instructedTags).toContain('realcost')
    expect(instructedTags).toContain('lean')
    expect(instructedTags).toContain('assumption')
    expect(instructedTags).toContain('pushback_classification')
    expect(instructedTags).toContain('structural')
  })

  it('every instructed persona-level tag is referenced in every sink file', () => {
    const missing: string[] = []
    for (const tag of instructedTags) {
      for (const { relPath, content } of sinkContents) {
        if (!content.includes(tag)) {
          missing.push(`"<${tag}>" is missing from ${relPath}`)
        }
      }
    }
    expect(
      missing,
      `\n${missing.join('\n')}\n\nFix: add a strip/handle pattern for the missing tag(s) in the named file(s), matching how the other persona-level tags are already handled there.`,
    ).toEqual([])
  })

  // Same truncation-guard consistency rule as the SYNTHESIS test: if a file
  // strips ANY tag using the "requires a closing tag" idiom
  // (`<tag>[\s\S]*?<\/tag`), every tag it strips that way must also have a
  // guard-idiom fallback (`<tag>[\s\S]*$`, marked with a "guard: open tag
  // without close" comment) — otherwise a generation truncated mid-tag
  // leaks raw markup. This is exactly the gap found in four of the five
  // sinks for pushback_classification before this test existed.
  it('every sink file applies its truncation guard consistently to every persona-level tag it strips', () => {
    const problems: string[] = []
    for (const { relPath, content } of sinkContents) {
      const guardLines = content.split('\n').filter(l => l.includes('guard: open tag without close'))
      if (guardLines.length === 0) continue
      const guardedTags = new Set<string>()
      for (const line of guardLines) {
        for (const tag of instructedTags) {
          if (line.includes(`<${tag}>`) || line.includes(`|${tag}|`) || line.includes(`(?:${tag}`) || line.includes(`${tag}|`) || line.includes(`|${tag})`)) {
            guardedTags.add(tag)
          }
        }
      }
      for (const tag of instructedTags) {
        const requiresCloseIdiom = `<${tag}>[\\s\\S]*?<\\/`
        if (content.includes(requiresCloseIdiom) && !guardedTags.has(tag)) {
          problems.push(`${relPath}: "<${tag}>" is stripped with a pattern requiring a closing tag, but has no truncation-guard fallback even though this file uses that pattern for other tags — a cut-off generation would leak raw "<${tag}>" markup here.`)
        }
      }
    }
    expect(
      problems,
      `\n${problems.join('\n')}\n\nFix: add a guard line for the missing tag(s) — e.g. ".replace(/<TAG>[\\\\s\\\\S]*$/, '')" or fold TAG into an existing combined guard — right after its normal strip line, matching the pattern already used for other tags in the same file.`,
    ).toEqual([])
  })

  // Belt-and-suspenders for the specific closing-tag-drift bug found in
  // app/record/[id]/page.tsx: pushback_classification must tolerate the
  // model closing with </pushback> instead of </pushback_classification>
  // in every sink that strips it with the "requires close" idiom, not just
  // most of them. lib/personas.ts's own WORD_LIMIT_SUFFIX instructs the
  // model never to do this — the tolerance exists anyway because the model
  // does it sometimes regardless.
  it('every sink file tolerates </pushback> as an alternate close for pushback_classification', () => {
    const problems: string[] = []
    for (const { relPath, content } of sinkContents) {
      const usesStrictOnly = /<pushback_classification>\[\\s\\S\]\*\?<\\\/pushback_classification>/.test(content)
        && !content.includes('(?:pushback_classification|pushback)')
      if (usesStrictOnly) {
        problems.push(`${relPath}: strips <pushback_classification> with an exact-close-only pattern — add the "(?:pushback_classification|pushback)" alternation used in the other sink files.`)
      }
    }
    expect(problems).toEqual([])
  })
})
