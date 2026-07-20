// app/api/institutions/[institutionId]/admin/request-deactivation/route.ts
// Tech-debt-fix addition — flag-only, per KDD (confirmed): the actual
// deactivation gate stays platform-admin-only (ADMIN_CODE, see
// app/api/admin/create-institution/route.ts) — an institution's own admin
// cannot deactivate their org unilaterally, since deactivation has
// billing/relationship implications outside this admin's authority. This
// route only lets an institution admin ask — the request surfaces as a
// flag on the platform admin's own institutions panel
// (components/CreateInstitutionPanel.tsx) for manual review.
//
// POST /api/institutions/:institutionId/admin/request-deactivation
// No body needed — this is a same-institution action taken on behalf of
// the authenticated admin caller, not a targeted action on someone else
// (unlike admin/role, which acts on a different userId).
//
// Deliberately idempotent-safe: calling this again while a request is
// already pending just refreshes deactivation_requested_at/by rather than
// erroring — a second admin re-flagging (or the same admin re-confirming)
// is a reasonable thing to allow, not a conflict to reject.

import { NextResponse }               from 'next/server'
import { createServiceClient }        from '@/lib/supabase'
import { isInstitutionalModeEnabled } from '@/lib/feature-flags'
import { requireInstitutionRole }     from '@/lib/institution-auth'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ institutionId: string }> },
): Promise<NextResponse> {
  if (!isInstitutionalModeEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { institutionId } = await params
  const auth = await requireInstitutionRole(req, institutionId, ['admin'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = createServiceClient()

  const { data: updated, error } = await supabase
    .from('institutions')
    .update({
      deactivation_requested_at: new Date().toISOString(),
      deactivation_requested_by: auth.auth.userId,
    })
    .eq('id', institutionId)
    .select('id, deactivation_requested_at')
    .maybeSingle()

  if (error) {
    console.error('[admin/request-deactivation] update failed:', error.message)
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
  if (!updated) return NextResponse.json({ error: 'Institution not found' }, { status: 404 })

  console.log(`[admin/request-deactivation] ${auth.auth.userId} requested deactivation for institution ${institutionId}`)
  return NextResponse.json({
    institutionId: updated.id,
    deactivationRequestedAt: updated.deactivation_requested_at,
  })
}

// DELETE — an institution admin changing their mind and withdrawing the
// request, distinct from the platform admin's own "dismiss" action (which
// goes through app/api/admin/create-institution's PATCH instead, since
// that route already owns every other institutions-table mutation the
// platform admin makes).
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ institutionId: string }> },
): Promise<NextResponse> {
  if (!isInstitutionalModeEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { institutionId } = await params
  const auth = await requireInstitutionRole(req, institutionId, ['admin'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = createServiceClient()

  const { error } = await supabase
    .from('institutions')
    .update({ deactivation_requested_at: null, deactivation_requested_by: null })
    .eq('id', institutionId)

  if (error) {
    console.error('[admin/request-deactivation] withdraw failed:', error.message)
    return NextResponse.json({ error: 'Withdraw failed' }, { status: 500 })
  }

  return NextResponse.json({ withdrawn: true })
}
