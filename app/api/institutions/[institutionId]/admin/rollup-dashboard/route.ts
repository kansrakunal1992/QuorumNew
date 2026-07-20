// app/api/institutions/[institutionId]/admin/rollup-dashboard/route.ts
// Tier 2 — cross-institution rollup dashboard for parent institutions.
// institutional_rollup_benchmark_segments (Sprint 4) and
// getRollupBenchmarkForDimension (Sprint 5) have existed since build-out;
// this is the first route or UI surface that actually reads either.
//
// GET /api/institutions/:institutionId/admin/rollup-dashboard
// Auth: caller must hold role 'admin' on the PARENT institution (:institutionId).
//
// Returns every dimension with a cleared rollup (>= 2 contributing
// children, each individually already floor-cleared — see the view's own
// comments for why). Queries the rollup view directly for all dims at once,
// same reasoning as the aggregate-dashboard route: this is "give me
// everything", not "check one dimension", a different shape of question
// than getBenchmarkForDimension is built for.

import { NextResponse }               from 'next/server'
import { createServiceClient }        from '@/lib/supabase'
import { isInstitutionalModeEnabled } from '@/lib/feature-flags'
import { requireInstitutionRole }     from '@/lib/institution-auth'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ institutionId: string }> },
): Promise<NextResponse> {
  if (!isInstitutionalModeEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { institutionId } = await params
  const auth = await requireInstitutionRole(req, institutionId, ['admin'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = createServiceClient()

  // Tech debt fix (aggregate_reader wiring) — see the aggregate-dashboard
  // route's equivalent comment for the full rationale.
  const { data: rows, error } = await supabase
    .rpc('aggregate_read_rollup_benchmark', { p_parent_institution_id: institutionId, p_dim: null })

  if (error) {
    console.error('[admin/rollup-dashboard] query failed:', error.message)
    return NextResponse.json({ error: 'Failed to load rollup dashboard' }, { status: 500 })
  }

  return NextResponse.json({ segments: rows ?? [] })
}
