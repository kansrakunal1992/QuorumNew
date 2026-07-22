// app/api/mirror/mind-change/route.ts
// ── Mirror: Mind-Change / Advisor-Divergence Pattern Data (Phase 4) ──────────
//
// Exposes the two cross-session personalization signals already computed
// server-side (lib/mind-change-patterns.ts, lib/advisor-divergence.ts) to
// the client for components/MindChangeTile.tsx. Both underlying functions
// call createServiceClient() directly and are server-only — this route is
// the only way for the tile to reach them.
//
// Auth + access gate: identical Bearer-token + getMirrorAccessState pattern
// as every other small Mirror data route (see app/api/mirror/calibration/route.ts).
// userEmail comes straight off the Supabase auth user object — no extra
// sessions-table lookup needed for that field.
//
// Response shape:
//   {
//     mindChangePattern:        MindChangePattern | null
//     advisorDivergencePattern: AdvisorDivergencePattern | null
//   }
// Both null is the common/expected state (MINIMUM_EVENTS not yet met, or no
// signal at all) — not an error. MindChangeTile renders nothing in that case.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }         from 'next/server'
import { createServiceClient }  from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { getMirrorAccessState } from '@/lib/mirror-access'
import { getMindChangePattern } from '@/lib/mind-change-patterns'
import { getAdvisorDivergencePattern } from '@/lib/advisor-divergence'

export async function GET(req: Request) {
  const supabase = createServiceClient()

  // ── 1. Resolve user_id + user_email from Bearer token ──────────────────────
  let userId:    string | null = null
  let userEmail: string | null = null
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    try {
      const anonClient = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      )
      const { data: { user } } = await anonClient.auth.getUser(token)
      userId    = user?.id    ?? null
      userEmail = user?.email ?? null
    } catch {
      // invalid token — fall through as unauthenticated
    }
  }

  if (!userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // ── 2. Mirror access gate ───────────────────────────────────────────────────
  const accessState = await getMirrorAccessState(userId, supabase)
  if (accessState !== 'unlocked') {
    return NextResponse.json({ error: 'Mirror access required' }, { status: 403 })
  }

  // ── 3. Fetch both patterns in parallel — both fail-open (null on any error,
  // see their own modules) so this route itself can't 500 on their account.
  const [mindChangePattern, advisorDivergencePattern] = await Promise.all([
    getMindChangePattern(userId, userEmail),
    getAdvisorDivergencePattern(userId, userEmail),
  ])

  return NextResponse.json({ mindChangePattern, advisorDivergencePattern })
}
