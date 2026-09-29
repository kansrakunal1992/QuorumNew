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
import { isSlackConnectorEnabled, isTeamsConnectorEnabled, isOutlookConnectorEnabled } from '@/lib/feature-flags'
import { checkSlackReplies } from '@/lib/connectors/slack'
import { checkTeamsReplies } from '@/lib/connectors/teams'
import { checkOutlookReplies } from '@/lib/connectors/outlook'

const ENABLED: Record<string, () => boolean> = {
  slack: isSlackConnectorEnabled, teams: isTeamsConnectorEnabled, outlook: isOutlookConnectorEnabled,
}

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params
  if (provider === 'gmail') {
    return NextResponse.json({ error: 'Gmail is send-only in this build — reply checking is not available' }, { status: 501 })
  }
  if (!ENABLED[provider]) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
  }
  if (!ENABLED[provider]()) {
    return NextResponse.json({ error: 'Not enabled' }, { status: 404 })
  }

  const userId = await resolveUserId(req)
  if (!userId) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }

  const { targetId, channelName, fromAddress, sentAfter } = (await req.json()) as {
    targetId?:     string   // Teams: chatId
    channelName?:  string   // Slack only — see lib/connectors/slack.ts
    fromAddress?:  string   // Outlook only — the stakeholder's email address
    sentAfter?:    string   // Slack: ts from /send. Teams/Outlook: the ISO timestamp from /send.
  }
  if (!sentAfter) {
    return NextResponse.json({ error: 'sentAfter is required' }, { status: 400 })
  }

  const matches =
    provider === 'slack'   ? (channelName ? await checkSlackReplies(userId, channelName, sentAfter) : null) :
    provider === 'teams'   ? (targetId ? await checkTeamsReplies(userId, targetId, sentAfter) : null) :
    (fromAddress ? await checkOutlookReplies(userId, fromAddress, sentAfter) : null)

  if (matches === null) {
    return NextResponse.json({ error: 'Not connected, or the check failed' }, { status: 409 })
  }

  return NextResponse.json({ matches })
}
