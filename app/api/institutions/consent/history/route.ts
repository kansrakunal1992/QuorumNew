// app/api/institutions/consent/history/route.ts
// Tier 3 — a member's own consent-toggle history. consent_audit_log's RLS
// (Sprint 2) already permits a user to read their own rows directly
// (auth.uid() = user_id) — this route exists for consistency with every
// other institutional route in this build (service-client-via-API-route,
// not direct client-side Supabase queries), not because RLS required it.
//
// GET /api/institutions/consent/history
// Returns the caller's own consent_audit_log rows, most recent first.
// Nothing here that admins can't already see in aggregate — this is
// strictly the member's OWN full detail on their OWN history, which even
// admins never get (see app/api/institutions/[institutionId]/consent-changes:
// admins only ever see counts, never identity — that constraint has nothing
// to do with this route, which is a user reading their own data).

import { NextResponse }               from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase'
import { isInstitutionalModeEnabled } from '@/lib/feature-flags'

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
  const { data, error } = await supabase
    .from('consent_audit_log')
    .select('field_changed, old_value, new_value, changed_at, institution_id, institutions(name)')
    .eq('user_id', userId)
    .order('changed_at', { ascending: false })
    .limit(100)

  if (error) {
    console.error('[consent/history] query failed:', error.message)
    return NextResponse.json({ error: 'Failed to load history' }, { status: 500 })
  }

  return NextResponse.json({ history: data ?? [] })
}
