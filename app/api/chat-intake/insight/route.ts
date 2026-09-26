/**
 * QUORUM — Chat Intake Insight Route (Natural Intake v1)
 *
 * Powers the examine-phase "reward" card in DecisionCheckpoint.tsx: one
 * cheap model call that classifies how much this decision actually needs
 * Council-level scrutiny, and writes either a real verdict (low stakes) or
 * a grounded reason to convene Council (high stakes) — see
 * lib/chat-intake-insight.ts for the prompt and the product reasoning
 * behind that split.
 *
 * Reads decision_state straight from the chat_intakes row rather than
 * trusting a client-supplied copy — same pattern as the checkpoint route,
 * and avoids the client needing to re-send its whole local state blob.
 */

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { isNaturalIntakeEnabled } from '@/lib/feature-flags'
import { generateCheckpointInsight } from '@/lib/chat-intake-insight'
import type { ChatDecisionState } from '@/lib/types'

export async function POST(req: Request) {
  if (!isNaturalIntakeEnabled()) {
    return NextResponse.json({ error: 'Not enabled' }, { status: 404 })
  }

  try {
    const { chatIntakeId } = (await req.json()) as { chatIntakeId?: string }
    if (!chatIntakeId) {
      return NextResponse.json({ error: 'chatIntakeId is required' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { data: intakeRow, error } = await supabase
      .from('chat_intakes')
      .select('decision_state')
      .eq('id', chatIntakeId)
      .single()

    if (error || !intakeRow) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    const state = (intakeRow.decision_state as ChatDecisionState | null) ?? {}
    const insight = await generateCheckpointInsight(state)
    return NextResponse.json(insight)
  } catch (err) {
    console.error('[ChatIntake Insight] error:', err)
    // Same fallback generateCheckpointInsight() itself uses on a model
    // failure — the card always has something reasonable to show rather
    // than an empty/broken state.
    return NextResponse.json({
      stakesLevel: 'high',
      message: 'There\u2019s enough here — competing considerations, real stakes — that a second, more structured look tends to catch something a single quick read would miss.',
    })
  }
}
