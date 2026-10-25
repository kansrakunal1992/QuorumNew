/**
 * QUORUM — Chat Intake Route (Natural Intake v1, adaptive brief v7)
 *
 * The pre-session chat: "What's going on?" through to "I think I've got
 * enough." No `sessions` row exists yet while this runs — see
 * supabase/sprint_natural_intake_v1.sql for why, and
 * app/api/chat-intake/checkpoint/route.ts for where a real session finally
 * gets created, through the EXISTING POST /api/session, unchanged.
 *
 * v7: ONE model call per turn (lib/chat-intake-planner.ts) returns the updated
 * notes, the next question with tap-answers, a playback line and a "sharp
 * friend" check. lib/chat-intake-turn.ts — pure, tested — decides what to do
 * with it: ask the most useful open slot of the decision brief, play back what
 * was understood, or wrap. Short replies (a tapped chip, "I don't know",
 * "yes, that's right", "that's enough") are understood without the model.
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
  DEFAULT_MAX_EXCHANGES,
  ABSOLUTE_MAX_EXCHANGES,
} from '@/lib/chat-intake-state'
import { generateAboutQuorumReply, closingLine, OPENING_LINE } from '@/lib/chat-intake-reply'
import { planTurn } from '@/lib/chat-intake-planner'
import { parsePlannerOutput } from '@/lib/chat-intake-plan-parse'
import type { PlannerOutput } from '@/lib/chat-intake-plan-parse'
import { decideTurn, preprocessTurn } from '@/lib/chat-intake-turn'
import type { QuickReplyKind, QuickReplyMeta, TurnResult } from '@/lib/chat-intake-turn'
import { fetchIntakeBackground } from '@/lib/chat-intake-memory'
import { INTAKE_FLOW_VERSION, ceilingFor, councilReadiness, readinessLine } from '@/lib/chat-intake-depth'
import { reflectionDue } from '@/lib/chat-intake-reflection'
import type { ChatDecisionState, ChatIntakeMessage } from '@/lib/types'
import { getGateMode, resolveArm, GATE_AFTER } from '@/lib/auth-gate'   // Phase 3: optional connect-before-next-decision gate

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

/** v9: the second card group's answer. Untrusted client input: shape-checked here, ids re-validated in preprocessTurn. */
function cleanCompanion(raw: unknown): QuickReplyMeta['companion'] {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.text !== 'string' || !r.text.trim()) return null
  return { text: r.text.slice(0, 900), card: (r.card ?? null) as NonNullable<QuickReplyMeta['companion']>['card'] }
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
      quickReply,
      walkthrough,
      action,
    } = (await req.json()) as {
      chatIntakeId?:    string
      message?:         string
      userEmail?:       string
      deviceId?:        string
      extraExchanges?:  boolean   // "Let me add more" tap at the reflection step
      quickReply?:      { kind?: string; slotKey?: string | null; card?: unknown; companion?: unknown }   // a tapped chip / card answer / "not sure" / playback answer
      walkthrough?:     boolean   // person chose "Walk me through it" on the first message
      action?:          'enough'  // "That's enough, show me" — wrap now, no new message
    }

    const QUICK_KINDS: QuickReplyKind[] = ['chip', 'cards', 'unknown', 'declined', 'playback_yes', 'playback_no', 'enough']
    const quick: QuickReplyMeta | null =
      action === 'enough' ? { kind: 'enough' }
      : quickReply && QUICK_KINDS.includes(quickReply.kind as QuickReplyKind)
        // v8: `card` is untrusted client data — preprocessTurn re-validates it against the card group stored server-side.
        ? { kind: quickReply.kind as QuickReplyKind, slotKey: typeof quickReply.slotKey === 'string' ? quickReply.slotKey.slice(0, 40) : null, card: (quickReply.card ?? null) as QuickReplyMeta['card'], companion: cleanCompanion(quickReply.companion) }
        : null
    const isEnough = quick?.kind === 'enough'

    if (isEnough) {
      if (!chatIntakeId) return NextResponse.json({ error: 'chatIntakeId is required' }, { status: 400 })
    } else if (!message?.trim()) {
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
      // -- Phase 3: optional "connect before the next decision" gate ----------
      // OFF unless NEXT_PUBLIC_AUTH_GATE_MODE is set (lib/auth-gate.ts). Only
      // applies to a brand-new chat from a device with no signed-in user. The
      // arm is derived from the device id, identically to the client, so the
      // UI and this check cannot disagree. A device with no id (no cookie
      // consent) cannot be gated server-side -- accepted, same as clearing storage.
      const gateMode = getGateMode()
      if (gateMode !== 'off' && !serverUserId && typeof deviceId === 'string' && deviceId) {
        const arm   = resolveArm(gateMode, deviceId)
        const after = arm ? GATE_AFTER[arm] : null
        if (arm && after !== null) {
          const { count } = await supabase
            .from('sessions')
            .select('*', { count: 'exact', head: true })
            .eq('device_id', deviceId)
          if ((count ?? 0) >= after) {
            return NextResponse.json({ error: 'auth_required', arm, decisionCount: count ?? 0 }, { status: 403 })
          }
        }
      }

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

    // Narrow `string | null` to `string` once, then use the immutable value
     // throughout the remainder of the request.
     if (!intakeId) {
     console.error('[ChatIntake] intake ID was not resolved')
     return NextResponse.json(
     { error: 'Failed to resolve chat' },
     { status: 500 }
     )
     }
     const resolvedIntakeId: string = intakeId
    
    // ── Load transcript so far, append this user turn ──────────────────────────
    const { data: existingMsgs } = await supabase
      .from('chat_intake_messages')
      .select('role, content, turn_order')
      .eq('chat_intake_id', resolvedIntakeId)
      .order('turn_order', { ascending: true })

    const transcriptSoFar: ChatIntakeMessage[] = (existingMsgs ?? []).map(m => ({
      id: '', chat_intake_id: resolvedIntakeId, role: m.role as 'user' | 'quorum',
      content: decrypt(m.content) ?? '', turn_order: m.turn_order, created_at: '',
    }))

    const userText  = message?.trim() ?? ''
    let   nextOrder = transcriptSoFar.length
    let   transcriptWithUser = transcriptSoFar

    // "That's enough, show me" is a button, not a message — nothing to store for the user's side.
    if (!isEnough) {
      const { error: insertUserErr } = await supabase.from('chat_intake_messages').insert({
        chat_intake_id: resolvedIntakeId,
        role:           'user',
        content:        encrypt(userText),
        turn_order:     nextOrder,
      })
      if (insertUserErr) {
        console.error('[ChatIntake] insert user turn failed:', insertUserErr)
        return NextResponse.json({ error: 'Failed to save message' }, { status: 500 })
      }
      transcriptWithUser = [...transcriptSoFar, {
        id: '', chat_intake_id: resolvedIntakeId, role: 'user', content: userText,
        turn_order: nextOrder, created_at: '',
      }]
      nextOrder += 1
    }

    const exchangeCount = existingCount + 1
    // v9: the ceiling is a SAFETY limit that scales with stakes (5 / 7 / 9) — never a number of questions to ask.
    const state0: ChatDecisionState = { ...(priorState ?? {}), flowVersion: priorState?.flowVersion ?? INTAKE_FLOW_VERSION }
    const ceiling       = ceilingFor(state0, Math.min(DEFAULT_MAX_EXCHANGES + (extraExchanges ? 3 : 0), ABSOLUTE_MAX_EXCHANGES))
    const closing       = closingLine()

    // ── 1. Read the reply (chips, "I don't know", yes / no, "enough") — no model ─
    const pre = preprocessTurn(state0, userText, quick, {
      firstMessage: transcriptSoFar.length === 0,
      walkthrough:  !!walkthrough,
      closingLine:  closing,
      exchange:     exchangeCount,
    })

    let result: TurnResult
    if (pre.shortCircuit) {
      result = pre.shortCircuit
    } else {
      // ── 2. ONE planner call: notes + next question + playback + sharp-friend check
      const decisionHint = pre.state.decisionStatement || transcriptWithUser.find(m => m.role === 'user')?.content || userText
      const background   = await fetchIntakeBackground(serverUserId, decisionHint, exchangeCount)
      let planner: PlannerOutput | null = await planTurn({
        state: pre.state, transcript: transcriptWithUser, exchangeCount, ceiling, background, cardNote: pre.cardNote ?? null,
        reflectionDue: reflectionDue(exchangeCount, pre.state.turnsSinceReflection),
      })

      // Planner down? Fall back to the (hardened) legacy extraction so we still get a
      // decision statement and options, then let the turn logic ask from the slot list.
      if (!planner) {
        const legacy = await extractDecisionState(pre.state, transcriptWithUser)
        planner = parsePlannerOutput(JSON.stringify({ notes: legacy }))
      }

      // The person asked about Quorum itself mid-chat: answer from the FAQ, keep the question pending.
      const faqReply = planner?.aboutQuorum ? await generateAboutQuorumReply(transcriptWithUser) : null

      // ── 3. Decide: ask / sharp-friend check / playback / wrap ─────────────────
      result = decideTurn(pre.state, {
        planner, userText, dontKnow: pre.dontKnow, exchangeCount, ceiling, closingLine: closing, faqReply,
        captureText: pre.primaryText,
        asked: transcriptSoFar.filter(m => m.role === 'quorum').map(m => m.content),
      })
    }

    // v9: when the chat wraps, say so honestly — enough for the Council, or stopped with essential gaps — instead of one fixed line.
    if (result.action === 'close') {
      result = { ...result, reply: readinessLine(councilReadiness(result.state)) }
    }
    const updatedState = result.state

    const { error: insertQuorumErr } = await supabase.from('chat_intake_messages').insert({
      chat_intake_id: resolvedIntakeId,
      role:           'quorum',
      content:        encrypt(result.reply),
      turn_order:     nextOrder,
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
      .eq('id', resolvedIntakeId)

    return NextResponse.json({
      chatIntakeId:   resolvedIntakeId,
      quorumReply:    result.reply,
      state:          updatedState,
      exchangeCount,
      readyToReflect: result.readyToReflect,
      quickReplies:   result.quickReplies,
      action:         result.action,
      // v9 — for analytics and the summary screen: counts and ids only, never wording.
      readiness:      councilReadiness(updatedState).state,
      reflection:     result.reflection ?? null,
      flowVersion:    updatedState.flowVersion ?? null,
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
