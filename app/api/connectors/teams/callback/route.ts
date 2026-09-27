/**
 * QUORUM — Teams Callback Route (Phase 3, v2)
 * Mirrors app/api/connectors/slack/callback/route.ts exactly.
 */

import { NextResponse } from 'next/server'
import { isTeamsConnectorEnabled } from '@/lib/feature-flags'
import { exchangeTeamsCode } from '@/lib/connectors/teams'
import { saveConnectorAccount } from '@/lib/connectors/tokens'
import { verifyOAuthState } from '@/lib/connectors/state'

export async function GET(req: Request) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const { searchParams } = new URL(req.url)
  const code  = searchParams.get('code')
  const state = searchParams.get('state')
  const errorParam = searchParams.get('error')   // set if the user declined consent

  const payload = state ? verifyOAuthState(state) : null
  const fallbackReturnPath = payload?.returnPath ?? '/'

  if (!isTeamsConnectorEnabled() || errorParam || !code || !payload) {
    return NextResponse.redirect(`${baseUrl}${fallbackReturnPath}${fallbackReturnPath.includes('?') ? '&' : '?'}connector=teams_failed`)
  }

  try {
    const redirectUri = `${baseUrl}/api/connectors/teams/callback`
    const tokens = await exchangeTeamsCode(code, redirectUri)
    await saveConnectorAccount(payload.userId, 'teams', tokens)

    return NextResponse.redirect(`${baseUrl}${payload.returnPath}${payload.returnPath.includes('?') ? '&' : '?'}connector=teams_connected`)
  } catch (err) {
    console.error('[Teams Callback] error:', err)
    return NextResponse.redirect(`${baseUrl}${payload.returnPath}${payload.returnPath.includes('?') ? '&' : '?'}connector=teams_failed`)
  }
}
