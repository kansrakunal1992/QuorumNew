/**
 * QUORUM — Outlook Callback Route (Phase 4, v3)
 * Mirrors app/api/connectors/teams/callback/route.ts exactly.
 */

import { NextResponse } from 'next/server'
import { isOutlookConnectorEnabled } from '@/lib/feature-flags'
import { exchangeOutlookCode } from '@/lib/connectors/outlook'
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

  if (!isOutlookConnectorEnabled() || errorParam || !code || !payload) {
    return NextResponse.redirect(`${baseUrl}${fallbackReturnPath}${fallbackReturnPath.includes('?') ? '&' : '?'}connector=outlook_failed`)
  }

  try {
    const redirectUri = `${baseUrl}/api/connectors/outlook/callback`
    const tokens = await exchangeOutlookCode(code, redirectUri)
    await saveConnectorAccount(payload.userId, 'outlook', tokens)

    return NextResponse.redirect(`${baseUrl}${payload.returnPath}${payload.returnPath.includes('?') ? '&' : '?'}connector=outlook_connected`)
  } catch (err) {
    console.error('[Outlook Callback] error:', err)
    return NextResponse.redirect(`${baseUrl}${payload.returnPath}${payload.returnPath.includes('?') ? '&' : '?'}connector=outlook_failed`)
  }
}
