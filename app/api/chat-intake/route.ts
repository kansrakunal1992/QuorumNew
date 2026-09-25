/**
 * QUORUM — Chat Intake Route (Natural Intake v1)
 *
 * The pre-session chat: "What's going on?" through to "I think I've got
 * enough." No `sessions` row exists yet while this runs — see
 * supabase/sprint_natural_intake_v1.sql for why, and
 * app/api/chat-intake/checkpoint/route.ts for where a real session finally
 * gets created, through the EXISTING POST /api/session, unchanged.
 *
 * Two things happen on every turn:
 *   1. A silent, cheap structural extraction (lib/chat-intake-state.ts) —
 *      never shown to the user, never gates the conversation.
 *   2. A short conversational reply (lib/chat-intake-reply.ts) in Quorum's
 *      own voice.
 *
 * Entirely inert unless NEXT_PUBLIC_NATURAL_INTAKE_ENABLED is on.
 */

import { NextResponse }          from 'next/server'
import { createServiceClient, createClient } from '@/lib/supabase'
import { encrypt, decrypt }      from '@/lib/encryption'
import { checkLimit, getClientIP, tooManyRequests, LIMITS } from '@/lib/rate-limit'
import { isNaturalIntakeEnabled } from '@/lib/feature-flags'
import {
  extractDecisionState,
  shouldStopEarly,
  DEFAULT_MAX_EXCHANGES,
  ABSOLUTE_MAX_EXCHANGES,
} from '@/lib/chat-intake-state'
import { generateFollowUpReply, OPENING_LINE } from '@/lib/chat-intake-reply'
import type { ChatDecisionState, ChatIntakeMessage } from '@/lib/types'

