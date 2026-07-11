// app/api/admin/invite-codes/route.ts
// Item #16 — admin-side generation and listing of individual HNI invite
// codes. Same auth convention as the rest of /api/admin/*: Authorization:
// Bearer <ADMIN_CODE>.
//
// POST → generates a new code, returns the PLAINTEXT code exactly once
//        (only the SHA-256 hash is ever stored — same posture as
//        institutions/create). Copy it immediately; it cannot be retrieved
//        again after this response.
// GET  → lists existing codes with redemption counts (no plaintext, since
//        it was never stored).

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { createHash, randomBytes } from 'crypto'

function checkAuth(req: Request): boolean {
  const auth  = req.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  return !!token && !!process.env.ADMIN_CODE && token === process.env.ADMIN_CODE
}

function hashCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex')
}

// Short, human-typeable code — e.g. QUORUM-7F3K9A
function generateCode(): string {
  return 'QUORUM-' + randomBytes(5).toString('hex').toUpperCase().slice(0, 6)
}

export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('individual_invite_codes')
    .select('id, label, max_redemptions, redemption_count, expires_at, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[Admin Invite Codes] DB error:', error)
    return NextResponse.json({ error: 'Failed to load invite codes' }, { status: 500 })
  }
  return NextResponse.json({ codes: data ?? [] })
}

export async function POST(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { label?: string; expiresInDays?: number }
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const plainCode = generateCode()
  const supabase  = createServiceClient()

  const { error } = await supabase.from('individual_invite_codes').insert({
    code_hash:  hashCode(plainCode),
    label:      body.label?.trim() || null,
    expires_at: body.expiresInDays
      ? new Date(Date.now() + body.expiresInDays * 86_400_000).toISOString()
      : null,
  })

  if (error) {
    console.error('[Admin Invite Codes] Insert error:', error)
    return NextResponse.json({ error: 'Failed to create invite code' }, { status: 500 })
  }

  // Only time the plaintext code is ever visible — not retrievable after this.
  return NextResponse.json({ code: plainCode }, { status: 201 })
}
