/**
 * QUORUM — Stakeholder Outreach Draft Route (Phase 2, v2)
 *
 * "It sounds like your co-founder's view matters here. Want to ask them
 * directly?" — this is the "yes" path: draft the message. Works the same
 * regardless of which channel it'll go out on (Slack, Teams, email,
 * WhatsApp, or just copied) — see lib/outreach-draft.ts. For WhatsApp
 * specifically, also returns a pre-filled wa.me link, since there's no send
 * API to call — the person sends it from their own WhatsApp app.
 */

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { decrypt } from '@/lib/encryption'
import { resolveUserId } from '@/lib/connectors/auth'
import { isNaturalIntakeEnabled } from '@/lib/feature-flags'
import { draftOutreachMessage, type OutreachChannel } from '@/lib/outreach-draft'
import { upsertStakeholder } from '@/lib/stakeholders'

export async function POST(req: Request) {
  if (!isNaturalIntakeEnabled()) {
    return NextResponse.json({ error: 'Not enabled' }, { status: 404 })
  }

  try {
    const userId = await resolveUserId(req)

    const { sessionId, stakeholderName, role, consultReason, channel, userInstruction } = (await req.json()) as {
      sessionId?:       string
      stakeholderName?: string
      role?:            string | null
      consultReason?:   'expertise' | 'challenge' | 'approval' | 'affected' | 'trust' | null
      channel?:         OutreachChannel
      userInstruction?: string
    }

    if (!sessionId || !stakeholderName?.trim() || !channel) {
      return NextResponse.json({ error: 'sessionId, stakeholderName, and channel are required' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { data: session } = await supabase
      .from('sessions')
      .select('decision_text')
      .eq('id', sessionId)
      .single()

    const decisionText = decrypt(session?.decision_text) ?? ''

    const draftText = await draftOutreachMessage(decisionText, stakeholderName.trim(), consultReason, channel, userInstruction)

    // Signed-in only: an anonymous device-id session can still draft and
    // send/copy a message, it just won't get a durable stakeholder record
    // to accumulate history against. Never blocks the draft itself.
    let stakeholderId: string | null = null
    if (userId) {
      const stakeholder = await upsertStakeholder(userId, stakeholderName.trim(), role, consultReason)
      stakeholderId = stakeholder.id
    }

    const whatsappLink = channel === 'whatsapp'
      ? `https://wa.me/?text=${encodeURIComponent(draftText)}`
      : null

    return NextResponse.json({ draftText, stakeholderId, whatsappLink })
  } catch (err) {
    console.error('[StakeholderOutreach Draft] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
