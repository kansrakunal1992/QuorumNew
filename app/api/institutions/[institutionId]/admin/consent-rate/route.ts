// app/api/institutions/[institutionId]/admin/consent-rate/route.ts
// Institutional Sprint 5 (task 7) — admin consent-rate dashboard.
//
// GET /api/institutions/:institutionId/admin/consent-rate
// Auth: caller must hold role 'admin' (lib/institution-auth.ts).
//
// Per the answered question: floor-gated like the benchmark views, not
// exact-always. For a 6-person institution, "75% opted in" nearly reveals
// who specifically. Returns { belowFloor: true, memberCount } instead of a
// rate until total membership itself clears K_FLOOR — deliberately gated on
// TOTAL membership count, not on how many have consented, since gating on
// the consenting count would leak almost the same information the gate
// exists to hide (a rate that only appears once enough people consented
// tells you consent is high, even without a number).

import { NextResponse }               from 'next/server'
import { createServiceClient }        from '@/lib/supabase'
import { isInstitutionalModeEnabled } from '@/lib/feature-flags'
import { requireInstitutionRole }     from '@/lib/institution-auth'
import { effectiveKFloor }            from '@/lib/k-floor'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ institutionId: string }> },
): Promise<NextResponse> {
  if (!isInstitutionalModeEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { institutionId } = await params
  const auth = await requireInstitutionRole(req, institutionId, ['admin'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = createServiceClient()

  const { data: institution } = await supabase
    .from('institutions')
    .select('k_floor_override')
    .eq('id', institutionId)
    .maybeSingle()
  const kFloor = effectiveKFloor(institution?.k_floor_override)

  const { count: memberCount, error: countError } = await supabase
    .from('institution_memberships')
    .select('id', { count: 'exact', head: true })
    .eq('institution_id', institutionId)

  if (countError) {
    console.error('[admin/consent-rate] member count failed:', countError.message)
    return NextResponse.json({ error: 'Failed to load consent rate' }, { status: 500 })
  }

  const total = memberCount ?? 0
  if (total < kFloor) {
    return NextResponse.json({ belowFloor: true, memberCount: total, kFloor })
  }

  const [{ count: aggregateCount }, { count: cohortCount }] = await Promise.all([
    supabase.from('institution_memberships').select('id', { count: 'exact', head: true })
      .eq('institution_id', institutionId).eq('consent_aggregate', true),
    supabase.from('institution_memberships').select('id', { count: 'exact', head: true })
      .eq('institution_id', institutionId).eq('consent_shared_cohort', true),
  ])

  return NextResponse.json({
    belowFloor: false,
    memberCount: total,
    aggregateRate: Math.round(((aggregateCount ?? 0) / total) * 100),
    cohortRate: Math.round(((cohortCount ?? 0) / total) * 100),
  })
}
