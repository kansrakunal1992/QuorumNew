// Validates whether a user has a valid Brief access token.
// Called client-side before showing the Decision Brief button.
// Token is set in Railway env as BRIEF_ACCESS_TOKEN.
// Share the token with paying users directly — no DB, no accounts needed.

import { NextResponse } from 'next/server'
import { checkLimit, getClientIP, tooManyRequests, LIMITS } from '@/lib/rate-limit'

export async function POST(req: Request) {
  try {
    // This checks one static shared secret with no username/identity at
    // all — without a rate limit, it's a plain brute-force target.
    const rlResult = checkLimit(getClientIP(req), LIMITS.briefAccess)
    if (!rlResult.allowed) return tooManyRequests(rlResult, 'brief access attempts')

    const { token } = await req.json()
    const validToken = process.env.BRIEF_ACCESS_TOKEN

    if (!validToken) {
      // If no token is configured in env, Brief is open to everyone (dev mode)
      return NextResponse.json({ valid: true, devMode: true })
    }

    return NextResponse.json({ valid: token === validToken })
  } catch {
    return NextResponse.json({ valid: false }, { status: 400 })
  }
}
