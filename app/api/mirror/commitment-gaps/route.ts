/**
 * QUORUM — Commitment Gaps Route (Phase 5, v3)
 * Feeds a gentle "you decided this but didn't say what's next" surface —
 * not wired into a specific card in this drop (see docs/CHANGELOG_v3.md);
 * the data layer is what's being shipped now.
 */

import { NextResponse } from 'next/server'
import { resolveUserId } from '@/lib/connectors/auth'
import { getCommitmentGaps } from '@/lib/commitment-gap'

export async function GET(req: Request) {
  const userId = await resolveUserId(req)
  if (!userId) {
    return NextResponse.json({ gaps: [] })
  }
  const gaps = await getCommitmentGaps(userId)
  return NextResponse.json({ gaps })
}
