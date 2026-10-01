/**
 * QUORUM — Chat Intake Lean Route (Natural Intake v4)
 *
 * Saves the two taps that now end the chat: "where are you leaning?" and
 * "what matters most here?". They go into chat_intakes.decision_state (no new
 * column, no session yet — the session only exists after the person confirms
 * their decision), and app/api/chat-intake/checkpoint/route.ts copies them
 * onto the new session as initial_instinct / optimization_priority.
 *
 * Bias protection (the reason this must happen before Quorum says anything
 * about the answer): nothing in the chat reply or this route reveals a
 * prediction. The prediction starts only after the checkpoint.
 *
 * Same value contract as app/api/session/[id]/instinct/route.ts — the 3-value
 * instinct and the 6 priority values are unchanged; this only adds the exact
 * option text the person tapped.
 */

import { NextResponse }          from 'next/server'
import { createServiceClient }   from '@/lib/supabase'
import { checkLimit, getClientIP, tooManyRequests, LIMITS } from '@/lib/rate-limit'
import { isNaturalIntakeEnabled } from '@/lib/feature-flags'
import { VALID_LEAN_VALUES, VALID_PRIORITY_VALUES, type LeanValue } from '@/lib/chat-intake-lean'
import type { ChatDecisionState } from '@/lib/types'

const MAX_LABEL_CHARS = 200

export async function POST(req: Request) {
  if (!isNaturalIntakeEnabled()) {
    return NextResponse.json({ error: 'Not enabled' }, { status: 404 })
  }

  const rl = checkLimit(getClientIP(req), LIMITS.chatIntake)
  if (!rl.allowed) return tooManyRequests(rl, 'chat requests')

  let body: {
    chatIntakeId?:         string
    initialInstinct?:      string
    optimizationPriority?: string
    label?:                string | null   // exact option text tapped; null/omitted for "not sure yet"
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { chatIntakeId, initialInstinct, optimizationPriority, label } = body

  if (!chatIntakeId) {
    return NextResponse.json({ error: 'chatIntakeId is required' }, { status: 400 })
  }
  if (!initialInstinct || !VALID_LEAN_VALUES.includes(initialInstinct as LeanValue)) {
    return NextResponse.json({ error: 'initialInstinct must be one of accept | reject | unsure' }, { status: 400 })
  }
  if (!optimizationPriority || !VALID_PRIORITY_VALUES.includes(optimizationPriority)) {
    return NextResponse.json({ error: 'optimizationPriority must be a recognized value' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: intakeRow, error: readErr } = await supabase
    .from('chat_intakes')
    .select('decision_state, status')
    .eq('id', chatIntakeId)
    .single()

  if (readErr || !intakeRow) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
  }
  if (intakeRow.status !== 'active') {
    return NextResponse.json({ error: 'Chat already closed' }, { status: 409 })
  }

  const prior = (intakeRow.decision_state as ChatDecisionState | null) ?? {}
  const cleanLabel = typeof label === 'string' && label.trim()
    ? label.trim().slice(0, MAX_LABEL_CHARS)
    : null

  const next: ChatDecisionState = {
    ...prior,
    chosenLean:           initialInstinct as LeanValue,
    chosenLeanLabel:      initialInstinct === 'unsure' ? null : cleanLabel,
    optimizationPriority,
  }

  const { error: writeErr } = await supabase
    .from('chat_intakes')
    .update({ decision_state: next })
    .eq('id', chatIntakeId)

  if (writeErr) {
    console.error('[ChatIntake Lean] save failed:', writeErr)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
