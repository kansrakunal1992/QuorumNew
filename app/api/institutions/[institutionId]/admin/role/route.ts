// app/api/institutions/[institutionId]/admin/role/route.ts
// Institutional Sprint 3 (task 3) — RBAC assignment. Admin-only, RBAC-gated.
//
// POST /api/institutions/:institutionId/admin/role
// Body: { userId: string, role: 'admin' | 'member' }
//
// Refuses to demote the institution's last remaining admin to 'member' —
// not in the plan doc explicitly, but a direct consequence of the RBAC
// model: with zero admins, no one could ever promote anyone back, locking
// the institution out of its own admin routes permanently. Flagging this
// addition here rather than adding it silently.

import { NextResponse }               from 'next/server'
import { createServiceClient }        from '@/lib/supabase'
import { isInstitutionalModeEnabled } from '@/lib/feature-flags'
import { requireInstitutionRole }     from '@/lib/institution-auth'

const VALID_ROLES = ['admin', 'member'] as const

export async function POST(
  req: Request,
  { params }: { params: Promise<{ institutionId: string }> },
): Promise<NextResponse> {
  if (!isInstitutionalModeEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { institutionId } = await params
  const auth = await requireInstitutionRole(req, institutionId, ['admin'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: { userId?: string; role?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { userId, role } = body
  if (!userId || !VALID_ROLES.includes(role as typeof VALID_ROLES[number])) {
    return NextResponse.json({ error: "userId and a valid role ('admin' | 'member') are required" }, { status: 400 })
  }

  const supabase = createServiceClient()

  if (role === 'member') {
    const { data: target } = await supabase
      .from('institution_memberships')
      .select('role')
      .eq('institution_id', institutionId)
      .eq('user_id', userId)
      .maybeSingle()

    if (target?.role === 'admin') {
      const { count } = await supabase
        .from('institution_memberships')
        .select('id', { count: 'exact', head: true })
        .eq('institution_id', institutionId)
        .eq('role', 'admin')

      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          { error: 'Cannot demote the last remaining admin — promote someone else first' },
          { status: 409 },
        )
      }
    }
  }

  const { data: updated, error } = await supabase
    .from('institution_memberships')
    .update({ role })
    .eq('institution_id', institutionId)
    .eq('user_id', userId)
    .select('user_id, role')
    .maybeSingle()

  if (error) {
    console.error('[admin/role] update failed:', error.message)
    return NextResponse.json({ error: 'Role update failed' }, { status: 500 })
  }
  if (!updated) return NextResponse.json({ error: 'Not a member of this institution' }, { status: 404 })

  console.log(`[admin/role] ${auth.auth.userId} set ${userId} to '${role}' in institution ${institutionId}`)
  return NextResponse.json({ userId: updated.user_id, role: updated.role })
}
