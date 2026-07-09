// app/api/institutions/[institutionId]/admin/roster/route.ts
// Institutional Sprint 3 (task 3) — roster view. Admin-only, RBAC-gated via
// the Sprint 2 shared guard.
//
// GET /api/institutions/:institutionId/admin/roster
// Returns: [{ userId, email, role, joinedAt }, ...] — nothing else. No
// consent flags, no session/bias data — this route is membership metadata
// only, matching plan Section 4 task 3's roster scope exactly.
//
// Note on cost (flagged, not fixed this sprint): there's no bulk
// "getUsersByIds" in supabase-js, so this resolves one email per member via
// auth.admin.getUserById — an N+1 pattern. Fine for a skeleton-stage roster
// at small-to-mid institution size; before rolling out to the largest
// institution tier (plan Section 1.1's higher-seat tiers), replace this
// with a Postgres function that joins institution_memberships to
// auth.users directly in one round trip. There is also no separate "name"
// field anywhere in this codebase yet (no profiles table) — email is the
// only identifier available, same as bias_library's existing user_email
// convention.

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

  const roster = await Promise.all(
    (memberships ?? []).map(async m => {
      let email: string | null = null
      try {
        const { data } = await supabase.auth.admin.getUserById(m.user_id)
        email = data.user?.email ?? null
      } catch {
        // leave email null rather than failing the whole roster over one lookup
      }
      return { userId: m.user_id, email, role: m.role, joinedAt: m.joined_at }
    }),
  )

  return NextResponse.json({ roster })
}
