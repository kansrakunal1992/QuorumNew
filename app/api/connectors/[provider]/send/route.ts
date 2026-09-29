/**
 * QUORUM — Connector Send Route (Phase 3, v2)
 * "This will be sent from your own account, as you" — the person has
 * already seen and can still edit the text client-side; this route sends
 * exactly what it's given, with no rewriting.
 */

import { NextResponse } from 'next/server'
import { resolveUserId } from '@/lib/connectors/auth'
import { isSlackConnectorEnabled, isTeamsConnectorEnabled, isGmailConnectorEnabled, isOutlookConnectorEnabled } from '@/lib/feature-flags'
import { sendSlackMessage } from '@/lib/connectors/slack'
import { sendTeamsMessage } from '@/lib/connectors/teams'
import { sendGmailMessage } from '@/lib/connectors/gmail'
import { sendOutlookMessage } from '@/lib/connectors/outlook'

const ENABLED: Record<string, () => boolean> = {
  slack: isSlackConnectorEnabled, teams: isTeamsConnectorEnabled,
  gmail: isGmailConnectorEnabled, outlook: isOutlookConnectorEnabled,
}

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params
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

  // targetId: Slack channel id / Teams chat id — resolved via /search first.
  // to/subject: Gmail/Outlook instead — no search/resolve step for either
  // (Gmail has no read scope at all; Outlook's search is offered but
  // finding an address still ends with the person typing/confirming it here).
  const { targetId, to, subject, text } = (await req.json()) as {
    targetId?: string; to?: string; subject?: string; text?: string
  }
  if (!text?.trim()) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 })
  }
  if ((provider === 'slack' || provider === 'teams') && !targetId) {
    return NextResponse.json({ error: 'targetId is required' }, { status: 400 })
  }
  if ((provider === 'outlook') && !to?.trim()) {
    return NextResponse.json({ error: 'to is required' }, { status: 400 })
  }

  const result =
    provider === 'slack'   ? await sendSlackMessage(userId, targetId!, text.trim()) :
    provider === 'teams'   ? await sendTeamsMessage(userId, targetId!, text.trim()) :
    provider === 'gmail'   ? await sendGmailMessage(userId, to?.trim() || null, subject?.trim() || 'Quick question', text.trim()) :
    await sendOutlookMessage(userId, to!.trim(), subject?.trim() || 'Quick question', text.trim())

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'Send failed' }, { status: 502 })
  }

  // sentMarker: what to pass back into check-replies as `sentAfter` later.
  // Slack returns its own message ts; everything else has no equivalent, so
  // "now" (ISO) is used, which is exactly what checkTeamsReplies/
  // checkOutlookReplies compare against. Gmail has no check-replies at all
  // (see that route) so its sentMarker is unused but returned for consistency.
  const sentMarker = provider === 'slack' && 'ts' in result && (result as any).ts ? (result as any).ts : new Date().toISOString()

  return NextResponse.json({ ok: true, sentMarker })
}
