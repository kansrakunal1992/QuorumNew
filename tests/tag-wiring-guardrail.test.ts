// tests/tag-wiring-guardrail.test.ts
//
// Scoped-down "Continuous Trust Audits" item from the roadmap. The broad
// version of that item (is synthesis faithful to advisor positions, are
// weights genuinely used, is any UI stale) is a human-judgment review, not
// something a script can verify — that stays a periodic manual exercise.
//
// This is the one narrow slice of it that IS mechanical: lib/personas.ts's
// SYNTHESIS prompt instructs the model to wrap specific content in tags
// (<verdict>, <conditions>, <action_plan>, etc). Five other files each keep
// their OWN independent copy of tag-handling logic for that same synthesis
// text — components/SynthesisCard.tsx (live render), components/
// RecordExport.tsx (a persona-card PDF export used from PersonaPanel.tsx,
// distinct from the main brief PDF below), app/api/session/[id]/observation/
// route.ts (Mirror observation-feed prompt), app/record/[id]/page.tsx (the
// permanent-record page), and app/api/record/[id]/brief/route.ts (the actual
// "Download PDF" brief the record page links to). Nothing enforces that
// adding a tag to the prompt also means updating all five copies.
//
// That's exactly the gap that let <action_plan> and <confidence_to_act> ship
// working in the live UI while silently leaking as raw markup in the PDF
// export and the Mirror observation prompt — no crash, no error, just
// missing/broken output that only a human happening to look would catch.
// This test would have failed the day those two tags were added, instead of
// sitting undetected until now.
//
// Update, same root cause, different sinks: this test's own SINK_FILES list
// was itself incomplete — it never included app/record/[id]/page.tsx or
// app/api/record/[id]/brief/route.ts, so it kept passing throughout while
// both of those independently-maintained copies were unaware <action_plan>/
// <confidence_to_act> existed at all. That's why a "passing" guardrail
// coexisted with raw <action_plan>/<confidence_to_act> tags visible on the
// record page and in the downloaded PDF, plus the record page never even
// having a <verdict_lean>/<structural>/<assumption> strip. Fixed by adding
// both files below — but the meta-lesson is: whenever a new sink file is
// added to the app, it has to be added here too, or this test can't see it.
//
// Re-run automatically by `npm test`. If this ever fails, the fix is almost
// always: add the missing tag's strip pattern to the named file, matching
// how the other tags are already handled there.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)
const REPO_ROOT  = join(__dirname, '..')

const PERSONAS_PATH = 'lib/personas.ts'

// Every file that independently parses/strips synthesis tags out of the raw
// AI text. If a new sink is ever added (another export path, another prompt
// that consumes raw synthesis text, etc.), add its path here.
const SINK_FILES = [
  'components/SynthesisCard.tsx',
  'components/RecordExport.tsx',
  'app/api/session/[id]/observation/route.ts',
  // Added: these two were the actual cause of the reported record-page and
  // PDF bugs — this test didn't know they existed, so it couldn't catch that
  // they'd never been taught about <action_plan>/<confidence_to_act>.
  'app/record/[id]/page.tsx',
  'app/api/record/[id]/brief/route.ts',
]

// Pull just the SYNTHESIS prompt template literal out of lib/personas.ts —
// deliberately NOT the whole file, so persona-level tags (<lens>, <position>,
// <assumption>, etc., which have their own separate rendering path in
// PersonaPanel.tsx) don't get pulled into this check by accident.
function extractSynthesisBlock(personasSrc: string): string {
  const startMarker = 'export const SYNTHESIS = `'
  const start = personasSrc.indexOf(startMarker)
  if (start === -1) {
    throw new Error('Could not find "export const SYNTHESIS = `" in lib/personas.ts — has it been renamed?')
  }
  const nextExport = personasSrc.indexOf('\nexport const PERSONAS', start)
  if (nextExport === -1) {
    throw new Error('Could not find the end boundary ("export const PERSONAS") after SYNTHESIS in lib/personas.ts')
  }
  return personasSrc.slice(start + startMarker.length, nextExport)
}

// Unique opening tag names instructed within that block, e.g. "verdict",
// "action_plan". Excludes closing tags (</verdict>) and any tag that only
// ever appears as a literal inside prose describing another tag by name.
function extractInstructedTags(synthesisBlock: string): string[] {
  const matches = synthesisBlock.matchAll(/<([a-z_]+)>/g)
  const tags = new Set<string>()
  for (const m of matches) tags.add(m[1])
  return [...tags]
}

describe('Tag-wiring guardrail — every synthesis tag reaches every sink file', () => {
  const personasSrc = readFileSync(join(REPO_ROOT, PERSONAS_PATH), 'utf-8')
  const synthesisBlock = extractSynthesisBlock(personasSrc)
  const instructedTags = extractInstructedTags(synthesisBlock)

  const sinkContents = SINK_FILES.map(relPath => ({
    relPath,
    content: readFileSync(join(REPO_ROOT, relPath), 'utf-8'),
  }))

  it('found tags instructed in the SYNTHESIS prompt', () => {
    expect(instructedTags.length).toBeGreaterThan(0)
  })

  it('found all expected sink files on disk', () => {
    expect(sinkContents.length).toBe(SINK_FILES.length)
    for (const { relPath, content } of sinkContents) {
      expect(content.length, `${relPath} was empty or unreadable`).toBeGreaterThan(0)
    }
  })

  // The core check. For each tag the prompt instructs the model to emit,
  // every sink file must at least reference that tag name somewhere in its
  // own tag-handling logic. This doesn't verify the handling is *correct*
  // (that's still worth a human glance when a genuinely new tag shows up),
  // but it guarantees no sink is silently unaware a tag exists at all —
  // which is precisely the failure mode that let content vanish without
  // error.
  it('every instructed synthesis tag is referenced in every sink file', () => {
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
      `\n${missing.join('\n')}\n\nFix: add a strip/handle pattern for the missing tag(s) in the named file(s), matching how the other synthesis tags are already handled there.`,
    ).toEqual([])
  })

  // Belt-and-suspenders: catches the specific two tags this test was built
  // to protect, by name, so a future refactor of the extraction logic above
  // can't accidentally stop finding them and pass vacuously.
  it('sanity check: the two most recently added tags are actually detected', () => {
    expect(instructedTags).toContain('action_plan')
    expect(instructedTags).toContain('confidence_to_act')
    expect(instructedTags).toContain('counterfactual')
  })

  // Deeper check than "tag name appears somewhere". A sink file can strip
  // <tag>...</tag> correctly when the AI closes it, yet still leak raw
  // markup if that same generation gets truncated mid-tag (see
  // lib/ai-client.ts's max_tokens note) and no fallback for "open tag, no
  // close" exists. This is a real failure mode that hit multiple sink files
  // independently, was fixed, and then silently reverted when an external
  // edit was merged back in from a branch that predated the fix — the
  // tag-name check above stayed green through all of that, because the tag
  // name was still present via the (now-incomplete) closing-tag pattern.
  //
  // Rule enforced: if a file uses the truncation-guard idiom
  // (`<tag>[\s\S]*$`, marked with a "guard: open tag without close" comment)
  // for ANY tag, every tag in that file stripped via the "requires a
  // closing tag" idiom (`<tag>[\s\S]*?<\/tag`) must also appear in a guard.
  // A file that uses the guard idiom for none of its tags is left alone —
  // that's a file that hasn't adopted the pattern at all yet, a separate,
  // more foundational gap the first check above already surfaces.
  it('every sink file applies its truncation guard consistently to every tag it strips', () => {
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
})
