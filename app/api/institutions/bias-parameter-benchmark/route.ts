// app/api/institutions/bias-parameter-benchmark/route.ts
// Institutional Sprint 6 — serves BiasParameterBenchmarkTag, the PatternTile
// analog of app/api/institutions/benchmark/route.ts.
//
// GET /api/institutions/bias-parameter-benchmark?biasKey=sunk_cost
//
// No unlock-notice wiring here (unlike the calibration benchmark route) —
// that was a specific product decision made for the calibration-dimension
// case only. Progress-toward-floor counts ARE wired (Tier 3), extending
// lib/unlock-progress.ts's exception to this data type — see
// lib/bias-parameter-progress.ts's header for the reasoning.

import { NextResponse }               from 'next/server'
import { createClient }               from '@/lib/supabase'
import { isInstitutionalModeEnabled } from '@/lib/feature-flags'
import { resolveActiveInstitution }   from '@/lib/active-institution'
import { getBiasParameterBenchmark }  from '@/lib/bias-parameter-benchmark'
import { getBiasParameterProgress }   from '@/lib/bias-parameter-progress'

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

  if (benchmark.scope.type === 'insufficient') {
    const progress = await getBiasParameterProgress(biasKey, active.institutionId)
    return NextResponse.json({ ...benchmark, progress })
  }

  return NextResponse.json(benchmark)
}
