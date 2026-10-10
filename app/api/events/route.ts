// app/api/events/route.ts
// -- Phase 0 (retention work): first-party product events ---------------------
// POST { event, deviceId?, decisionIndex?, sessionId?, props? }
//
// Identity is resolved here, not trusted from the client:
//   user_id         <- bearer token (if any)
//   identity_state  <- 'anonymous' | 'google' | 'magic_link'
//
// Always answers 204 -- an analytics failure (including the `events` table not
// existing yet) must never surface to the person using the product.

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase'
import { checkLimit, getClientIP, LIMITS } from '@/lib/rate-limit'

const ALLOWED_EVENTS = new Set([
  'landing_view',
  'decision_started',
  'decision_checkpointed',
  'decision_completed',
  'another_decision_clicked',
  'park_started',
  'park_saved',
  'tally_seen',
  'auth_prompt_seen',
  'auth_started',
  'magic_link_requested',
  'auth_skipped',
  'auth_completed',
  'review_date_chosen',
  // Phase 2/3
  'gate_arm_assigned',
  'observation_seen',
  'habit_saved',
  'install_prompt_seen',
  'install_prompt_accepted',
  // Phase 4
  'notification_opted_in',
  'notification_opened',
  'notification_to_decision',
  'mirror_viewed',
  'return_visit',
])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function cleanProps(raw: unknown): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  let n = 0
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= 20) break
    if (k.length > 40) continue
    if (v === null || typeof v === 'boolean' || typeof v === 'number') out[k] = v as any
    else if (typeof v === 'string') out[k] = v.slice(0, 200)
    else continue
    n++
  }
  return out
}

export async function POST(req: Request) {
  const noContent = () => new NextResponse(null, { status: 204 })

  try {
    const rl = checkLimit(getClientIP(req), LIMITS.events)
    if (!rl.allowed) return noContent()

    const body = await req.json().catch(() => null) as {
      event?: string; deviceId?: string | null; decisionIndex?: number
      sessionId?: string | null; props?: unknown
    } | null
    if (!body?.event || !ALLOWED_EVENTS.has(body.event)) return noContent()

    let userId: string | null = null
    let identityState: 'anonymous' | 'google' | 'magic_link' = 'anonymous'
    const authHeader = req.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const { data: { user } } = await createClient().auth.getUser(authHeader.slice(7).trim())
        if (user) {
          userId        = user.id
          identityState = user.app_metadata?.provider === 'google' ? 'google' : 'magic_link'
        }
      } catch { /* treat as anonymous */ }
    }

    const sessionId = typeof body.sessionId === 'string' && UUID_RE.test(body.sessionId) ? body.sessionId : null
    const deviceId  = typeof body.deviceId === 'string' && body.deviceId.length <= 80 ? body.deviceId : null
    const idx       = Number.isFinite(body.decisionIndex) ? Math.max(0, Math.min(10_000, Math.floor(body.decisionIndex as number))) : null

    const { error } = await createServiceClient().from('events').insert({
      event:          body.event,
      device_id:      deviceId,
      user_id:        userId,
      session_id:     sessionId,
      decision_index: idx,
      identity_state: identityState,
      props:          cleanProps(body.props),
    })
    if (error) console.warn('[api/events] insert skipped:', error.message)
  } catch (err) {
    console.warn('[api/events] failed:', err)
  }
  return noContent()
}
