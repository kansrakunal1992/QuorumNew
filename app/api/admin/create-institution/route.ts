// app/api/admin/create-institution/route.ts
// Institutional Sprint 1, auth fixed Sprint 6 — ops tool for minting
// institutions + unlock codes.
//
// Auth: Authorization: Bearer <ADMIN_CODE> — same credential as
// app/api/admin/dashboard and app/api/admin/audit-log, which is what
// app/admin/page.tsx (the founder's actual admin UI) authenticates with and
// stores in sessionStorage. The original version of this route checked
// `x-admin-key === SUPABASE_SERVICE_ROLE_KEY` instead (matching
// grant-mirror-access's older convention) — that meant the founder's own
// admin page had no credential it could actually send here: it only ever
// holds ADMIN_CODE, never the raw Supabase service role key, by design
// (that key should never touch a browser at all — sessionStorage is
// readable by anything running in that tab, and the service role key
// bypasses every RLS policy in the database). Fixed to the ADMIN_CODE
// pattern so components/CreateInstitutionPanel.tsx can actually call this
// from the founder's real, already-authenticated session.
//
// GET  /api/admin/create-institution  — lists all institutions (for the panel's table)
// POST /api/admin/create-institution  — creates one, returns its one-time unlock code
//
// Also gated behind NEXT_PUBLIC_INSTITUTIONAL_MODE_ENABLED, same as every
// other institution-related route, so the whole layer stays inert with the
// flag off even if this route were hit directly.
//
// POST body:
//   {
//     name: string
//     parentInstitutionId?: string
//     kFloorOverride?: number
//     allowedEmailDomains?: string[]   — optional redemption lock
//   }
//
// Generates a fresh, cryptographically random code on every call — this is
// what makes "each institution gets a different code" automatic rather than
// something ops has to remember to do by hand. Only the SHA-256 hash is
// written to institutions.unlock_code_hash; the plaintext code is returned
// once in the response and must be delivered to the institution admin
// out-of-band (Slack DM / call — not a doc that gets forwarded).

import { NextResponse }               from 'next/server'
import { createServiceClient }        from '@/lib/supabase'
import { isInstitutionalModeEnabled } from '@/lib/feature-flags'
import { randomBytes, createHash }    from 'crypto'

function generateUnlockCode(): string {
  return randomBytes(9).toString('hex').toUpperCase().match(/.{1,4}/g)!.join('-')
}

function hashCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex')
}

function checkAdminAuth(req: Request): boolean {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null
  return !!token && !!process.env.ADMIN_CODE && token === process.env.ADMIN_CODE
}

export async function GET(req: Request) {
  if (!isInstitutionalModeEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('institutions')
    .select('id, name, parent_institution_id, admin_seat_claimed, k_floor_override, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[create-institution] list failed:', error.message)
    return NextResponse.json({ error: 'Failed to load institutions' }, { status: 500 })
  }

  return NextResponse.json({ institutions: data ?? [] })
}

export async function POST(req: Request) {
  if (!isInstitutionalModeEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    name?: string
    parentInstitutionId?: string
    kFloorOverride?: number
    allowedEmailDomains?: string[]
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const name = (body.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const code = generateUnlockCode()
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('institutions')
    .insert({
      name,
      parent_institution_id: body.parentInstitutionId ?? null,
      unlock_code_hash:      hashCode(code),
      k_floor_override:      body.kFloorOverride ?? null,
      allowed_email_domains: body.allowedEmailDomains ?? null,
    })
    .select('id, name, created_at')
    .single()

  if (error) {
    console.error('[create-institution] insert failed:', error.message)
    return NextResponse.json({ error: 'Failed to create institution' }, { status: 500 })
  }

  console.log(`[create-institution] Created ${data.name} (${data.id})`)

  return NextResponse.json(
    {
      institution: data,
      unlockCode:  code,   // shown once — only the hash is stored, this can't be retrieved again
    },
    { status: 201 },
  )
}
