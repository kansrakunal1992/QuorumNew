// app/api/institutions/[institutionId]/admin/codes/route.ts
// Institutional Sprint 3 (task 3) — code management. Admin-only, RBAC-gated.
//
// GET /api/institutions/:institutionId/admin/codes
//   Returns status only — never the code itself, which is never retrievable
//   after creation/rotation (only its hash is stored). { adminSeatClaimed,
//   allowedEmailDomains, children: [{ id, name, createdAt }] }.
//
// POST /api/institutions/:institutionId/admin/codes
//   Body: { action: 'rotate' } — invalidates the current code, generates
//     and returns a new one (shown once). Does NOT reset admin_seat_claimed
//     — that flag is about who won the admin seat on first-ever redemption,
//     unrelated to later rotations.
//   Body: { action: 'create_child', name, allowedEmailDomains? } — mints a
//     "sub-code": a new institution with parent_institution_id set to this
//     one, and its own fresh code. Only the parent's admin can do this
//     (enforced by requireInstitutionRole against :institutionId — the
//     parent — not the child), matching plan Section 1.3's conglomerate
//     hierarchy.

import { NextResponse }               from 'next/server'
import { createServiceClient }        from '@/lib/supabase'
import { isInstitutionalModeEnabled } from '@/lib/feature-flags'
import { requireInstitutionRole }     from '@/lib/institution-auth'
import { randomBytes, createHash }    from 'crypto'

function generateUnlockCode(): string {
  return randomBytes(9).toString('hex').toUpperCase().match(/.{1,4}/g)!.join('-')
}

function hashCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex')
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ institutionId: string }> },
): Promise<NextResponse> {
  if (!isInstitutionalModeEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { institutionId } = await params
  const auth = await requireInstitutionRole(req, institutionId, ['admin'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = createServiceClient()

  const { data: institution, error } = await supabase
    .from('institutions')
    .select('admin_seat_claimed, allowed_email_domains')
    .eq('id', institutionId)
    .single()

  if (error) {
    console.error('[admin/codes] lookup failed:', error.message)
    return NextResponse.json({ error: 'Failed to load code status' }, { status: 500 })
  }

  const { data: children } = await supabase
    .from('institutions')
    .select('id, name, created_at')
    .eq('parent_institution_id', institutionId)

  return NextResponse.json({
    adminSeatClaimed:     institution.admin_seat_claimed,
    allowedEmailDomains:  institution.allowed_email_domains ?? [],
    children:             children ?? [],
  })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ institutionId: string }> },
): Promise<NextResponse> {
  if (!isInstitutionalModeEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { institutionId } = await params
  const auth = await requireInstitutionRole(req, institutionId, ['admin'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: { action?: string; name?: string; allowedEmailDomains?: string[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const supabase = createServiceClient()

  if (body.action === 'rotate') {
    const code = generateUnlockCode()
    const { error } = await supabase
      .from('institutions')
      .update({ unlock_code_hash: hashCode(code) })
      .eq('id', institutionId)

    if (error) {
      console.error('[admin/codes] rotate failed:', error.message)
      return NextResponse.json({ error: 'Rotation failed' }, { status: 500 })
    }

    console.log(`[admin/codes] ${auth.auth.userId} rotated the code for institution ${institutionId}`)
    return NextResponse.json({ unlockCode: code })
  }

  if (body.action === 'create_child') {
    const name = (body.name ?? '').trim()
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

    const code = generateUnlockCode()
    const { data, error } = await supabase
      .from('institutions')
      .insert({
        name,
        parent_institution_id: institutionId,
        unlock_code_hash:      hashCode(code),
        allowed_email_domains: body.allowedEmailDomains ?? null,
      })
      .select('id, name, created_at')
      .single()

    if (error) {
      console.error('[admin/codes] create_child failed:', error.message)
      return NextResponse.json({ error: 'Failed to create sub-institution' }, { status: 500 })
    }

    console.log(`[admin/codes] ${auth.auth.userId} created child institution ${data.id} under ${institutionId}`)
    return NextResponse.json({ institution: data, unlockCode: code }, { status: 201 })
  }

  return NextResponse.json({ error: "action must be 'rotate' or 'create_child'" }, { status: 400 })
}
