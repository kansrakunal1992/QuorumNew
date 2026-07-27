// app/api/record/[id]/share/route.ts
// Owner-only controls for a session's public share link.
// Ownership check follows the same pattern as app/api/session/[id]/confidence/route.ts
// (Bearer user_id, falling back to user_email / device_id for anonymous sessions).
//
//   GET    → current share status ({ isShared, url | null })
//   POST   → enable sharing (generates share_token if one doesn't exist yet)
//   DELETE → disable sharing (keeps the token so re-enabling reuses the same URL)

import { NextResponse }        from 'next/server'
import { randomUUID }          from 'crypto'
import { createServiceClient } from '@/lib/supabase'

interface Params { params: Promise<{ id: string }> }

function publicUrl(token: string) {
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.quorumvault.org'
  return `${origin.replace(/\/$/, '')}/share/${token}`
}

async function resolveOwnership(
  req: Request,
  row: { user_id: string | null; user_email: string | null; device_id: string | null },
): Promise<boolean> {
  const authHeader = req.headers.get('Authorization')
  let serverUserId: string | null = null
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const { createClient } = await import('@/lib/supabase')
      const anonClient = createClient()
      const { data: { user } } = await anonClient.auth.getUser(authHeader.slice(7).trim())
      serverUserId = user?.id ?? null
    } catch { /* non-blocking */ }
  }

  // GET/DELETE identity falls back to query params — fetch() disallows a
  // body on GET requests, so this can't rely on req.json() the way the
  // POST body does.
  const url = new URL(req.url)
  let ownerEmail = url.searchParams.get('user_email')?.trim().toLowerCase() || null
  let deviceId    = url.searchParams.get('device_id') || null

  if (req.method === 'POST' && !ownerEmail && !deviceId) {
    try {
      const body = await req.clone().json() as { user_email?: string; device_id?: string }
      ownerEmail = body.user_email?.trim().toLowerCase() || null
      deviceId    = body.device_id ?? null
    } catch { /* no body sent — fine if a Bearer token resolved ownership */ }
  }

  return !!(
    (serverUserId && row.user_id    === serverUserId) ||
    (ownerEmail   && row.user_email === ownerEmail) ||
    (deviceId     && row.device_id  === deviceId)
  )
}

export async function GET(req: Request, { params }: Params) {
  const { id: sessionId } = await params
  const supabase = createServiceClient()

  const { data: row } = await supabase
    .from('sessions')
    .select('user_id, user_email, device_id, share_token, is_shared')
    .eq('id', sessionId)
    .single()

  if (!row) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (!(await resolveOwnership(req, row))) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  return NextResponse.json({
    isShared: row.is_shared,
    url: row.is_shared && row.share_token ? publicUrl(row.share_token) : null,
  })
}

export async function POST(req: Request, { params }: Params) {
  const { id: sessionId } = await params
  const supabase = createServiceClient()

  const { data: row } = await supabase
    .from('sessions')
    .select('user_id, user_email, device_id, share_token, is_shared')
    .eq('id', sessionId)
    .single()

  if (!row) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (!(await resolveOwnership(req, row))) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const token = row.share_token ?? randomUUID()

  const { error: updateErr } = await supabase
    .from('sessions')
    .update({ share_token: token, is_shared: true, shared_at: new Date().toISOString() })
    .eq('id', sessionId)

  if (updateErr) return NextResponse.json({ error: 'Failed to enable sharing' }, { status: 500 })

  return NextResponse.json({ isShared: true, url: publicUrl(token) })
}

export async function DELETE(req: Request, { params }: Params) {
  const { id: sessionId } = await params
  const supabase = createServiceClient()

  const { data: row } = await supabase
    .from('sessions')
    .select('user_id, user_email, device_id, share_token')
    .eq('id', sessionId)
    .single()

  if (!row) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (!(await resolveOwnership(req, row))) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  // Keep share_token intact — re-enabling later reuses the same URL rather
  // than invalidating any link already sent out.
  const { error: updateErr } = await supabase
    .from('sessions')
    .update({ is_shared: false })
    .eq('id', sessionId)

  if (updateErr) return NextResponse.json({ error: 'Failed to disable sharing' }, { status: 500 })

  return NextResponse.json({ isShared: false })
}
