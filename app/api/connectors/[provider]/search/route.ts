/**
 * QUORUM — Connector Search Route (Phase 3, v2)
 * "Find the conversation with Sarah about the hiring plan" — plan section
 * 12's example. One route, dispatching by provider; each provider's own
 * search behaviour lives in lib/connectors/{slack,teams}.ts, not here.
 */

import { NextResponse } from 'next/server'
import { resolveUserId } from '@/lib/connectors/auth'
import { isSlackConnectorEnabled, isTeamsConnectorEnabled } from '@/lib/feature-flags'
import { searchSlackMessages } from '@/lib/connectors/slack'
import { searchTeamsMessages } from '@/lib/connectors/teams'

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params
  if (provider !== 'slack' && provider !== 'teams') {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
  }
  if ((provider === 'slack' && !isSlackConnectorEnabled()) || (provider === 'teams' && !isTeamsConnectorEnabled())) {
    return NextResponse.json({ error: 'Not enabled' }, { status: 404 })
  }

  const userId = await resolveUserId(req)
  if (!userId) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }

  const { query } = (await req.json()) as { query?: string }
  if (!query?.trim()) {
    return NextResponse.json({ error: 'query is required' }, { status: 400 })
  }

  const matches = provider === 'slack'
    ? await searchSlackMessages(userId, query.trim())
    : await searchTeamsMessages(userId, query.trim())

  if (matches === null) {
    return NextResponse.json({ error: 'Not connected, or the search failed' }, { status: 409 })
  }

  return NextResponse.json({ matches })
}
