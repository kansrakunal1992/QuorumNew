/**
 * lib/council-context.ts
 * ── CouncilContext shape — single source of truth ──────────────────────────
 *
 * Sprint TB1 (June 2026), corrected same sprint after a real deploy failure:
 * this was originally `export`ed directly from app/api/persona/route.ts.
 * Next.js App Router route handler files are restricted to a fixed set of
 * recognized exports (GET, POST, dynamic, runtime, etc.) — any other named
 * export fails the build with "X is not a valid Route export field", a
 * build-time error specific to next build's own route-type validation. It is
 * NOT caught by `tsc --noEmit` (confirmed: that command passed cleanly before
 * this fix), which only runs the standard TypeScript checker, not Next's
 * generated `.next/types/app/api/.../route.ts` validation layer. Any future
 * shared type/constant that needs to be used both inside a route handler and
 * by something outside it (another module, a test) must live in a plain lib
 * file like this one — never as an additional named export from route.ts.
 * See KDD 196.
 */

import type { OntologyScoreMap } from '@/lib/bias-scorer'
import type { RuleEngineResult } from '@/lib/rule-engine'

export interface CouncilContext {
  councilContextStr:  string | null
  ontologyVector:     OntologyScoreMap | null
  userId:             string | null
  ruleEngineResult:   RuleEngineResult | null   // Sprint R3
  maxStructuralScore: number | null             // Sprint R3
  decisionTypePrimary: string | null            // Sprint BT Phase 2b
  dominantEmotion:     string | null            // Sprint BT Phase 2b
}

export const EMPTY_COUNCIL_CONTEXT: CouncilContext = {
  councilContextStr:   null,
  ontologyVector:      null,
  userId:              null,
  ruleEngineResult:    null,
  maxStructuralScore:  null,
  decisionTypePrimary: null,
  dominantEmotion:     null,
}
