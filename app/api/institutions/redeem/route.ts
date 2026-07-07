// app/api/institutions/redeem/route.ts
// Institutional Sprint 1 — unlock code redemption.
//
// POST /api/institutions/redeem
// Body: { code: string }
// Auth: Bearer token required — same resolveUserId pattern as Watchlist.
//
// Gated behind NEXT_PUBLIC_INSTITUTIONAL_MODE_ENABLED (lib/feature-flags.ts).
// When the flag is off, returns 404 rather than any institution-shaped
// response, so the whole layer looks absent, not broken.
//
// Codes are NOT a Watchlist/Mirror-style shared env-var secret. Each
// institution gets its own code, generated fresh per institution and hashed
// with SHA-256 into institutions.unlock_code_hash (see
// app/api/admin/create-institution). A leak of one institution's code can
// only ever redeem membership in that institution — lookup is by hash
// match, not a single global value, so it structurally cannot work for a
// different org. The optional allowed_email_domains check below handles the
// narrower case of a leaked code being used by people outside that org.

import { NextResponse }                      from 'next/server'
import { createServiceClient, createClient } from '@/lib/supabase'
import { createHash }                        from 'crypto'
import { isInstitutionalModeEnabled }        from '@/lib/feature-flags'

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

function hashCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex')
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isInstitutionalModeEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const userId = await resolveUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { code?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const code = (body.code ?? '').trim()
  if (!code) return NextResponse.json({ error: 'code is required' }, { status: 400 })

  const supabase = createServiceClient()

  const { data: institution, error: lookupError } = await supabase
    .from('institutions')
    .select('id, allowed_email_domains, admin_seat_claimed')
    .eq('unlock_code_hash', hashCode(code))
    .maybeSingle()

  if (lookupError) {
    console.error('[institutions/redeem] lookup failed:', lookupError.message)
    return NextResponse.json({ error: 'Redemption failed' }, { status: 500 })
  }
  if (!institution) {
    // Intentionally vague — same posture as mirror/unlock's invalid-code response
    return NextResponse.json({ error: 'Invalid unlock code' }, { status: 403 })
  }

  if (institution.allowed_email_domains?.length) {
    const { data: { user } } = await supabase.auth.admin.getUserById(userId)
    const domain = user?.email?.split('@')[1]?.toLowerCase()
    const allowed = institution.allowed_email_domains.map((d: string) => d.toLowerCase())
    if (!domain || !allowed.includes(domain)) {
      return NextResponse.json({ error: 'Email domain not permitted for this institution' }, { status: 403 })
    }
  }

  const { data: existing } = await supabase
    .from('institution_memberships')
    .select('id, role')
    .eq('institution_id', institution.id)
    .eq('user_id', userId)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ institutionId: institution.id, role: existing.role, status: 'already_member' })
  }

  // First redemption becomes admin — atomic flip on admin_seat_claimed so two
  // simultaneous first-redemptions can't both win the admin seat.
  let role: 'admin' | 'member' = 'member'
  if (!institution.admin_seat_claimed) {
    const { data: claimed } = await supabase
      .from('institutions')
      .update({ admin_seat_claimed: true })
      .eq('id', institution.id)
      .eq('admin_seat_claimed', false)
      .select('id')
      .maybeSingle()
    if (claimed) role = 'admin'
  }

  const { data: membership, error: insertError } = await supabase
    .from('institution_memberships')
    .insert({ institution_id: institution.id, user_id: userId, role })
    .select('id, role')
    .single()

  if (insertError) {
    console.error('[institutions/redeem] insert failed:', insertError.message)
    return NextResponse.json({ error: 'Redemption failed' }, { status: 500 })
  }

  console.log(`[institutions/redeem] ${userId} joined ${institution.id} as ${role}`)

  return NextResponse.json(
    { institutionId: institution.id, role: membership.role, status: 'joined' },
    { status: 201 },
  )
}
