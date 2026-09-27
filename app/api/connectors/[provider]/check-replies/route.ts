/**
 * QUORUM — Connector Check-Replies Route (Phase 3, v2)
 *
 * Polling, not a live webhook — a deliberate v2 scope choice (see
 * docs/CHANGELOG_v2.md). The person taps "Check for reply"; this looks for
 * anything new in that same conversation since the outreach was sent.
 * Returns matches only — turning one into a saved stakeholder_input still
 * goes through POST /api/stakeholder-input/manual, same as a pasted-in
 * reply, so there's exactly one path that writes that table, not two
 * slightly different ones.
 */

import { NextResponse } from 'next/server'
import { resolveUserId } from '@/lib/connectors/auth'
import { isSlackConnectorEnabled, isTeamsConnectorEnabled } from '@/lib/feature-flags'
import { checkSlackReplies } from '@/lib/connectors/slack'
import { checkTeamsReplies } from '@/lib/connectors/teams'

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

  const { targetId, channelName, sentAfter } = (await req.json()) as {
    targetId?:    string   // Teams: chatId. Slack: not used directly (search is by channelName — see lib/connectors/slack.ts)
    channelName?: string   // Slack only
    sentAfter?:   string   // Slack: the ts returned by /send. Teams: the ISO timestamp returned by /send.
  }
  if (!sentAfter) {
    return NextResponse.json({ error: 'sentAfter is required' }, { status: 400 })
  }

  const matches = provider === 'slack'
    ? (channelName ? await checkSlackReplies(userId, channelName, sentAfter) : null)
    : (targetId ? await checkTeamsReplies(userId, targetId, sentAfter) : null)

  if (matches === null) {
    return NextResponse.json({ error: 'Not connected, or the check failed' }, { status: 409 })
  }

  return NextResponse.json({ matches })
}
