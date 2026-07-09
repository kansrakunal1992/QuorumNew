// tests/institutional-invariants.test.ts
// Institutional Sprint 2 (task 4) — the hard-invariant test suite, written
// now rather than deferred. Runs via the existing `npm test` (vitest run).
//
// This is the first test file in the repo — no vitest.config.ts exists, so
// these tests deliberately avoid the `@/` path alias and use relative
// imports/fs paths instead, to run correctly with vitest's zero-config
// defaults. If a vitest.config.ts gets added later for other reasons, that's
// fine, these will keep working either way.
//
// Two of the three invariants below are static/source-inspection checks
// rather than live-DB checks, because there is no test Supabase project
// wired into CI yet and no network access assumed. This is a deliberate,
// documented choice, not a shortcut: per the plan's own wording for
// invariant #2 ("the test should assert this by inspecting the query, not
// just the response"), inspection is the intended mechanism. As real
// institution-scoped routes accumulate in Sprint 3+, these same two tests
// automatically start covering them too, since they scan the whole
// app/api/institutions and app/api/admin trees rather than a fixed file list.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { isAggregationEligible } from '../lib/aggregate-eligibility'

// __dirname isn't reliably available here: vitest runs test files as ESM,
// and __dirname is a CommonJS-only global — using it directly is an
// environment gamble that happens to work in some vitest configs and not
// others. import.meta.url is the ESM-native equivalent and works
// unconditionally under vitest. Confirmed via isolated tsc repro before
// landing this — the __dirname version type-checks fine in isolation but
// is exactly the kind of thing that only fails at actual runtime.
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const REPO_ROOT = join(__dirname, '..')
const SCAN_DIRS = ['app/api/institutions', 'app/api/admin']

// Fields that must never be selected from an institution-scoped or admin
// route, at any role — per plan Section 0's ledger table list.
const FORBIDDEN_FIELDS = ['decision_text', 'context_text', 'response_text', 'watchlist']

function listRouteFiles(relativeDir: string): string[] {
  const abs = join(REPO_ROOT, relativeDir)
  if (!existsSync(abs)) return []
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) walk(full)
      else if (entry === 'route.ts' || entry === 'route.tsx') out.push(full)
    }
  }
  walk(abs)
  return out
}

const routeFiles = SCAN_DIRS.flatMap(listRouteFiles)

describe('Institutional hard invariants (Sprint 2)', () => {
  // Guard against the scan silently finding nothing and both source-based
  // tests below passing vacuously. If this fails, the directories moved or
  // the walk logic broke — fix the scan, don't delete this test.
  it('found at least one institution/admin route file to scan', () => {
    expect(routeFiles.length).toBeGreaterThan(0)
  })

  it('no institution-scoped or admin route selects raw decision/context/response/watchlist fields', () => {
    for (const file of routeFiles) {
      const src = readFileSync(file, 'utf-8')
      const selectCalls = src.match(/\.select\(([^)]*)\)/g) ?? []
      for (const call of selectCalls) {
        for (const field of FORBIDDEN_FIELDS) {
          expect(
            call.includes(field),
            `${file} selects forbidden field "${field}" in: ${call}`,
          ).toBe(false)
        }
      }
    }
  })

  it('no institution-scoped or admin route deletes rows from `sessions`', () => {
    for (const file of routeFiles) {
      const src = readFileSync(file, 'utf-8')
      const touchesSessions = /\.from\(\s*['"]sessions['"]\s*\)/.test(src)
      const hasDelete = /\.delete\(/.test(src)
      if (touchesSessions) {
        expect(
          hasDelete,
          `${file} references the sessions table AND calls .delete() — ` +
          `an institution-scoped actor must never delete another user's session`,
        ).toBe(false)
      }
    }
  })

  it('toggling consent_aggregate off immediately makes that membership ineligible for aggregation', () => {
    expect(isAggregationEligible({ consent_aggregate: true })).toBe(true)
    expect(isAggregationEligible({ consent_aggregate: false })).toBe(false)
  })
})
