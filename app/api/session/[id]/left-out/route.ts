// app/api/session/[id]/left-out/route.ts
// ── v17 Phase 6: what the intake did not ask ─────────────────────────────────
//
// GET -> { items: [{ key, label, ask, chips? }], flowVersion, closedBy }
//
// The intake can finish without asking everything: the fast path deliberately leaves lower-weight required slots to the Council
// ("not asked"), and any chat that reaches its ceiling stops with some material gaps. The Council is told about both. The person
// was not: there was nowhere to go back and add them. This returns those questions, in Quorum's own plain wording, so the Council
// page can offer "add what I left out" (components/LeftOutCard.tsx), which feeds the answers to the existing in-session
// "new information" pipeline (handleShareContext): all six advisors re-read, one new synthesis version, no duplicate decision.
//
// Returns QUESTIONS ONLY: slot labels and the question text from lib/chat-intake-brief.ts. Nothing the person said, no decision text.
// Identified the same way as /api/session/[id]/cross-decision (the session id is the capability).
//
// What it does NOT offer: slots the person already answered, said they did not know, said did not apply, or chose to skip.
// Those were decisions, and asking again would be nagging. Sessions that did not come from the chat (no chat_intake_id), and
// chats that asked everything, return an empty list, and the card does not appear.

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { checkLimit, getClientIP, LIMITS } from '@/lib/rate-limit'
import { leftOutFor } from '@/lib/left-out'
import type { ChatDecisionState } from '@/lib/types'

interface Params { params: Promise<{ id: string }> }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NO_STORE = { 'Cache-Control': 'no-store' }
export async function GET(req: Request, { params }: Params) {
  // Runtime switch (no rebuild): LEFT_OUT_CARD=off returns nothing, so the card never appears.
  if (process.env.LEFT_OUT_CARD === 'off') return NextResponse.json({ items: [], flowVersion: null, closedBy: null }, { headers: NO_STORE })
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ items: [], flowVersion: null, closedBy: null }, { status: 400, headers: NO_STORE })
  const rl = checkLimit(getClientIP(req), LIMITS.events)
  if (!rl.allowed) return NextResponse.json({ items: [], flowVersion: null, closedBy: null }, { headers: NO_STORE })

  try {
    const supabase = createServiceClient()
    const { data: session } = await supabase.from('sessions').select('id, chat_intake_id').eq('id', id).single()
    if (!session?.chat_intake_id) return NextResponse.json({ items: [], flowVersion: null, closedBy: null }, { headers: NO_STORE })

    const { data: intake } = await supabase.from('chat_intakes').select('decision_state').eq('id', session.chat_intake_id).single()
    const state = (intake?.decision_state as ChatDecisionState | null) ?? null
    return NextResponse.json(
      { items: leftOutFor(state), flowVersion: state?.flowVersion ?? null, closedBy: state?.closedBy ?? null },
      { headers: NO_STORE },
    )
  } catch (err) {
    console.warn('[api/session/left-out] failed:', err)
    return NextResponse.json({ items: [], flowVersion: null, closedBy: null }, { headers: NO_STORE })
  }
}
