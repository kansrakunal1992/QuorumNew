// app/api/institutions/[institutionId]/admin/roster/route.ts
// Institutional Sprint 3 (task 3) — roster view. Admin-only, RBAC-gated via
// the Sprint 2 shared guard.
//
// GET /api/institutions/:institutionId/admin/roster
// Returns: [{ userId, email, role, joinedAt }, ...] — nothing else. No
// consent flags, no session/bias data — this route is membership metadata
// only, matching plan Section 4 task 3's roster scope exactly.
//
// TECH_DEBT.md #2 fix: email resolution used to be one auth.admin.getUserById()
// call per member (N+1). Now a single get_user_emails() RPC call
// (supabase/institutional_tech_debt_fixes.sql Part 3) joining directly to
// auth.users for the whole roster at once — one round trip regardless of
// institution size. lib/cohort-insights.ts moved to the same function in
// the same pass, per the tracker's own note that both call sites should be
// fixed together. There is still no separate "name" field anywhere in this
// codebase (no profiles table) — email remains the only identifier
// available, same as bias_library's existing user_email convention.

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

  const { data: memberships, error } = await supabase
    .from('institution_memberships')
    .select('user_id, role, joined_at')
    .eq('institution_id', institutionId)
    .order('joined_at', { ascending: true })

  if (error) {
    console.error('[admin/roster] query failed:', error.message)
    return NextResponse.json({ error: 'Failed to load roster' }, { status: 500 })
  }

  const userIds = (memberships ?? []).map(m => m.user_id)
  const emailByUserId = new Map<string, string>()

  if (userIds.length > 0) {
    const { data: emailRows, error: emailError } = await supabase
      .rpc('get_user_emails', { p_user_ids: userIds })

    if (emailError) {
      // Same fallback posture as before: don't fail the whole roster over
      // email resolution — return it with emails null rather than a 500.
      console.error('[admin/roster] get_user_emails failed:', emailError.message)
    } else {
      for (const row of (emailRows ?? []) as { user_id: string; email: string | null }[]) {
        if (row.email) emailByUserId.set(row.user_id, row.email)
      }
    }
  }

  const roster = (memberships ?? []).map(m => ({
    userId:  m.user_id,
    email:   emailByUserId.get(m.user_id) ?? null,
    role:    m.role,
    joinedAt: m.joined_at,
  }))

  return NextResponse.json({ roster })
}
