/**
 * QUORUM — Gmail Connect Route (Phase 4, v3)
 * Mirrors app/api/connectors/slack/connect/route.ts exactly.
 */

import { NextResponse } from 'next/server'
import { resolveUserId } from '@/lib/connectors/auth'
import { isGmailConnectorEnabled } from '@/lib/feature-flags'
import { buildGmailAuthorizeUrl } from '@/lib/connectors/gmail'
import { createOAuthState } from '@/lib/connectors/state'

export async function GET(req: Request) {
  if (!isGmailConnectorEnabled()) {
    return NextResponse.json({ error: 'Not enabled' }, { status: 404 })
  }

  const userId = await resolveUserId(req)
  if (!userId) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const returnPath = searchParams.get('returnPath') || '/'

  const baseUrl     = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const redirectUri = `${baseUrl}/api/connectors/gmail/callback`
  const state        = createOAuthState(userId, returnPath)

  return NextResponse.json({ url: buildGmailAuthorizeUrl(redirectUri, state) })
}
