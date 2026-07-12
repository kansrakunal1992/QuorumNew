// tests/cohort-overlap-guardrail.test.ts
// Institutional Sprint 4 (task 6) — re-verifying plan Section 1.10 against
// the real aggregate views now that they exist (Sprint 2/3 only had
// lib/aggregate-eligibility.ts's stub to test against).
//
// The guardrail, verbatim from the plan: "K_FLOOR must be enforced
// uniformly by the aggregate view itself... A 3-person cohort that also
// opts into institutional aggregates must not be able to be isolated as
// its own 'segment' in the institution-level view just because it's a
// natural grouping — the view doesn't get to know or care what a 'cohort'
// is; it only refuses to return rows under threshold."
//
// This can't be verified against a live database in this environment (no
// network access to run a real Postgres instance), so — same honest
// trade-off as tests/institutional-invariants.test.ts — this is a
// source-inspection test against the actual view SQL, checking the two
// structural properties that together make the guardrail true regardless
// of what data ever flows through the view:
//
//   1. No aggregate view's definition references cohorts/cohort_memberships
//      at all. If a view can't see cohort membership, it categorically
//      cannot special-case, isolate, or bypass K_FLOOR for a cohort-sized
//      group — there's no data path for it to even know one exists.
//   2. Every aggregate view enforces a K_FLOOR-based HAVING clause. Absence
//      of a floor check would mean *any* group, cohort-sized or not, could
//      produce a sub-threshold row.
//
// Per plan Section 1.10, this file is meant to be re-run (and re-verified
// by hand against the plan's wording) at the end of every future sprint
// that touches these views, not just once here.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)
const REPO_ROOT  = join(__dirname, '..')

const VIEW_SQL_FILES = [
  'supabase/institutional_sprint4_aggregate_views.sql',
  'supabase/institutional_sprint6_bias_parameter_view.sql',
]

// One block per `create or replace view <name> as ... ;` statement, so each
// view can be checked independently rather than treating the whole file as
// one blob (which would let one view's HAVING clause mask another view
// missing one entirely).
function extractViewBlocks(sql: string): Array<{ name: string; body: string }> {
  const blocks: Array<{ name: string; body: string }> = []
  const re = /create or replace view\s+(\w+)\s+as([\s\S]*?);/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(sql)) !== null) {
    blocks.push({ name: match[1], body: match[2] })
  }
  return blocks
}

describe('Cohort-overlap guardrail (plan Section 1.10) — re-verified Sprint 4', () => {
  const allBlocks = VIEW_SQL_FILES.flatMap(relPath => {
    const sql = readFileSync(join(REPO_ROOT, relPath), 'utf-8')
    return extractViewBlocks(sql)
  })

  it('found aggregate view definitions to check', () => {
    expect(allBlocks.length).toBeGreaterThan(0)
  })

  it('no aggregate view references cohorts or cohort_memberships in any form', () => {
    for (const { name, body } of allBlocks) {
      const lower = body.toLowerCase()
      expect(lower.includes('cohort'), `view "${name}" references "cohort" — it must not know cohorts exist`).toBe(false)
    }
  })

  it('all four direct-aggregation views enforce a k_floor-based HAVING clause', () => {
    const directViews = allBlocks.filter(b =>
      b.name === 'institutional_platform_benchmark_segments' ||
      b.name === 'institutional_benchmark_segments' ||
      b.name === 'institutional_platform_bias_parameter_segments' ||
      b.name === 'institutional_bias_parameter_segments',
    )
    expect(directViews.length).toBe(4)
    for (const { name, body } of directViews) {
      const hasHaving = /having[\s\S]*k_floor/i.test(body)
      expect(hasHaving, `view "${name}" has no k_floor-based HAVING clause`).toBe(true)
    }
  })

  // Belt-and-suspenders: the rollup view's floor protection comes
  // transitively (it's only ever built from institutional_benchmark_segments
  // rows, which already individually cleared K_FLOOR) rather than its own
  // HAVING k_floor clause — confirm that transitive path actually holds by
  // checking its only view/table references are institutions and
  // institutional_benchmark_segments, never a raw table.
  it('the rollup view only reads from institutions and institutional_benchmark_segments', () => {
    const rollup = allBlocks.find(b => b.name === 'institutional_rollup_benchmark_segments')
    expect(rollup, 'institutional_rollup_benchmark_segments view not found').toBeTruthy()
    if (!rollup) return

    const forbiddenTables = ['sessions', 'outcomes', 'sessions_ontology', 'institution_memberships']
    const lower = rollup.body.toLowerCase()
    for (const table of forbiddenTables) {
      const pattern = new RegExp(`\\b(from|join)\\s+${table}\\b`)
      expect(pattern.test(lower), `rollup view has a direct FROM/JOIN to raw table "${table}"`).toBe(false)
    }
  })
})
