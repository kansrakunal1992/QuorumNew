// app/api/institutions/active/route.ts
// Institutional Sprint 5 (tasks 1/2) — read/write the caller's active
// institution context.
//
// GET  /api/institutions/active
//   Returns { institutionId, institutionName, memberships } — memberships
//   is the full list (for the switcher dropdown), the other two fields are
//   the currently-resolved active one. institutionId is null (and
//   memberships is empty) for a user with zero institution_memberships —
//   the caller (InstitutionModeBadge) treats that as "render nothing".
//
// POST /api/institutions/active
//   Body: { institutionId: string } — must be one of the caller's own
//   memberships (checked server-side in lib/active-institution.ts,
//   ignoring what the client claims beyond that).
//
// Gated behind NEXT_PUBLIC_INSTITUTIONAL_MODE_ENABLED, same as every other
// institution route.

import { NextResponse }               from 'next/server'
import { createClient }               from '@/lib/supabase'
import { isInstitutionalModeEnabled } from '@/lib/feature-flags'
import { resolveActiveInstitution, setActiveInstitution } from '@/lib/active-institution'

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

export async function GET(req: Request): Promise<NextResponse> {
  if (!isInstitutionalModeEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const userId = await resolveUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const info = await resolveActiveInstitution(userId)
  return NextResponse.json(info)
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isInstitutionalModeEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const userId = await resolveUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { institutionId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  if (!body.institutionId) return NextResponse.json({ error: 'institutionId is required' }, { status: 400 })

  const ok = await setActiveInstitution(userId, body.institutionId)
  if (!ok) return NextResponse.json({ error: 'Not a member of that institution' }, { status: 403 })

  return NextResponse.json({ institutionId: body.institutionId })
}
