// app/api/institutions/benchmark/route.ts
// Institutional Sprint 5 — the one route CalibrationSparkline,
// BiasFingerprint, and PatternTile all call for their benchmarkScope prop.
//
// GET /api/institutions/benchmark?dim=stakes_magnitude
//
// Resolves the caller's active institution server-side (never trusts a
// client-supplied institutionId for this — same reasoning as every other
// route here), then:
//   1. Calls Sprint 4's auto-tiering (institution → platform → insufficient).
//   2. If insufficient, attaches progress counts (task 4's authorized
//      bare-headcount exception — see lib/unlock-progress.ts).
//   3. If NOT insufficient, checks + marks the one-time unlock notice.
//
// Gated behind NEXT_PUBLIC_INSTITUTIONAL_MODE_ENABLED. Returns the
// 'insufficient' scope shape (not 404) when the flag is on but the user has
// no institution — this route is reachable by any authenticated user, and
// "no benchmark data yet" is a valid, honest response for them, not an
// error.

import { NextResponse }               from 'next/server'
import { createClient }               from '@/lib/supabase'
import { isInstitutionalModeEnabled } from '@/lib/feature-flags'
import { resolveActiveInstitution }   from '@/lib/active-institution'
import { getBenchmarkForDimension }   from '@/lib/aggregate-benchmark'
import { getUnlockProgress }          from '@/lib/unlock-progress'
import { checkAndMarkUnlockSeen }     from '@/lib/unlock-notices'

async function resolveUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  try {
    const anon = createClient()
    const { data: { user } } = await anon.auth.getUser(authHeader.slice(7).trim())
    return user?.id ?? null
  } catch {
    return null
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!isInstitutionalModeEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const userId = await resolveUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const dim = url.searchParams.get('dim')
  if (!dim) return NextResponse.json({ error: 'dim query param is required' }, { status: 400 })

  const active = await resolveActiveInstitution(userId)
  const benchmark = await getBenchmarkForDimension(dim, active.institutionId)

  if (benchmark.scope.type === 'insufficient') {
    const progress = await getUnlockProgress(dim, active.institutionId)
    return NextResponse.json({ ...benchmark, progress })
  }

  const firstUnlock = await checkAndMarkUnlockSeen(userId, dim, benchmark.scope.type)
  return NextResponse.json({ ...benchmark, firstUnlock })
}
