/**
 * QUORUM — Connector Disconnect Route (Phase 3, v2)
 * One route for both providers — /api/connectors/slack/disconnect and
 * /api/connectors/teams/disconnect both hit this file via the dynamic
 * [provider] segment. "Easy disconnect" (plan section 6's standing rule for
 * every connector) means a real delete, not a soft flag — see
 * lib/connectors/tokens.ts's disconnectConnector.
 */

import { NextResponse } from 'next/server'
import { resolveUserId } from '@/lib/connectors/auth'
import { disconnectConnector, type ConnectorProvider } from '@/lib/connectors/tokens'

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params
  if (provider !== 'slack' && provider !== 'teams') {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
  }

  const userId = await resolveUserId(req)
  if (!userId) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }

  await disconnectConnector(userId, provider as ConnectorProvider)
  return NextResponse.json({ ok: true })
}
