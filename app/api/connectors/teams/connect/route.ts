/**
 * QUORUM — Teams Connect Route (Phase 3, v2)
 * Mirrors app/api/connectors/slack/connect/route.ts exactly — see that
 * file's comment for why this is fetch()-called rather than a plain link.
 */

import { NextResponse } from 'next/server'
import { resolveUserId } from '@/lib/connectors/auth'
import { isTeamsConnectorEnabled } from '@/lib/feature-flags'
import { buildTeamsAuthorizeUrl } from '@/lib/connectors/teams'
import { createOAuthState } from '@/lib/connectors/state'

export async function GET(req: Request) {
  if (!isTeamsConnectorEnabled()) {
    return NextResponse.json({ error: 'Not enabled' }, { status: 404 })
  }

  const userId = await resolveUserId(req)
  if (!userId) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const returnPath = searchParams.get('returnPath') || '/'

  const baseUrl     = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const redirectUri = `${baseUrl}/api/connectors/teams/callback`
  const state        = createOAuthState(userId, returnPath)

  return NextResponse.json({ url: buildTeamsAuthorizeUrl(redirectUri, state) })
}
