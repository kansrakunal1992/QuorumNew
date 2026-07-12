// app/api/institutions/bias-parameter-benchmark/route.ts
// Institutional Sprint 6 — serves BiasParameterBenchmarkTag, the PatternTile
// analog of app/api/institutions/benchmark/route.ts.
//
// GET /api/institutions/bias-parameter-benchmark?biasKey=sunk_cost
//
// No progress-toward-floor or unlock-notice wiring here (unlike the
// calibration benchmark route) — those were specific, explicit product
// decisions made for the calibration-dimension case (lib/unlock-progress.ts's
// header documents why exact counts were authorized there). Extending that
// same bare-headcount exception to bias parameters is a new decision, not
// assumed here; this route just returns the tiered result or "insufficient"
// with no count attached.

import { NextResponse }               from 'next/server'
import { createClient }               from '@/lib/supabase'
import { isInstitutionalModeEnabled } from '@/lib/feature-flags'
import { resolveActiveInstitution }   from '@/lib/active-institution'
import { getBiasParameterBenchmark }  from '@/lib/bias-parameter-benchmark'

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
  const biasKey = url.searchParams.get('biasKey')
  if (!biasKey) return NextResponse.json({ error: 'biasKey query param is required' }, { status: 400 })

  const active = await resolveActiveInstitution(userId)
  const benchmark = await getBiasParameterBenchmark(biasKey, active.institutionId)

  return NextResponse.json(benchmark)
}
