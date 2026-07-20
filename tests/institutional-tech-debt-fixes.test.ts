// tests/institutional-tech-debt-fixes.test.ts
// Tech-debt-fix verification, added alongside supabase/institutional_
// tech_debt_fixes.sql. Same style/constraints as tests/institutional-
// invariants.test.ts (Sprint 2): no live Supabase project or network
// access assumed in this environment, so both checks below are static/
// source-inspection, not live-DB or live-API tests.
//
// Covers two of the items from PENDING/NEXT SESSION:
//   1. k_floor_default() (SQL) vs DEFAULT_K_FLOOR (lib/k-floor.ts) — the
//      two independently-maintained copies of the same constant. This
//      test doesn't prevent drift (a future edit to one file without the
//      other still ships), but it turns that drift into a failing test
//      instead of a silent production mismatch.
//   2. Sprint CAL's calibration-zone boost (lib/persona-relevance.ts) and
//      the institutional synthesis-context block (app/api/persona/
//      route.ts) have never been exercised together for a user who
//      qualifies for both. A genuine "does the combined output read
//      sensibly" question needs a human to look at a real synthesis, and
//      that's flagged below, not faked — what IS testable without a live
//      API call is the structural claim the safety of that combination
//      actually rests on: that both blocks are appended additively (plain
//      string concatenation) rather than written through any shared,
//      overwritable key. If that structural claim ever stops being true,
//      this test catches it; whether the combined prose reads well is a
//      separate, human judgment call this test doesn't attempt.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = join(__dirname, '..')

describe('K_FLOOR consistency (SQL vs TypeScript)', () => {
  it('k_floor_default() and DEFAULT_K_FLOOR agree', () => {
    // k_floor_default() is defined once, in institutional_sprint4_aggregate_
    // views.sql (see that file's own header comment: "If you change the
    // number, change it in both places, same commit") — not redefined
    // anywhere in institutional_tech_debt_fixes.sql, which only ever
    // references it, so this is still the one source-of-truth file to read.
    const sqlPath = join(REPO_ROOT, 'supabase/institutional_sprint4_aggregate_views.sql')
    const sql = readFileSync(sqlPath, 'utf-8')
    const sqlMatch = sql.match(/create or replace function k_floor_default\(\) returns int[\s\S]*?select\s+(\d+)/)
    expect(sqlMatch, 'k_floor_default() definition not found or shape changed — update this test\'s regex to match').not.toBeNull()
    const sqlValue = Number(sqlMatch![1])

    const tsPath = join(REPO_ROOT, 'lib/k-floor.ts')
    const ts = readFileSync(tsPath, 'utf-8')
    // Actual exported name is K_FLOOR (not DEFAULT_K_FLOOR — corrected
    // after this test's first run caught its own wrong assumption about
    // the constant's name, which is a reasonable thing for a test like
    // this to catch even about itself).
    const tsMatch = ts.match(/export const K_FLOOR\s*=\s*(\d+)/)
    expect(tsMatch, 'K_FLOOR not found in lib/k-floor.ts — update this test\'s regex to match').not.toBeNull()
    const tsValue = Number(tsMatch![1])

    expect(
      sqlValue,
      `k_floor_default() returns ${sqlValue} but DEFAULT_K_FLOOR is ${tsValue} — these must match. ` +
      `Fix whichever one is stale, in the same commit as whatever changed the other.`,
    ).toBe(tsValue)
  })
})

describe('Sprint CAL × Institutional synthesis-context interaction (structural check only)', () => {
  const routeSrc = readFileSync(join(REPO_ROOT, 'app/api/persona/route.ts'), 'utf-8')

  it('the institutional context block is appended additively to basePrompt, never assigned over it', () => {
    // Guards against a future edit accidentally changing
    // `basePrompt = ...institutionalBlock` (overwrite) instead of
    // `basePrompt = \`${basePrompt}${institutionalBlock}\`` (append) — the
    // difference between "adds context" and "silently deletes everything
    // injected before it, including the MANDATORY weighting directive".
    const institutionalAppend = /basePrompt\s*=\s*`\$\{basePrompt\}\$\{institutionalBlock\}`/
    expect(
      institutionalAppend.test(routeSrc),
      'institutional context block is no longer appended via `${basePrompt}${institutionalBlock}` — ' +
      'verify it still appends rather than overwrites basePrompt',
    ).toBe(true)
  })

  it('the relevance (council weighting) block is appended before the institutional block, not after', () => {
    // Order matters for the same reason §2.4.2 of the TSD documents it:
    // the MANDATORY directive should read first, additive context after.
    const relevanceIdx    = routeSrc.indexOf('basePrompt = `${basePrompt}${relevanceBlock}`')
    const institutionalIdx = routeSrc.indexOf('basePrompt = `${basePrompt}${institutionalBlock}`')
    expect(relevanceIdx, 'relevanceBlock append site not found').toBeGreaterThan(-1)
    expect(institutionalIdx, 'institutionalBlock append site not found').toBeGreaterThan(-1)
    expect(relevanceIdx).toBeLessThan(institutionalIdx)
  })

  it('MANUAL FOLLOW-UP (not automated here): verify combined output quality', () => {
    // This test intentionally always passes — it exists so the gap shows
    // up in test output/coverage discussions, not just in a markdown doc.
    // What it can't check without a live Anthropic API call and a seeded
    // test session: construct one session that is BOTH (a) in a personal
    // calibration zone for some dimension (lib/calibration-engine.ts has
    // a confirmed pattern for that user+dimension) AND (b) an institution
    // member whose active institution has cleared K_FLOOR for that same
    // dimension. Run it through synthesis. Confirm: the assembled prompt
    // isn't unreasonably long, neither directive contradicts the other,
    // and the resulting synthesis text reads coherently rather than like
    // two unrelated instructions bolted together. See PENDING/NEXT SESSION
    // in the handover doc for this item.
    expect(true).toBe(true)
  })
})
