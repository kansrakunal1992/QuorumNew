/**
 * QUORUM — Outlook Connect Route (Phase 4, v3)
 * Mirrors app/api/connectors/teams/connect/route.ts exactly.
 */

import { NextResponse } from 'next/server'
import { resolveUserId } from '@/lib/connectors/auth'
import { isOutlookConnectorEnabled } from '@/lib/feature-flags'
import { buildOutlookAuthorizeUrl } from '@/lib/connectors/outlook'
import { createOAuthState } from '@/lib/connectors/state'

export async function GET(req: Request) {
  if (!isOutlookConnectorEnabled()) {
    return NextResponse.json({ error: 'Not enabled' }, { status: 404 })
  }

  const userId = await resolveUserId(req)
  if (!userId) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const returnPath = searchParams.get('returnPath') || '/'

  const baseUrl     = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const redirectUri = `${baseUrl}/api/connectors/outlook/callback`
  const state        = createOAuthState(userId, returnPath)

  return NextResponse.json({ url: buildOutlookAuthorizeUrl(redirectUri, state) })
}
