/**
 * QUORUM — Gmail Callback Route (Phase 4, v3)
 * Mirrors app/api/connectors/slack/callback/route.ts exactly.
 */

import { NextResponse } from 'next/server'
import { isGmailConnectorEnabled } from '@/lib/feature-flags'
import { exchangeGmailCode } from '@/lib/connectors/gmail'
import { saveConnectorAccount } from '@/lib/connectors/tokens'
import { verifyOAuthState } from '@/lib/connectors/state'

export async function GET(req: Request) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const { searchParams } = new URL(req.url)
  const code  = searchParams.get('code')
  const state = searchParams.get('state')
  const errorParam = searchParams.get('error')

  const payload = state ? verifyOAuthState(state) : null
  const fallbackReturnPath = payload?.returnPath ?? '/'

  if (!isGmailConnectorEnabled() || errorParam || !code || !payload) {
    return NextResponse.redirect(`${baseUrl}${fallbackReturnPath}${fallbackReturnPath.includes('?') ? '&' : '?'}connector=gmail_failed`)
  }

  try {
    const redirectUri = `${baseUrl}/api/connectors/gmail/callback`
    const tokens = await exchangeGmailCode(code, redirectUri)
    await saveConnectorAccount(payload.userId, 'gmail', tokens)

    return NextResponse.redirect(`${baseUrl}${payload.returnPath}${payload.returnPath.includes('?') ? '&' : '?'}connector=gmail_connected`)
  } catch (err) {
    console.error('[Gmail Callback] error:', err)
    return NextResponse.redirect(`${baseUrl}${payload.returnPath}${payload.returnPath.includes('?') ? '&' : '?'}connector=gmail_failed`)
  }
}
