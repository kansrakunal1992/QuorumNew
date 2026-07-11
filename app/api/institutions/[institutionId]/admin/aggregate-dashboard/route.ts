// app/api/institutions/[institutionId]/admin/aggregate-dashboard/route.ts
// Institutional Sprint 5 (task 7) — the real aggregate dashboard, replacing
// Sprint 3's "coming soon" placeholder now that Sprint 4's views exist.
//
// GET /api/institutions/:institutionId/admin/aggregate-dashboard
// Auth: caller must hold role 'admin'.
//
// Returns every dimension that has cleared K_FLOOR for this institution —
// queries institutional_benchmark_segments directly for institution_id = X
// in one call, rather than 14 separate getBenchmarkForDimension() calls
// (that function is built for "one dimension the UI is currently showing",
// not "give me everything this institution has" — different shape of
// question, so a direct view query here rather than reusing it 14 times).
//
// Dimensions that HAVEN'T cleared the floor are simply absent from the
// response — same "absence is the mechanism" privacy pattern as
// everywhere else, not a list of "locked" dimensions with counts (that
// would need the same task-4-style authorized exception, which hasn't been
// extended to admin-facing dashboard use — worth a separate decision if
// wanted, not assumed here).

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

  const { data: rows, error } = await supabase
    .from('institutional_benchmark_segments')
    .select('*')
    .eq('institution_id', institutionId)
    .order('dim', { ascending: true })

  if (error) {
    console.error('[admin/aggregate-dashboard] query failed:', error.message)
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 })
  }

  return NextResponse.json({ segments: rows ?? [] })
}
