// app/api/session/[id]/instinct/route.ts
// ── Unified Session, Tier 2 ────────────────────────────────────────────────
// Records the user's initial instinct (accept/reject/unsure) and what
// they're optimizing for, BEFORE any Quorum output — Examiner, Council,
// prediction, Synthesis — is shown. This is the lock step the product doc
// calls "critical bias protection": Quorum must not have said anything yet
// when this is written, or the prediction/analysis that follows could be
// read as having influenced the very preference it's supposed to be
// measuring against.
//
// Only reachable when the unified session flag is on — see
// components/InitialInstinctCapture.tsx, which is the only caller.

import { NextResponse }            from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createServiceClient }     from '@/lib/supabase'
import { isUnifiedSessionEnabled } from '@/lib/feature-flags'

interface Params { params: Promise<{ id: string }> }

const VALID_INSTINCT = ['accept', 'reject', 'unsure'] as const
const VALID_PRIORITY = ['career_growth', 'security', 'money', 'time_freedom', 'family', 'other'] as const

export async function POST(req: Request, { params }: Params) {
  if (!isUnifiedSessionEnabled()) {
    return NextResponse.json({ error: 'Not enabled' }, { status: 404 })
  }

  const { id: sessionId } = await params
  if (!sessionId) return NextResponse.json({ error: 'Missing session id' }, { status: 400 })

  let body: { initialInstinct?: string; optimizationPriority?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { initialInstinct, optimizationPriority } = body
  if (!initialInstinct || !VALID_INSTINCT.includes(initialInstinct as typeof VALID_INSTINCT[number])) {
    return NextResponse.json({ error: 'initialInstinct must be one of accept | reject | unsure' }, { status: 400 })
  }
  if (!optimizationPriority || !VALID_PRIORITY.includes(optimizationPriority as typeof VALID_PRIORITY[number])) {
    return NextResponse.json({ error: 'optimizationPriority must be a recognized value' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // ── Resolve user_id from Bearer token (same pattern as mirror/calibration) ──
  let userId: string | null = null
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    try {
      const anonClient = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      )
      const { data: { user } } = await anonClient.auth.getUser(token)
      userId = user?.id ?? null
    } catch {
      // invalid token — fall through as unauthenticated
    }
  }

  // ── Ownership check ── a session can be pre-auth (device-local, per the
  // marketing site's "sessions live on this device only" note), so this
  // allows a null-user_id session to be claimed here the same way other
  // session writes already do, rather than hard-requiring auth this early.
  const { data: session } = await supabase
    .from('sessions')
    .select('id, user_id')
    .eq('id', sessionId)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.user_id && userId && session.user_id !== userId) {
    return NextResponse.json({ error: 'Not your session' }, { status: 403 })
  }

  const { error } = await supabase
    .from('sessions')
    .update({
      initial_instinct:      initialInstinct,
      optimization_priority: optimizationPriority,
    })
    .eq('id', sessionId)

  if (error) {
    console.error('[instinct] update failed', error)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
