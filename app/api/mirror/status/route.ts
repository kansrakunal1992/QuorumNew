// app/api/mirror/status/route.ts
// ── Mirror Module: Gateway Status Route (Sprint 19) ──────────────────────────
//
// Gate state machine (Sprint 19):
//   auth     → user_id not present (not authenticated)
//   locked   → authenticated, < 3 sessions, no valid subscription
//   teaser   → ≥ 3 sessions, no valid subscription — shows teaser UI
//   unlocked → valid subscription (any plan, not expired)
//
// When gateState = 'teaser', also returns teaserBiases:
//   top 3 bias_parameter keys detected for this user.
//   Shows their actual bias names before subscribing (conversion hook).
//   Content stays blurred; only the label is revealed.
//
// Sprint 13 patch retained: bias_library identity key is user_email, not user_id.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { getMirrorAccessState, getMirrorTier } from '@/lib/mirror-access'
import type { MirrorStatus } from '@/lib/types'

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
      gateState: 'auth',
      teaserBiases: [],
      tier: 'mirror',
    }
    return NextResponse.json(response)
  }

  // ── 3. Resolve access state via helper ────────────────────────────────────
  const accessState = await getMirrorAccessState(userId, supabase)

  // ── 4. Count sessions (for display only) ──────────────────────────────────
  const { count: rawCount } = await supabase
    .from('sessions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
  const sessionCount = rawCount ?? 0

  const hasAccess = accessState === 'unlocked'

  // Map MirrorAccessState to MirrorGateState (both share 'unlocked' / 'teaser' / 'locked')
  const gateState: MirrorStatus['gateState'] = accessState

  // ── Phase 4: resolve Mirror tier (only meaningful when unlocked) ───────────
  const tier: MirrorStatus['tier'] = gateState === 'unlocked'
    ? await getMirrorTier(userId, supabase)
    : 'mirror'

  // ── 5. Fetch top bias keys for teaser + unlocked states ──────────────────
  // Teaser: rendered as blurred tiles. Unlocked: passed to DecisionRules
  // ThresholdGate for personalised milestone copy (Sprint M3).
  let teaserBiases: string[] = []
  if (gateState === 'teaser' || gateState === 'unlocked') {
    try {
      const { data: { user: authUser } } = await supabase.auth.admin.getUserById(userId)
      const userEmail = authUser?.email ?? null

      if (userEmail) {
        const { data: biasRows } = await supabase
          .from('bias_library')
          .select('bias_parameter, detection_count')
          .eq('user_email', userEmail)
          .order('detection_count', { ascending: false })
          .limit(3)

        teaserBiases = (biasRows ?? []).map(b => b.bias_parameter as string)
      }
    } catch {
      // If email resolution fails, fall through with empty teaserBiases
    }
  }

  const response: MirrorStatus = {
    authenticated: true,
    sessionCount,
    hasAccess,
    gateState,
    teaserBiases,
    tier,
  }

  return NextResponse.json(response)
}
