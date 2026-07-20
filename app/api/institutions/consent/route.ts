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
// Tech debt #1 fix: the update + audit-log insert used to be two separate
// calls, not one DB transaction — see git history / TECH_DEBT.md for the
// old version and the gap it left. Now routed through toggle_consent(),
// a single Postgres function (supabase/institutional_tech_debt_fixes.sql
// Part 2) that does both writes in one transaction, so an audit-insert
// failure can no longer leave the membership row changed with no logged
// record of it. That function also owns the consent_aggregate_granted_at
// side effect (Part 1 of the same file) that makes consent_aggregate_
// backfill's existing UI (InstitutionConsentSettings.tsx's modal) actually
// mean something to the aggregate views, instead of being collected and
// silently ignored.

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

  // One transaction: validates membership exists, applies the field
  // change, manages consent_aggregate_granted_at when relevant, and writes
  // the audit log row — all inside toggle_consent() itself. No separate
  // pre-fetch needed here; the function raises if there's no membership
  // row, which we translate to the same 403 this route always returned.
  const { data: rows, error } = await supabase
    .rpc('toggle_consent', {
      p_user_id:        userId,
      p_institution_id: institutionId,
      p_field:          toggleField,
      p_value:          value,
    })

  if (error) {
    if (error.message?.includes('no membership')) {
      return NextResponse.json({ error: 'Not a member of this institution' }, { status: 403 })
    }
    console.error('[institutions/consent] toggle_consent failed:', error.message)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  const updated = rows?.[0]
  return NextResponse.json({
    field: toggleField,
    value,
    // Returned so the client can show the new "since when" date without a
    // second round trip — not currently read by InstitutionConsentSettings.tsx,
    // available if that ever wants to surface it (e.g. "sharing since Jul 17").
    consentAggregateGrantedAt: updated?.consent_aggregate_granted_at ?? null,
  })
}
