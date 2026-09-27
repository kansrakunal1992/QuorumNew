/**
 * QUORUM — Slack Callback Route (Phase 3, v2)
 *
 * A real browser GET navigation from Slack — no Authorization header, no
 * fetch(), just a redirect the user's browser follows. The signed `state`
 * param (see lib/connectors/state.ts) is the only way this route knows
 * which Quorum user is connecting and where to send them back to.
 */

import { NextResponse } from 'next/server'
import { isSlackConnectorEnabled } from '@/lib/feature-flags'
import { exchangeSlackCode } from '@/lib/connectors/slack'
import { saveConnectorAccount } from '@/lib/connectors/tokens'
import { verifyOAuthState } from '@/lib/connectors/state'

export async function GET(req: Request) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const { searchParams } = new URL(req.url)
  const code  = searchParams.get('code')
  const state = searchParams.get('state')
  const errorParam = searchParams.get('error')   // Slack sets this if the user clicked "Deny"

  const payload = state ? verifyOAuthState(state) : null
  const fallbackReturnPath = payload?.returnPath ?? '/'

  if (!isSlackConnectorEnabled() || errorParam || !code || !payload) {
    return NextResponse.redirect(`${baseUrl}${fallbackReturnPath}${fallbackReturnPath.includes('?') ? '&' : '?'}connector=slack_failed`)
  }

  try {
    const redirectUri = `${baseUrl}/api/connectors/slack/callback`
    const tokens = await exchangeSlackCode(code, redirectUri)
    await saveConnectorAccount(payload.userId, 'slack', tokens)

    return NextResponse.redirect(`${baseUrl}${payload.returnPath}${payload.returnPath.includes('?') ? '&' : '?'}connector=slack_connected`)
  } catch (err) {
    console.error('[Slack Callback] error:', err)
    return NextResponse.redirect(`${baseUrl}${payload.returnPath}${payload.returnPath.includes('?') ? '&' : '?'}connector=slack_failed`)
  }
}
