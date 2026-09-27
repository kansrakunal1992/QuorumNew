/**
 * QUORUM — Connector Send Route (Phase 3, v2)
 * "This will be sent from your own account, as you" — the person has
 * already seen and can still edit the text client-side; this route sends
 * exactly what it's given, with no rewriting.
 */

import { NextResponse } from 'next/server'
import { resolveUserId } from '@/lib/connectors/auth'
import { isSlackConnectorEnabled, isTeamsConnectorEnabled } from '@/lib/feature-flags'
import { sendSlackMessage } from '@/lib/connectors/slack'
import { sendTeamsMessage } from '@/lib/connectors/teams'

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

  const { targetId, text } = (await req.json()) as { targetId?: string; text?: string }
  if (!targetId || !text?.trim()) {
    return NextResponse.json({ error: 'targetId and text are required' }, { status: 400 })
  }

  const result = provider === 'slack'
    ? await sendSlackMessage(userId, targetId, text.trim())
    : await sendTeamsMessage(userId, targetId, text.trim())

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'Send failed' }, { status: 502 })
  }

  // sentMarker: what to pass back into check-replies as `sentAfter` later —
  // Slack's own message timestamp (its natural ordering key) if the send
  // returned one, otherwise "now" (Teams doesn't return one; ISO works for
  // its createdDateTime comparison in checkTeamsReplies).
  const sentMarker = provider === 'slack' && 'ts' in result && result.ts ? result.ts : new Date().toISOString()

  return NextResponse.json({ ok: true, sentMarker })
}
