/**
 * QUORUM — Slack Connect Route (Phase 3, v2)
 *
 * Called by fetch() with the user's normal Bearer token (like every other
 * route in this app) — NOT a plain browser link, because the authorize URL
 * needs to carry a signed state token identifying this user for the
 * callback to recover later (see lib/connectors/state.ts's file header for
 * why). The client receives {url} and does the actual page navigation
 * itself: `window.location.href = url`.
 */

import { NextResponse } from 'next/server'
import { resolveUserId } from '@/lib/connectors/auth'
import { isSlackConnectorEnabled } from '@/lib/feature-flags'
import { buildSlackAuthorizeUrl } from '@/lib/connectors/slack'
import { createOAuthState } from '@/lib/connectors/state'

export async function GET(req: Request) {
  if (!isSlackConnectorEnabled()) {
    return NextResponse.json({ error: 'Not enabled' }, { status: 404 })
  }

  const userId = await resolveUserId(req)
  if (!userId) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const returnPath = searchParams.get('returnPath') || '/'

  const baseUrl     = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const redirectUri = `${baseUrl}/api/connectors/slack/callback`
  const state        = createOAuthState(userId, returnPath)

  return NextResponse.json({ url: buildSlackAuthorizeUrl(redirectUri, state) })
}