async function resolveUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7).trim()
  if (!token) return null
  try {
    const anonClient = createClient()
    const { data: { user } } = await anonClient.auth.getUser(token)
    return user?.id ?? null
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  if (!isNaturalIntakeEnabled()) {
    return NextResponse.json({ error: 'Not enabled' }, { status: 404 })
  }

  const rlResult = checkLimit(getClientIP(req), LIMITS.chatIntake)
  if (!rlResult.allowed) return tooManyRequests(rlResult, 'chat requests')

  try {
    const serverUserId = await resolveUserId(req)

    const {
      chatIntakeId,
      message,
      userEmail,
      deviceId,
      extraExchanges,
    } = (await req.json()) as {
      chatIntakeId?:    string
      message?:         string
      userEmail?:       string
      deviceId?:        string
      extraExchanges?:  boolean   // "Let me add more" tap at the reflection step
    }

    if (!message?.trim()) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 })
    }

    const supabase = createServiceClient()
    let intakeId = chatIntakeId ?? null
    let priorState: ChatDecisionState | null = null
    let existingCount = 0

    if (intakeId) {
      const { data: intakeRow } = await supabase
        .from('chat_intakes')
        .select('decision_state, exchange_count, status')
        .eq('id', intakeId)
        .single()

      if (!intakeRow || intakeRow.status !== 'active') {
        return NextResponse.json({ error: 'Chat not found or already closed' }, { status: 404 })
      }
      priorState    = (intakeRow.decision_state as ChatDecisionState | null) ?? null
      existingCount = intakeRow.exchange_count ?? 0
    } else {
      const { data: created, error: createErr } = await supabase
        .from('chat_intakes')
        .insert({
          user_id:    serverUserId,
          user_email: userEmail?.trim().toLowerCase() || null,
          device_id:  deviceId || null,
        })
        .select('id')
        .single()

      if (createErr || !created) {
        console.error('[ChatIntake] create failed:', createErr)
        return NextResponse.json({ error: 'Failed to start chat' }, { status: 500 })
      }
      intakeId = created.id
    }

    // ── Load transcript so far, append this user turn ──────────────────────────
    const { data: existingMsgs } = await supabase
      .from('chat_intake_messages')
      .select('role, content, turn_order')
      .eq('chat_intake_id', intakeId)
      .order('turn_order', { ascending: true })

    const transcriptSoFar: ChatIntakeMessage[] = (existingMsgs ?? []).map(m => ({
      id: '', chat_intake_id: intakeId!, role: m.role as 'user' | 'quorum',
      content: decrypt(m.content) ?? '', turn_order: m.turn_order, created_at: '',
    }))

    const userOrder = transcriptSoFar.length
    const { error: insertUserErr } = await supabase.from('chat_intake_messages').insert({
      chat_intake_id: intakeId,
      role:           'user',
      content:        encrypt(message.trim()),
      turn_order:     userOrder,
    })
    if (insertUserErr) {
      console.error('[ChatIntake] insert user turn failed:', insertUserErr)
      return NextResponse.json({ error: 'Failed to save message' }, { status: 500 })
    }

    const userTurn: ChatIntakeMessage = {
      id: '', chat_intake_id: intakeId, role: 'user', content: message.trim(),
      turn_order: userOrder, created_at: '',
    }
    const transcriptWithUser = [...transcriptSoFar, userTurn]

    // ── Depth A: silent structured extraction ───────────────────────────────────
    const updatedState = await extractDecisionState(priorState, transcriptWithUser)
    const exchangeCount = existingCount + 1

    // First-turn gut reaction is captured but never surfaced back to the
    // user as a question (missing piece #1) — extractDecisionState sets
    // initialReaction from turn one only and never overwrites it afterward.

    const ceiling      = Math.min(DEFAULT_MAX_EXCHANGES + (extraExchanges ? 3 : 0), ABSOLUTE_MAX_EXCHANGES)
    const readyToReflect = shouldStopEarly(updatedState, exchangeCount) || exchangeCount >= ceiling

    // ── Conversational reply ─────────────────────────────────────────────────
    const quorumReply = readyToReflect
      ? await generateFollowUpReply(updatedState, transcriptWithUser, exchangeCount, ceiling, true)
      : await generateFollowUpReply(updatedState, transcriptWithUser, exchangeCount, ceiling, false)

    const { error: insertQuorumErr } = await supabase.from('chat_intake_messages').insert({
      chat_intake_id: intakeId,
      role:           'quorum',
      content:        encrypt(quorumReply),
      turn_order:     userOrder + 1,
    })
    if (insertQuorumErr) {
      console.error('[ChatIntake] insert quorum turn failed:', insertQuorumErr)
    }

    await supabase
      .from('chat_intakes')
      .update({
        decision_state:   updatedState,
        exchange_count:   exchangeCount,
        initial_reaction: updatedState.initialReaction ?? null,
        last_turn_at:     new Date().toISOString(),
      })
      .eq('id', intakeId)

    return NextResponse.json({
      chatIntakeId:    intakeId,
      quorumReply,
      state:           updatedState,
      exchangeCount,
      readyToReflect,
    })
  } catch (err) {
    console.error('[ChatIntake] POST error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET — resume an existing chat (e.g. after a page reload) or fetch the
// fixed opening line for a brand-new chat (no chatIntakeId yet — no DB call
// needed, matches missing-piece #1's "capture the reaction as the very
// first chat turn, before Quorum comments" from the plan).
export async function GET(req: Request) {
  if (!isNaturalIntakeEnabled()) {
    return NextResponse.json({ error: 'Not enabled' }, { status: 404 })
  }

  const { searchParams } = new URL(req.url)
  const chatIntakeId = searchParams.get('chatIntakeId')

  if (!chatIntakeId) {
    return NextResponse.json({ openingLine: OPENING_LINE })
  }

  const supabase = createServiceClient()

  const [{ data: intakeRow }, { data: msgRows }] = await Promise.all([
    supabase.from('chat_intakes').select('*').eq('id', chatIntakeId).single(),
    supabase.from('chat_intake_messages').select('*').eq('chat_intake_id', chatIntakeId).order('turn_order', { ascending: true }),
  ])

  if (!intakeRow) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
  }

  return NextResponse.json({
    intake: intakeRow,
    messages: (msgRows ?? []).map(m => ({ ...m, content: decrypt(m.content) })),
  })
}
