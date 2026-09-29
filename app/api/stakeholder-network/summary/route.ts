/**
 * QUORUM — Stakeholder Network Summary Route (Phase 5, v3)
 * "You consulted Sarah in 8 decisions, and her input was reflected in your
 * final decision in 5" — plan section 16. Feeds
 * components/StakeholderNetworkCard.tsx.
 */

import { NextResponse } from 'next/server'
import { resolveUserId } from '@/lib/connectors/auth'
import { getStakeholderNetworkSummary } from '@/lib/stakeholder-network'

export async function GET(req: Request) {
  const userId = await resolveUserId(req)
  if (!userId) {
    return NextResponse.json({ entries: [] })
  }
  const entries = await getStakeholderNetworkSummary(userId)
  return NextResponse.json({ entries })
}
