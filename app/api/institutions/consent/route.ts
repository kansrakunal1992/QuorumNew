// app/api/institutions/consent/route.ts
// Institutional Sprint 2 — read + write a user's own consent flags.
//
// GET  /api/institutions/consent
//   Returns every institution_memberships row for the caller (a user can
//   belong to more than one institution — plan Section 1.5), each with its
//   institution name and current consent flags. Powers
//   components/InstitutionConsentSettings.tsx.
//
// POST /api/institutions/consent
//   Body: { institutionId: string, field: 'consent_aggregate' | 'consent_aggregate_backfill' | 'consent_shared_cohort', value: boolean }
//   Updates the caller's own membership row for exactly one field, and
//   writes a matching consent_audit_log row in the same request.
//   consent_aggregate and consent_aggregate_backfill are always two separate
//   calls from the UI (never bundled) per plan Section 4 task 1 — this
//   route enforces that by only ever accepting a single field per call, not
//   an object of fields.
//
// Gated behind NEXT_PUBLIC_INSTITUTIONAL_MODE_ENABLED, same as every other
// institution route.
//
// Note on atomicity: the update + audit-log insert are two separate calls,
// not one DB transaction. If the audit insert fails after the update
// succeeds, the consent change still took effect but goes unlogged (an
// error is logged server-side either way). Worth tightening to a single
// supabase.rpc() call wrapping both writes in a Postgres function if that
// gap matters enough to close before Sprint 3 — flagging it rather than
// quietly shipping best-effort logging as if it were guaranteed.

import { NextResponse }                      from 'next/server'
import { createServiceClient, createClient } from '@/lib/supabase'
import { isInstitutionalModeEnabled }        from '@/lib/feature-flags'

const TOGGLE_FIELDS = ['consent_aggregate', 'consent_aggregate_backfill', 'consent_shared_cohort'] as const
type ToggleField = typeof TOGGLE_FIELDS[number]

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

  const supabase = createServiceClient()
  const { data: memberships, error } = await supabase
    .from('institution_memberships')
    .select('institution_id, role, consent_aggregate, consent_aggregate_backfill, consent_shared_cohort, institutions(name)')
    .eq('user_id', userId)

  if (error) {
    console.error('[institutions/consent] GET failed:', error.message)
    return NextResponse.json({ error: 'Failed to load consent settings' }, { status: 500 })
  }

  return NextResponse.json({ memberships: memberships ?? [] })
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isInstitutionalModeEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const userId = await resolveUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { institutionId?: string; field?: string; value?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { institutionId, field, value } = body
  if (!institutionId || typeof value !== 'boolean' || !TOGGLE_FIELDS.includes(field as ToggleField)) {
    return NextResponse.json({ error: 'institutionId, a valid field, and a boolean value are required' }, { status: 400 })
  }
  const toggleField = field as ToggleField

  const supabase = createServiceClient()

  const { data: existing, error: fetchError } = await supabase
    .from('institution_memberships')
    .select(`id, ${toggleField}`)
    .eq('institution_id', institutionId)
    .eq('user_id', userId)
    .maybeSingle()

  if (fetchError) {
    console.error('[institutions/consent] fetch failed:', fetchError.message)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }
  if (!existing) return NextResponse.json({ error: 'Not a member of this institution' }, { status: 403 })

  const oldValue = Boolean((existing as Record<string, unknown>)[toggleField])

  const { error: updateError } = await supabase
    .from('institution_memberships')
    .update({ [toggleField]: value })
    .eq('id', (existing as { id: string }).id)

  if (updateError) {
    console.error('[institutions/consent] update failed:', updateError.message)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  const { error: auditError } = await supabase
    .from('consent_audit_log')
    .insert({
      user_id:        userId,
      institution_id: institutionId,
      field_changed:  toggleField,
      old_value:      oldValue,
      new_value:      value,
    })

  if (auditError) {
    // Consent change already took effect — log the gap, don't roll back or
    // fail the request over it (see atomicity note above).
    console.error('[institutions/consent] audit log insert failed (change still applied):', auditError.message)
  }

  return NextResponse.json({ field: toggleField, value })
}
