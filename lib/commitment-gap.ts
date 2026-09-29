import 'server-only'

// lib/commitment-gap.ts
// ── Commitment gap detection (Phase 5, v3) ────────────────────────────────────
//
// Missing piece #7, Kunal's natural-process note: "You have decided, but you
// haven't actually committed to an action." A decision is "made" here if
// either the Council flow locked a final_decision, or the session was
// otherwise marked completed (the light path's "I'm done" — see
// app/api/chat-intake/done/route.ts) — but commitment_captured_at is still
// null either way, meaning no next action was ever recorded.
//
// Deliberately framed as an observation the person can act on if they want,
// not a nag — someone closing a session with no next step may simply have
// wanted a second opinion, not a plan. See components usage: this is a
// gentle surface, never a blocking alert.

import { createServiceClient } from '@/lib/supabase'
import { decrypt } from '@/lib/encryption'

export interface CommitmentGapEntry {
  sessionId:     string
  decisionText:  string
  decidedAt:     string
}

export async function getCommitmentGaps(userId: string, limit = 10): Promise<CommitmentGapEntry[]> {
  const supabase = createServiceClient()

  const { data: rows } = await supabase
    .from('sessions')
    .select('id, decision_text, final_decision_locked_at, created_at')
    .eq('user_id', userId)
    .is('commitment_captured_at', null)
    .or('final_decision_locked_at.not.is.null,status.eq.completed')
    .order('created_at', { ascending: false })
    .limit(limit)

  return (rows ?? []).map(r => ({
    sessionId:    r.id,
    decisionText: decrypt(r.decision_text) ?? '',
    decidedAt:    r.final_decision_locked_at ?? r.created_at,
  }))
}
