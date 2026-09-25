/**
 * QUORUM — Chat Intake "I'm Done" Route (Natural Intake v1)
 *
 * The light-path exit from the checkpoint screen: no Council. Session is
 * marked completed for display purposes either way, but
 * commitment_captured_at — the field the six Mirror/outcome-tracking
 * touchpoints now key off (see docs/MIRROR_TOUCHPOINTS_v1.md) — is only set
 * when the person actually named a next action. A session where someone
 * just closed the loop with no committed next step correctly never
 * generates an "how did it turn out?" nudge later; one where they did,
 * does — Council or not.
 *
 * Missing piece #7 (Kunal's natural-process note — commitment and
 * execution) extended to the light path, not just the post-Council flow.
 */

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { encrypt } from '@/lib/encryption'
import { isNaturalIntakeEnabled } from '@/lib/feature-flags'

export async function POST(req: Request) {
  if (!isNaturalIntakeEnabled()) {
    return NextResponse.json({ error: 'Not enabled' }, { status: 404 })
  }

  try {
    const { sessionId, nextAction, reviewDate } = (await req.json()) as {
      sessionId?:   string
      nextAction?:  string   // "What's the smallest next move?" — optional, plan section 5 item 7
      reviewDate?:  string   // ISO date (YYYY-MM-DD) — optional
    }

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    const update: Record<string, unknown> = { status: 'completed' }

    if (nextAction?.trim()) {
      update.commitment_leaning     = encrypt(nextAction.trim())
      update.commitment_review_date = reviewDate || null
      update.commitment_captured_at = new Date().toISOString()
    }

    const { error } = await supabase.from('sessions').update(update).eq('id', sessionId)

    if (error) {
      console.error('[ChatIntake Done] update failed:', error)
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, committed: !!nextAction?.trim() })
  } catch (err) {
    console.error('[ChatIntake Done] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
