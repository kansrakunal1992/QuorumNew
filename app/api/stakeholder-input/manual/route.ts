/**
 * QUORUM — Stakeholder Input Route (Phase 2, v2)
 *
 * The one path that writes stakeholder_inputs, regardless of channel:
 * a WhatsApp reply the person pasted in, a Slack/Teams reply surfaced via
 * check-replies, or a plain "here's what my CFO said" the person typed
 * without ever using a connector at all. Whatever the source, it lands here
 * the same way — extracted, kept separate from the user's own words (plan
 * section 15), and linked to a real stakeholder record.
 */

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { encrypt, encryptJson, decrypt, decryptJson } from '@/lib/encryption'
import { resolveUserId } from '@/lib/connectors/auth'
import { isNaturalIntakeEnabled } from '@/lib/feature-flags'
import { extractStakeholderClaims, type ExtractedStakeholderClaims } from '@/lib/stakeholder-extract'
import { upsertStakeholder } from '@/lib/stakeholders'

export async function POST(req: Request) {
  if (!isNaturalIntakeEnabled()) {
    return NextResponse.json({ error: 'Not enabled' }, { status: 404 })
  }

  try {
    const userId = await resolveUserId(req)
    if (!userId) {
      // Stakeholder history is a signed-in feature — unlike drafting (which
      // works for an anonymous session), saving what someone said needs a
      // durable account to attach it to, the same way Mirror does.
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    }

    const {
      sessionId,
      stakeholderName,
      channel,
      provenance,
      sourceText,
      sourceTimestamp,
      sourceLink,
    } = (await req.json()) as {
      sessionId?:        string
      stakeholderName?:  string
      channel?:          'manual' | 'whatsapp' | 'slack' | 'teams' | 'email'
      provenance?:       'user_pasted' | 'sent_via_quorum'
      sourceText?:        string
      sourceTimestamp?:   string
      sourceLink?:        string
    }

    if (!sessionId || !stakeholderName?.trim() || !channel || !provenance || !sourceText?.trim()) {
      return NextResponse.json({ error: 'sessionId, stakeholderName, channel, provenance, and sourceText are required' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { data: session } = await supabase
      .from('sessions')
      .select('decision_text')
      .eq('id', sessionId)
      .single()
    const decisionText = decrypt(session?.decision_text) ?? ''

    const stakeholder = await upsertStakeholder(userId, stakeholderName.trim())
    const extracted    = await extractStakeholderClaims(stakeholderName.trim(), decisionText, sourceText.trim())

    const { data: created, error } = await supabase
      .from('stakeholder_inputs')
      .insert({
        session_id:      sessionId,
        stakeholder_id:  stakeholder.id,
        channel,
        provenance,
        source_text:     encrypt(sourceText.trim()),
        source_timestamp: sourceTimestamp || null,
        source_link:      sourceLink || null,
        extracted_claims: encryptJson(extracted),
      })
      .select('id, created_at')
      .single()

    if (error || !created) {
      console.error('[StakeholderInput] insert failed:', error)
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    }

    return NextResponse.json({
      id:              created.id,
      createdAt:       created.created_at,
      stakeholderName: stakeholder.name,
      extracted,
    })
  } catch (err) {
    console.error('[StakeholderInput] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
