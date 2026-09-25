/**
 * QUORUM — Chat Intake Checkpoint Route (Natural Intake v1)
 *
 * Fires when the user confirms "Here's the decision I think you're actually
 * making" (or edits it first). Deliberately does NOT duplicate session
 * creation, ontology tagging, or bias scoring — it assembles
 * decision_text/context_text from the chat and sends them through the
 * EXISTING POST /api/session, exactly as HomeClient.tsx's classic form does
 * today. Everything downstream (ontology tagger, structural match, and —
 * once the person opens the checkpoint screen — the Examiner's
 * derive-and-confirm check) runs unchanged.
 *
 * This is Depth B in the plan (section 4D): runs once per decision, whether
 * or not the person goes on to Convene the Council.
 */

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { isNaturalIntakeEnabled } from '@/lib/feature-flags'
import { assembleSessionInput } from '@/lib/chat-intake-state'
import { decrypt } from '@/lib/encryption'
import type { ChatDecisionState, ChatIntakeMessage } from '@/lib/types'

export async function POST(req: Request) {
  if (!isNaturalIntakeEnabled()) {
    return NextResponse.json({ error: 'Not enabled' }, { status: 404 })
  }

  try {
    const { chatIntakeId, editedDecisionText, framingIntent } = (await req.json()) as {
      chatIntakeId?:        string
      // "Edit" on the reflection screen — the user's correction always wins
      // (plan section 4E), so this simply overrides the auto-assembled
      // decision statement rather than re-running extraction.
      editedDecisionText?:  string
      framingIntent?:       'challenge' | 'clarify' | 'right'
    }

    if (!chatIntakeId) {
      return NextResponse.json({ error: 'chatIntakeId is required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    const { data: intakeRow, error: intakeErr } = await supabase
      .from('chat_intakes')
      .select('id, decision_state, status, user_id, user_email, device_id')
      .eq('id', chatIntakeId)
      .single()

    if (intakeErr || !intakeRow) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }
    if (intakeRow.status === 'checkpointed') {
      return NextResponse.json({ error: 'Already checkpointed' }, { status: 409 })
    }

    const { data: msgRows } = await supabase
      .from('chat_intake_messages')
      .select('*')
      .eq('chat_intake_id', chatIntakeId)
      .order('turn_order', { ascending: true })

    const transcript: ChatIntakeMessage[] = (msgRows ?? []).map(m => ({
      ...m, content: decrypt(m.content) ?? '',
    }))

    const state = (intakeRow.decision_state as ChatDecisionState | null) ?? {}
    const { decisionText, contextText } = assembleSessionInput(state, transcript)

    const finalDecisionText = editedDecisionText?.trim() || decisionText
    if (!finalDecisionText) {
      return NextResponse.json({ error: 'Nothing to checkpoint yet' }, { status: 400 })
    }

    // ── Create the session through the EXISTING route ───────────────────────────
    // Same-origin server-to-server call, forwarding the caller's own auth —
    // identical to how a signed-in user's browser would call this route
    // directly. No internal secret needed (unlike fireOntologyTagger's
    // fire-and-forget sub-call in app/api/session/route.ts) since this is a
    // normal, awaited request the checkpoint response depends on.
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    const sessionRes = await fetch(`${baseUrl}/api/session`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(req.headers.get('Authorization') ? { Authorization: req.headers.get('Authorization')! } : {}),
      },
      body: JSON.stringify({
        decision_text:  finalDecisionText,
        context_text:   contextText,
        framing_intent: framingIntent ?? null,
        user_email:     intakeRow.user_email ?? null,
        device_id:      intakeRow.device_id ?? null,
        intake_mode:    'chat',
        chat_intake_id: chatIntakeId,
      }),
    })

    const sessionJson = await sessionRes.json()
    if (!sessionRes.ok || !sessionJson?.id) {
      console.error('[ChatIntake Checkpoint] session creation failed:', sessionJson)
      return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
    }
    const sessionId = sessionJson.id as string

    // session_depth: 'checkpoint' — see supabase/sprint_natural_intake_v1.sql's
    // comment on this column. Not read by any v1 Mirror code yet; set here
    // so the deferred fast-follow has correct historical data once it ships.
    await supabase.from('sessions').update({ session_depth: 'checkpoint' }).eq('id', sessionId)

    await supabase
      .from('chat_intakes')
      .update({ status: 'checkpointed', session_id: sessionId })
      .eq('id', chatIntakeId)

    return NextResponse.json({ sessionId })
  } catch (err) {
    console.error('[ChatIntake Checkpoint] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
