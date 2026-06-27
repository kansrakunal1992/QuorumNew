// app/api/session/[id]/bias-note/route.ts
// Called client-side from SessionView after synthesisDone fires.
// Returns the single strongest distorting bias detected for this session,
// using identical query logic to app/record/[id]/page.tsx.
// Auth: session_id UUID is non-guessable; additionally resolves caller from
// Bearer token (same pattern as validation-signal route).

import { createServiceClient, createClient } from '@/lib/supabase'
import { BIAS_PARAMETERS }                   from '@/lib/bias-scorer'
import { NextResponse }                       from 'next/server'

type SessionBiasCtx = {
  reasoning?:        string
  signal_type?:      'distorting' | 'neutral' | 'adaptive'
  prosecutor_score?: number
}

export async function GET(
  req:    Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params
  if (!sessionId) return NextResponse.json({ biasNote: null })

  // Resolve caller from Bearer token (optional — session UUID is the gate)
  let _callerId: string | null = null
  const auth = req.headers.get('Authorization')
  if (auth?.startsWith('Bearer ')) {
    try {
      const anon = createClient()
      const { data: { user } } = await anon.auth.getUser(auth.slice(7).trim())
      _callerId = user?.id ?? null
    } catch { _callerId = null }
  }

  const supabase = createServiceClient()

  // Fetch session identity columns
  const { data: session, error: sessionErr } = await supabase
    .from('sessions')
    .select('user_id, user_email, device_id')
    .eq('id', sessionId)
    .single()

  if (sessionErr || !session) return NextResponse.json({ biasNote: null })

  const identityCol =
    session.user_id    ? 'user_id'    :
    session.user_email ? 'user_email' :
    session.device_id  ? 'device_id'  : null

  const identityVal =
    session.user_id ?? session.user_email ?? session.device_id ?? null

  if (!identityCol || !identityVal) return NextResponse.json({ biasNote: null })

  // Query bias_library for entries tagged to this specific session
  const { data: biasRows } = await supabase
    .from('bias_library')
    .select('bias_parameter, activation_contexts')
    .eq(identityCol, identityVal)
    .contains('session_ids', [sessionId])

  const candidates = (biasRows ?? [])
    .map(row => {
      const ctx = (row.activation_contexts as Record<string, SessionBiasCtx> | null)?.[sessionId]
      return ctx ? { biasKey: row.bias_parameter as string, ctx } : null
    })
    .filter((c): c is { biasKey: string; ctx: SessionBiasCtx } => c !== null)
    .filter(c => c.ctx.signal_type === 'distorting' && !!c.ctx.reasoning)
    .sort((a, b) => (b.ctx.prosecutor_score ?? 0) - (a.ctx.prosecutor_score ?? 0))

  const top = candidates[0]
  if (!top) return NextResponse.json({ biasNote: null })

  const param     = BIAS_PARAMETERS.find(b => b.key === top.biasKey)
  const label     = param?.label ?? top.biasKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  const rawReason = top.ctx.reasoning!.trim()
  const reasoning = rawReason.length > 220
    ? rawReason.slice(0, 220).replace(/\s+\S*$/, '') + '…'
    : rawReason

  return NextResponse.json({ biasNote: { label, reasoning } })
}
