// lib/institution-auth.ts
// Institutional Sprint 2 (task 3) — the single shared RBAC guard used by
// every institution-scoped route that needs a role check. Written once,
// applied everywhere, so there's exactly one place to audit rather than N
// scattered checks.
//
// Does NOT replace the master isInstitutionalModeEnabled() flag check —
// every route still checks that first and 404s if it's off. This guard only
// answers "is this authenticated user an admin/member of this institution."
//
// First caller: app/api/institutions/[institutionId]/consent-changes.
// Sprint 3's admin portal routes (roster, code management, RBAC assignment)
// import this rather than re-implementing their own check.

import { createClient, createServiceClient } from '@/lib/supabase'

export type InstitutionRole = 'admin' | 'member'

export interface InstitutionAuthResult {
  userId: string
  role: InstitutionRole
}

export type InstitutionAuthOutcome =
  | { ok: true; auth: InstitutionAuthResult }
  | { ok: false; status: number; error: string }

async function resolveUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  try {
    const anon = createClient()
    const { data: { user } } = await anon.auth.getUser(authHeader.slice(7).trim())
    return user?.id ?? null
  } catch {
    return null
  }
}

// Checks the caller is authenticated AND holds one of `allowedRoles` on
// `institutionId`. Returns a discriminated result instead of throwing, so
// callers can turn a failure straight into a NextResponse without a
// try/catch at every call site:
//
//   const auth = await requireInstitutionRole(req, institutionId, ['admin'])
//   if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
export async function requireInstitutionRole(
  req: Request,
  institutionId: string,
  allowedRoles: InstitutionRole[],
): Promise<InstitutionAuthOutcome> {
  const userId = await resolveUserId(req)
  if (!userId) return { ok: false, status: 401, error: 'Unauthorized' }

  const supabase = createServiceClient()
  const { data: membership, error } = await supabase
    .from('institution_memberships')
    .select('role')
    .eq('institution_id', institutionId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('[institution-auth] membership lookup failed:', error.message)
    return { ok: false, status: 500, error: 'Authorization check failed' }
  }
  if (!membership) return { ok: false, status: 403, error: 'Not a member of this institution' }

  const role = membership.role as InstitutionRole
  if (!allowedRoles.includes(role)) {
    return { ok: false, status: 403, error: 'Insufficient role for this action' }
  }

  return { ok: true, auth: { userId, role } }
}
