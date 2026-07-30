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
import { decrypt }             from '@/lib/encryption'
import { parseSynthesisHighlights, buildShareMessage, buildWhatsAppShareMessage } from '@/lib/synthesis-highlights'

interface Params { params: Promise<{ id: string }> }

function publicUrl(token: string) {
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.quorumvault.org'
  return `${origin.replace(/\/$/, '')}/share/${token}`
}

// Fetches the session's decision text and its latest synthesis message,
// decrypts both, and composes the compact share message in both variants:
// plain (LinkedIn/Reddit/copy-link) and WhatsApp-formatted (bold labels).
// "Latest" matters because a challenged/pushback exchange within the same
// session can produce more than one persona='synthesis' message — the most
// recent one is the current verdict, same reasoning as the record page's
// own synthesis rendering.
async function buildMessageForSession(
  supabase:            ReturnType<typeof createServiceClient>,
  sessionId:           string,
  encryptedDecision:   string | null,
  url:                 string,
): Promise<{ message: string; whatsappMessage: string }> {
  const decisionText = decrypt(encryptedDecision) ?? ''

  const { data: synthesisMsg } = await supabase
    .from('messages')
    .select('content')
    .eq('session_id', sessionId)
    .eq('persona', 'synthesis')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const highlights = synthesisMsg?.content
    ? parseSynthesisHighlights(decrypt(synthesisMsg.content) ?? '')
    : null

  return {
    message:         buildShareMessage({ decisionText, url, highlights }),
    whatsappMessage: buildWhatsAppShareMessage({ decisionText, url, highlights }),
  }
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
    .select('user_id, user_email, device_id, decision_text, share_token, is_shared')
    .eq('id', sessionId)
    .single()

  if (!row) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (!(await resolveOwnership(req, row))) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  if (!row.is_shared || !row.share_token) {
    return NextResponse.json({ isShared: false, url: null, message: null, whatsappMessage: null })
  }

  const url = publicUrl(row.share_token)
  const { message, whatsappMessage } = await buildMessageForSession(supabase, sessionId, row.decision_text, url)
  return NextResponse.json({ isShared: true, url, message, whatsappMessage })
}

export async function POST(req: Request, { params }: Params) {
  const { id: sessionId } = await params
  const supabase = createServiceClient()

  const { data: row } = await supabase
    .from('sessions')
    .select('user_id, user_email, device_id, decision_text, share_token, is_shared')
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

  const url = publicUrl(token)
  const { message, whatsappMessage } = await buildMessageForSession(supabase, sessionId, row.decision_text, url)
  return NextResponse.json({ isShared: true, url, message, whatsappMessage })
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
