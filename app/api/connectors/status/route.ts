/**
 * QUORUM — Connector Status Route (Phase 3, v2)
 *
 * Tells the client which chat connectors exist for this build (feature
 * flags) and which of those this specific user has actually connected —
 * components/ConnectorSettings.tsx and components/StakeholderOutreach.tsx
 * both read this before deciding whether to show "Connect" or "Connected
 * as X" for Slack/Teams.
 */

import { NextResponse } from 'next/server'
import { resolveUserId } from '@/lib/connectors/auth'
import { isSlackConnectorEnabled, isTeamsConnectorEnabled, isWhatsAppShareEnabled } from '@/lib/feature-flags'
import { getConnectorStatus } from '@/lib/connectors/tokens'

export async function GET(req: Request) {
  const userId = await resolveUserId(req)

  const slackEnabled = isSlackConnectorEnabled()
  const teamsEnabled = isTeamsConnectorEnabled()

  const [slack, teams] = await Promise.all([
    slackEnabled && userId ? getConnectorStatus(userId, 'slack') : Promise.resolve({ connected: false, workspaceName: null }),
    teamsEnabled && userId ? getConnectorStatus(userId, 'teams') : Promise.resolve({ connected: false, workspaceName: null }),
  ])

  return NextResponse.json({
    slack:    { enabled: slackEnabled, ...slack },
    teams:    { enabled: teamsEnabled, ...teams },
    whatsapp: { enabled: isWhatsAppShareEnabled() },   // no OAuth/connection state — always just "available" or not
  })
}
