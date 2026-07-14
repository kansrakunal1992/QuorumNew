// app/api/institutions/[institutionId]/admin/cohorts/route.ts
// Tier 2 — cohort management. Admin-only, RBAC-gated.
//
// GET  /api/institutions/:institutionId/admin/cohorts
//   Lists every cohort in this institution with its current member list
//   (userId + email, resolved the same N+1 way as the roster route — same
//   documented scaling caveat applies).
//
// POST /api/institutions/:institutionId/admin/cohorts
//   Body: { name: string } — creates an empty cohort. Members are added
//   separately via the [cohortId] route, since "create" and "populate" are
//   different actions with different failure modes worth keeping distinct.

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

  const { data: cohorts, error } = await supabase
    .from('cohorts')
    .select('id, name, created_at')
    .eq('institution_id', institutionId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[admin/cohorts] list failed:', error.message)
    return NextResponse.json({ error: 'Failed to load cohorts' }, { status: 500 })
  }

  const withMembers = await Promise.all((cohorts ?? []).map(async cohort => {
    const { data: memberships } = await supabase
      .from('cohort_memberships')
      .select('user_id')
      .eq('cohort_id', cohort.id)

    const members = await Promise.all((memberships ?? []).map(async m => {
      let email: string | null = null
      try {
        const { data } = await supabase.auth.admin.getUserById(m.user_id)
        email = data.user?.email ?? null
      } catch { /* leave null rather than failing the whole list */ }
      return { userId: m.user_id, email }
    }))

    return { ...cohort, members }
  }))

  return NextResponse.json({ cohorts: withMembers })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ institutionId: string }> },
): Promise<NextResponse> {
  if (!isInstitutionalModeEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { institutionId } = await params
  const auth = await requireInstitutionRole(req, institutionId, ['admin'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: { name?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const name = (body.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('cohorts')
    .insert({ institution_id: institutionId, name })
    .select('id, name, created_at')
    .single()

  if (error) {
    console.error('[admin/cohorts] create failed:', error.message)
    return NextResponse.json({ error: 'Failed to create cohort' }, { status: 500 })
  }

  return NextResponse.json({ cohort: data }, { status: 201 })
}
