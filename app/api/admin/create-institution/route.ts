// app/api/admin/create-institution/route.ts
// Institutional Sprint 1 — ops tool for minting institutions + unlock codes.
//
// POST /api/admin/create-institution
// Auth: x-admin-key header must equal SUPABASE_SERVICE_ROLE_KEY — same guard
// as grant-mirror-access. No admin UI yet, so this is called via curl/Postman
// by ops until Sprint 3's admin portal ships code management.
//
// Also gated behind NEXT_PUBLIC_INSTITUTIONAL_MODE_ENABLED, same as every
// other institution-related route, so the whole layer stays inert with the
// flag off even if this route were hit directly.
//
// Body:
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

export async function POST(req: Request) {
  if (!isInstitutionalModeEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const adminKey = req.headers.get('x-admin-key')
  if (adminKey !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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
