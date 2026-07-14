// app/api/institutions/[institutionId]/admin/cohorts/[cohortId]/route.ts
// Tier 2 — cohort membership management. Admin-only, RBAC-gated.
//
// POST /api/institutions/:institutionId/admin/cohorts/:cohortId
//   Body: { action: 'add_member' | 'remove_member', userId: string }
//   add_member verifies the target is actually a member of THIS institution
//   first — a cohort can't contain someone who isn't even in the
//   institution it belongs to.
//
// DELETE /api/institutions/:institutionId/admin/cohorts/:cohortId
//   Deletes the cohort and (via cohort_memberships' ON DELETE CASCADE) all
//   its membership rows. Does not touch institution_memberships — removing
//   a cohort never removes anyone from the institution itself.

import { NextResponse }               from 'next/server'
import { createServiceClient }        from '@/lib/supabase'
import { isInstitutionalModeEnabled } from '@/lib/feature-flags'
import { requireInstitutionRole }     from '@/lib/institution-auth'

async function verifyCohortBelongsToInstitution(
  supabase: ReturnType<typeof createServiceClient>, cohortId: string, institutionId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('cohorts')
    .select('id')
    .eq('id', cohortId)
    .eq('institution_id', institutionId)
    .maybeSingle()
  return !!data
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ institutionId: string; cohortId: string }> },
): Promise<NextResponse> {
  if (!isInstitutionalModeEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { institutionId, cohortId } = await params
  const auth = await requireInstitutionRole(req, institutionId, ['admin'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = createServiceClient()
  if (!(await verifyCohortBelongsToInstitution(supabase, cohortId, institutionId))) {
    return NextResponse.json({ error: 'Cohort not found in this institution' }, { status: 404 })
  }

  let body: { action?: string; userId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  if (!body.userId || !['add_member', 'remove_member'].includes(body.action ?? '')) {
    return NextResponse.json({ error: "userId and action ('add_member' | 'remove_member') are required" }, { status: 400 })
  }

  if (body.action === 'add_member') {
    const { data: membership } = await supabase
      .from('institution_memberships')
      .select('id')
      .eq('institution_id', institutionId)
      .eq('user_id', body.userId)
      .maybeSingle()

    if (!membership) {
      return NextResponse.json({ error: 'That person is not a member of this institution' }, { status: 400 })
    }

    const { error } = await supabase
      .from('cohort_memberships')
      .insert({ cohort_id: cohortId, user_id: body.userId })

    // Unique constraint violation = already in the cohort — treat as success,
    // not an error, since the end state the caller wanted is already true.
    if (error && error.code !== '23505') {
      console.error('[admin/cohorts] add_member failed:', error.message)
      return NextResponse.json({ error: 'Failed to add member' }, { status: 500 })
    }
  } else {
    const { error } = await supabase
      .from('cohort_memberships')
      .delete()
      .eq('cohort_id', cohortId)
      .eq('user_id', body.userId)

    if (error) {
      console.error('[admin/cohorts] remove_member failed:', error.message)
      return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ institutionId: string; cohortId: string }> },
): Promise<NextResponse> {
  if (!isInstitutionalModeEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { institutionId, cohortId } = await params
  const auth = await requireInstitutionRole(req, institutionId, ['admin'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = createServiceClient()
  if (!(await verifyCohortBelongsToInstitution(supabase, cohortId, institutionId))) {
    return NextResponse.json({ error: 'Cohort not found in this institution' }, { status: 404 })
  }

  const { error } = await supabase.from('cohorts').delete().eq('id', cohortId)
  if (error) {
    console.error('[admin/cohorts] delete failed:', error.message)
    return NextResponse.json({ error: 'Failed to delete cohort' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
