// app/api/institutions/[institutionId]/consent-changes/route.ts
// Institutional Sprint 2 — admin-only aggregate view of consent-log activity.
//
// GET /api/institutions/:institutionId/consent-changes
// Auth: caller must hold role 'admin' on this institution (lib/institution-auth.ts).
//
// Returns COUNTS of consent changes per field over the last 7 days — e.g.
// "3 members changed consent_aggregate this week" — and nothing about which
// members. Per plan Section 4 task 2: institution admins get aggregate
// visibility into consent activity, never individual attribution. The query
// below only ever selects field_changed and changed_at, never user_id, so
// this is enforced by the query shape itself, not just by response
// formatting.
//
// This is also the first real caller of requireInstitutionRole() — the
// shared guard Sprint 3's admin portal routes (roster, code management,
// RBAC assignment) will reuse rather than re-implementing their own check.

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
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: rows, error } = await supabase
    .from('consent_audit_log')
    .select('field_changed, changed_at')
    .eq('institution_id', institutionId)
    .gte('changed_at', since)

  if (error) {
    console.error('[consent-changes] query failed:', error.message)
    return NextResponse.json({ error: 'Failed to load consent activity' }, { status: 500 })
  }

  const counts: Record<string, number> = {}
  for (const row of rows ?? []) {
    counts[row.field_changed] = (counts[row.field_changed] ?? 0) + 1
  }

  return NextResponse.json({ since, counts })
}
