/**
 * QUORUM — Connector Status Route (Phase 3/4, v2 + v3)
 *
 * Tells the client which connectors exist for this build (feature flags)
 * and which of those this specific user has actually connected —
 * components/ConnectorSettings.tsx and components/StakeholderOutreach.tsx
 * both read this before deciding what to show.
 */

import { NextResponse } from 'next/server'
import { resolveUserId } from '@/lib/connectors/auth'
import {
  isSlackConnectorEnabled, isTeamsConnectorEnabled,
  isGmailConnectorEnabled, isOutlookConnectorEnabled,
  isWhatsAppShareEnabled,
} from '@/lib/feature-flags'
import { getConnectorStatus, type ConnectorProvider } from '@/lib/connectors/tokens'

const OAUTH_PROVIDERS: { key: ConnectorProvider; enabled: () => boolean }[] = [
  { key: 'slack',   enabled: isSlackConnectorEnabled },
  { key: 'teams',   enabled: isTeamsConnectorEnabled },
  { key: 'gmail',   enabled: isGmailConnectorEnabled },
  { key: 'outlook', enabled: isOutlookConnectorEnabled },
]

export async function GET(req: Request) {
  const userId = await resolveUserId(req)

  const results = await Promise.all(
    OAUTH_PROVIDERS.map(async ({ key, enabled }) => {
      const isEnabled = enabled()
      const status = isEnabled && userId
        ? await getConnectorStatus(userId, key)
        : { connected: false, workspaceName: null }
      return [key, { enabled: isEnabled, ...status }] as const
    }),
  )

  return NextResponse.json({
    ...Object.fromEntries(results),
    whatsapp: { enabled: isWhatsAppShareEnabled() },   // no OAuth/connection state — always just "available" or not
  })
}
