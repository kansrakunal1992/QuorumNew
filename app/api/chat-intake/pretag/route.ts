/**
 * QUORUM -- Chat Intake Pre-tag Route (Natural Intake v13)
 *
 * Called (fire-and-forget) by the confirm screen the moment it appears. Runs the ontology tagger on the decision as it
 * stands NOW and parks the result on the chat (chat_intakes.pre_tag*), so that when the person taps "Convene the
 * Council", POST /api/ontology can use it instead of making the model call — which is what they used to wait for.
 *
 * Deliberately creates NO session and writes NOTHING to `sessions`: a decision that was only looked at must not exist
 * anywhere that counts, lists or exports sessions. The result is used only if the session's own tagger input hashes to the
 * same value (an edit or returning to the chat simply misses), and every failure means "tag normally" — nothing here can
 * make a launch fail or slow down. See lib/chat-intake-pretag.ts.
 */

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { checkLimit, getClientIP, tooManyRequests, LIMITS } from '@/lib/rate-limit'
import { isPreTagEnabled } from '@/lib/feature-flags'
import { assembleSessionInput } from '@/lib/chat-intake-state'
import { decrypt } from '@/lib/encryption'
import { tagDecision } from '@/lib/ontology-tagger'
import { claimPretag, pretagHash, storePretag, taggerInput } from '@/lib/chat-intake-pretag'
import type { ChatDecisionState, ChatIntakeMessage } from '@/lib/types'

export async function POST(req: Request) {
  if (!isPreTagEnabled()) {
    return NextResponse.json({ error: 'Not enabled' }, { status: 404 })
  }

  const rl = checkLimit(getClientIP(req), LIMITS.chatIntake)
  if (!rl.allowed) return tooManyRequests(rl, 'chat requests')

  try {
    const body = await req.json().catch(() => ({})) as { chatIntakeId?: string }
    const chatIntakeId = body.chatIntakeId
    if (!chatIntakeId) return NextResponse.json({ error: 'chatIntakeId is required' }, { status: 400 })

    const supabase = createServiceClient()
    const { data: intakeRow, error } = await supabase
      .from('chat_intakes')
      .select('id, decision_state, status')
      .eq('id', chatIntakeId)
      .single()
    if (error || !intakeRow) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    if (intakeRow.status !== 'active') return NextResponse.json({ status: 'skipped' })     // already launched / closed

    const { data: msgRows } = await supabase
      .from('chat_intake_messages')
      .select('*')
      .eq('chat_intake_id', chatIntakeId)
      .order('turn_order', { ascending: true })
    const transcript: ChatIntakeMessage[] = (msgRows ?? []).map(m => ({ ...m, content: decrypt(m.content) ?? '' }))

    // The SAME assembly the checkpoint uses to build the session's text, minus the person's own edit and lean/priority
    // taps (not known yet) — taggerInput() canonicalises both sides so a clean launch hashes identically.
    const state = (intakeRow.decision_state as ChatDecisionState | null) ?? {}
    const { decisionText, contextText } = assembleSessionInput(state, transcript)
    if (!decisionText) return NextResponse.json({ status: 'skipped' })

    const input = taggerInput(decisionText, contextText)
    const hash  = pretagHash(input.decisionText, input.contextText)

    const claim = await claimPretag(supabase as never, chatIntakeId, hash)
    if (claim !== 'claimed') return NextResponse.json({ status: claim })                    // 'held' (already running / done) or 'unavailable'

    const tag    = await tagDecision(input.decisionText, input.contextText)                  // null on any model/parse failure
    const stored = await storePretag(supabase as never, chatIntakeId, hash, tag)
    return NextResponse.json({ status: stored ? 'ready' : 'failed' })
  } catch (err) {
    console.error('[ChatIntake Pretag] error:', err)
    return NextResponse.json({ status: 'failed' })    // never an error the screen has to handle: the launch simply tags normally
  }
}
