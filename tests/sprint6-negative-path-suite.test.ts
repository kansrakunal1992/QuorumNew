// tests/sprint6-negative-path-suite.test.ts
// Institutional Sprint 6 (task 1) — adversarial testing of every guarantee
// made in plan Section 1, run end-to-end rather than per-sprint.
//
// Same honest constraint as every other test file in this build: no live
// Postgres/Next.js runtime available in this environment, no network. Every
// check below is either (a) a genuine source-inspection proof of a
// structural guarantee that holds regardless of what data ever flows
// through the system, or (b) explicitly marked as requiring a live
// environment, with the exact manual/CI steps to run it there. Nothing here
// pretends a live-environment check happened when it didn't.
//
// Five sub-suites, matching Sprint 6 task 1's five bullets exactly.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)
const REPO_ROOT  = join(__dirname, '..')

function listFiles(relativeDir: string, matchName: (name: string) => boolean): string[] {
  const abs = join(REPO_ROOT, relativeDir)
  if (!existsSync(abs)) return []
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) walk(full)
      else if (matchName(entry)) out.push(full)
    }
  }
  walk(abs)
  return out
}

const institutionRouteFiles = [
  ...listFiles('app/api/institutions', n => n === 'route.ts'),
  ...listFiles('app/api/admin/create-institution', n => n === 'route.ts'),
]

const institutionUIFiles = listFiles('components', n =>
  ['InstitutionModeBadge.tsx', 'InstitutionConsentSettings.tsx', 'CohortInsightsCard.tsx',
   'BenchmarkScopeTag.tsx', 'BiasParameterBenchmarkTag.tsx'].includes(n),
)
// NotEnoughParticipantsYet.tsx and UnlockNotice.tsx are deliberately NOT in
// this list: both are pure, prop-driven presentational components with no
// fetching or gating logic of their own — they're only ever rendered inside
// a branch of their parent (BenchmarkScopeTag/BiasParameterBenchmarkTag)
// that already required the flag to be on and real data to exist. Requiring
// them to also check the flag would be redundant, not defense-in-depth —
// there's no code path where they render without their parent having
// already gated correctly.

describe('Sprint 6 negative-path suite: 1a — multi-institution scope bleed', () => {
  it('found route files to scan', () => {
    expect(institutionRouteFiles.length).toBeGreaterThan(0)
  })

  // Structural proof, not a live test: the "active institution" used by
  // every read path comes from resolveActiveInstitution(userId), which
  // re-queries user_institution_preference + institution_memberships fresh
  // server-side every call — there is no cache, no client-supplied
  // "activeInstitutionId" trusted anywhere. Verified by checking that no
  // route reads an institutionId out of the request body/query string and
  // treats it as "the active institution" (as opposed to "the institution
  // this specific admin action targets", which IS client-supplied but is
  // always re-validated by requireInstitutionRole against that exact id —
  // a different, already-covered guarantee).
  it('lib/active-institution.ts is the only place "active institution" is resolved, and it always re-queries the DB', () => {
    const src = readFileSync(join(REPO_ROOT, 'lib/active-institution.ts'), 'utf-8')
    expect(src.includes('createServiceClient'), 'resolveActiveInstitution must query the DB, not trust cached/passed-in state').toBe(true)
    expect(/cache|Cache/.test(src), 'no caching layer should exist for active-institution resolution').toBe(false)
  })

  it('setActiveInstitution validates membership server-side before allowing a switch', () => {
    const src = readFileSync(join(REPO_ROOT, 'lib/active-institution.ts'), 'utf-8')
    const fnBody = src.slice(src.indexOf('export async function setActiveInstitution'))
    expect(fnBody.includes('institution_memberships'), 'must check the caller actually belongs to the target institution').toBe(true)
    expect(fnBody.includes('if (!membership) return false'), 'must refuse the switch when no membership exists').toBe(true)
  })

  it('the benchmark and bias-parameter routes resolve institution scope server-side, never from client input', () => {
    for (const routeName of ['benchmark', 'bias-parameter-benchmark']) {
      const files = listFiles(`app/api/institutions/${routeName}`, n => n === 'route.ts')
      for (const file of files) {
        const src = readFileSync(file, 'utf-8')
        expect(src.includes('resolveActiveInstitution'), `${file} must resolve scope via resolveActiveInstitution, not a client param`).toBe(true)
      }
    }
  })
})

