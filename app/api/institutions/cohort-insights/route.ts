// app/api/institutions/cohort-insights/route.ts
// Institutional Sprint 3 — a member's own view of their cohort(s).
//
// GET /api/institutions/cohort-insights
// Auth: Bearer token, same resolveUserId pattern as every other institution route.
//
// Returns hasCohortInsights: false whenever there's nothing to show — no
// cohort, or a cohort with no other mutually-consenting member — so
// components/CohortInsightsCard.tsx can render nothing rather than an empty
// "you're not in a cohort" state (plan Section 4 task 4: absent, not empty).
//
// Gated behind NEXT_PUBLIC_INSTITUTIONAL_MODE_ENABLED, same as every other
// institution route.

import { NextResponse }               from 'next/server'
import { createClient }               from '@/lib/supabase'
import { isInstitutionalModeEnabled } from '@/lib/feature-flags'
import { getCohortInsightsForUser }   from '@/lib/cohort-insights'

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

  const cohorts = await getCohortInsightsForUser(userId)
  const hasCohortInsights = cohorts.some(c => c.peers.length > 0)

  return NextResponse.json({ hasCohortInsights, cohorts })
}
