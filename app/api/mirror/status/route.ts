// app/api/mirror/status/route.ts
// ── Mirror Module: Gateway Status Route (Sprint 7a) ───────────────────────────
//
// Single round-trip check for the Mirror page.
// Returns everything needed to determine which gate state to render.
//
// Gate state machine:
//   auth      → user_id not present (not authenticated)
//   threshold → authenticated but fewer than 5 sessions logged
//   paywall   → threshold met, no mirror_access row
//   unlocked  → threshold met + mirror_access exists
//
// When gateState = 'paywall', also returns teaserBiases:
//   top 3 bias_parameter keys detected for this user (labels for blurred tiles).
//   Shows the user their actual bias names even before paying — this is the
//   conversion hook. Content stays blurred; only the label is revealed.
//
// Auth: reads user_id from Bearer token (same pattern as /api/history).
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { MirrorStatus } from '@/lib/types'

const MIRROR_THRESHOLD = 5

export async function GET(req: Request) {
  const supabase = createServiceClient()

  // ── 1. Resolve user_id from Bearer token ──────────────────────────────────
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
      // Invalid token — proceed as unauthenticated
    }
  }

  // ── 2. Not authenticated ───────────────────────────────────────────────────
  if (!userId) {
    const response: MirrorStatus = {
      authenticated: false,
      sessionCount: 0,
      hasAccess: false,
      threshold: MIRROR_THRESHOLD,
      meetsThreshold: false,
      gateState: 'auth',
      teaserBiases: [],
    }
    return NextResponse.json(response)
  }

  // ── 3. Count authenticated sessions for this user ─────────────────────────
  const { count: rawCount } = await supabase
    .from('sessions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)

  const sessionCount = rawCount ?? 0
  const meetsThreshold = sessionCount >= MIRROR_THRESHOLD

  // ── 4. Check mirror_access ─────────────────────────────────────────────────
  let hasAccess = false
  if (meetsThreshold) {
    const { data: accessRow } = await supabase
      .from('mirror_access')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle()
    hasAccess = !!accessRow
  }

  // ── 5. Determine gate state ────────────────────────────────────────────────
  let gateState: MirrorStatus['gateState']
  if (!meetsThreshold) {
    gateState = 'threshold'
  } else if (!hasAccess) {
    gateState = 'paywall'
  } else {
    gateState = 'unlocked'
  }

  // ── 6. Fetch teaser biases for paywall state ───────────────────────────────
  // Reveals actual bias *names* detected for this user — even before payment.
  // Content interpretation stays blurred; only the label is shown.
  // This creates real personalization in the locked state (conversion hook).
  let teaserBiases: string[] = []
  if (gateState === 'paywall') {
    const { data: biasRows } = await supabase
      .from('bias_library')
      .select('bias_parameter, detection_count')
      .eq('user_id', userId)
      .order('detection_count', { ascending: false })
      .limit(3)

    teaserBiases = (biasRows ?? []).map(b => b.bias_parameter as string)
  }

  const response: MirrorStatus = {
    authenticated: true,
    sessionCount,
    hasAccess,
    threshold: MIRROR_THRESHOLD,
    meetsThreshold,
    gateState,
    teaserBiases,
  }

  return NextResponse.json(response)
}