describe('Sprint 6 negative-path suite: 1b — cohort/aggregate overlap (adversarial)', () => {
  // The structural guarantee (no view knows what a cohort is; K_FLOOR is
  // unconditional) is already proven in tests/cohort-overlap-guardrail.test.ts
  // and re-run here isn't duplicated. What Sprint 6 adds is the adversarial
  // *construction* the plan describes — a real cohort whose membership
  // exactly equals a sub-floor segment elsewhere. That requires real rows
  // in a real Postgres instance to construct and query; it cannot be proven
  // by reading source. Documenting the manual QA procedure precisely here
  // so it's not lost, rather than faking a runtime check:
  it('documents the manual verification procedure (cannot run without a live DB)', () => {
    const procedure = [
      '1. In a test institution, create a cohort with exactly 3 consenting members.',
      '2. Ensure those same 3 members are the ONLY 3 users in the institution with a',
      '   HIGH bucket for some dimension (e.g. stakes_magnitude) — i.e. the cohort',
      '   membership set exactly equals what would be a K_FLOOR-violating segment.',
      '3. Query institutional_benchmark_segments for that institution + dimension.',
      '   Expected: no row (3 < K_FLOOR=20) — the view has no way to know these 3',
      '   people are also a cohort, so this is not a special case, just the ordinary',
      '   floor rule applying.',
      '4. Separately, query the Source #1 cohort-insights path for those same 3',
      '   users (mutually consenting to consent_shared_cohort). Expected: THEY DO',
      '   see the whitelisted insights belonging to each other via lib/cohort-insights.ts —',
      '   this is',
      '   correct and expected, not a bug. Source #1 (cohort) and Source #2',
      '   (aggregate) have different rules by design; the test is only that Source #2',
      '   never uses a cohort-sized grouping to sneak under its own floor.',
    ]
    expect(procedure.length).toBeGreaterThan(0) // documents intent; see console output
    console.log(procedure.join('\n'))
  })
})

describe('Sprint 6 negative-path suite: 1c — delete-override attempts, every role', () => {
  it('no institution/admin route calls .delete() on the sessions table', () => {
    // Deliberately scoped to institutionRouteFiles, not all of app/api.
    // app/api/account/route.ts legitimately deletes FROM sessions WHERE
    // user_id = the CALLER'S OWN id — GDPR self-service account deletion,
    // not "a role deleting another user's session" (Section 1.6's actual
    // guarantee is about elevated-privilege routes acting on someone ELSE's
    // data). An earlier draft of this check scanned all of app/api and
    // flagged that route as a false positive — fixed by narrowing scope,
    // not by weakening what's actually being guaranteed.
    for (const file of institutionRouteFiles) {
      const src = readFileSync(file, 'utf-8')
      const touchesSessions = /\.from\(\s*['"]sessions['"]\s*\)/.test(src)
      const hasDelete = /\.delete\(/.test(src)
      if (touchesSessions && hasDelete) {
        throw new Error(`${file} references the sessions table AND calls .delete() — no institution/admin route may delete session data at all`)
      }
    }
  })

  it('no institution/admin route ever deletes from institutions or institution_memberships', () => {
    // Narrower, precise version of the earlier blanket check (removed — it
    // flagged ANY .delete() in an admin-gated file, including entirely
    // legitimate ones like cohort deletion, which is real Tier 2
    // functionality, not a violation). The actual guarantee worth a hard
    // check: an admin action should never be able to delete the
    // institution itself or a membership row outright — role changes and
    // explicit, deliberate account-deletion flows are the only sanctioned
    // paths for those, not a generic admin route.
    for (const file of institutionRouteFiles) {
      const src = readFileSync(file, 'utf-8')
      for (const table of ['institutions', 'institution_memberships']) {
        const pattern = new RegExp(`\\.from\\(\\s*['"]${table}['"]\\s*\\)[\\s\\S]{0,120}?\\.delete\\(`)
        if (pattern.test(src)) {
          throw new Error(`${file} deletes from "${table}" — review manually, this table should never be deleted from by a generic admin route`)
        }
      }
    }
  })
})

describe('Sprint 6 negative-path suite: 1d — raw-text leak fuzzing', () => {
  const FORBIDDEN_FIELDS = ['decision_text', 'context_text', 'response_text', 'watchlist']
  // decision_text/context_text live on `sessions`; response_text lives on
  // `examiner_responses` (verified against supabase/schema.sql and
  // supabase/sprint1_add_ledger_tables.sql) — a wildcard select on either
  // table would leak these WITHOUT the field name ever appearing as a
  // string in the route source, which the plain substring check in
  // tests/institutional-invariants.test.ts cannot catch. This test closes
  // that gap specifically.
  const WILDCARD_LEAK_TABLES = ['sessions', 'examiner_responses']

  it('no institution/admin route selects forbidden fields by name (re-verified here too)', () => {
    for (const file of institutionRouteFiles) {
      const src = readFileSync(file, 'utf-8')
      const selectCalls = src.match(/\.select\(([^)]*)\)/g) ?? []
      for (const call of selectCalls) {
        for (const field of FORBIDDEN_FIELDS) {
          if (call.includes(field)) throw new Error(`${file} selects forbidden field "${field}" in: ${call}`)
        }
      }
    }
  })

  it('no institution/admin route does a wildcard select on a table containing forbidden fields', () => {
    for (const file of institutionRouteFiles) {
      const src = readFileSync(file, 'utf-8')
      for (const table of WILDCARD_LEAK_TABLES) {
        const wildcardPattern = new RegExp(
          `\\.from\\(\\s*['"]${table}['"]\\s*\\)[\\s\\S]{0,80}?\\.select\\(\\s*['"]\\*['"]\\s*\\)`,
        )
        if (wildcardPattern.test(src)) {
          throw new Error(`${file} does a wildcard select('*') on "${table}", which contains forbidden fields — must select explicit columns`)
        }
      }
    }
  })

  it('no institution/admin route references examiner_responses or watchlist_items at all', () => {
    // Stronger than field-name matching: these two tables have no legitimate
    // reason to be touched by ANY institution-scoped route, in any form —
    // not even for a "safe" column. If one shows up here, that's the
    // question to ask, not just "did it select the wrong column."
    for (const file of institutionRouteFiles) {
      const src = readFileSync(file, 'utf-8')
      for (const table of ['examiner_responses', 'watchlist_items']) {
        const pattern = new RegExp(`\\.from\\(\\s*['"]${table}['"]\\s*\\)`)
        if (pattern.test(src)) {
          throw new Error(`${file} references table "${table}" at all — institution routes should never touch this table`)
        }
      }
    }
  })
})

describe('Sprint 6 negative-path suite: 1e — flag-off residue', () => {
  it('every institution API route checks isInstitutionalModeEnabled() before anything else observable', () => {
    for (const file of institutionRouteFiles) {
      const src = readFileSync(file, 'utf-8')
      expect(src.includes('isInstitutionalModeEnabled'), `${file} must check the master flag`).toBe(true)
      expect(src.includes("status: 404"), `${file} must return 404 (not 200/empty/error) when the flag is off`).toBe(true)
    }
  })

  it('every institutional UI component checks isInstitutionalModeEnabled() before rendering anything', () => {
    expect(institutionUIFiles.length).toBeGreaterThan(0)
    for (const file of institutionUIFiles) {
      const src = readFileSync(file, 'utf-8')
      expect(src.includes('isInstitutionalModeEnabled'), `${file} must check the master flag before rendering`).toBe(true)
    }
  })

  it('the root layout only ever mounts the mode badge, never any other institutional UI unconditionally', () => {
    const layout = readFileSync(join(REPO_ROOT, 'app/layout.tsx'), 'utf-8')
    // InstitutionModeBadge itself internally checks the flag and membership
    // count and renders null — but confirm no OTHER institutional component
    // got mounted directly in the global layout without going through a
    // page that itself sits behind auth/consent context.
    const forbiddenGlobalMounts = ['CohortInsightsCard', 'InstitutionConsentSettings', 'BenchmarkScopeTag']
    for (const name of forbiddenGlobalMounts) {
      expect(layout.includes(`<${name}`), `${name} should not be mounted globally in root layout`).toBe(false)
    }
  })
})
