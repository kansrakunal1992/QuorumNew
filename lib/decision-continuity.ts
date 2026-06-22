/**
 * lib/decision-continuity.ts
 * ── RET-5 Sprint 2: Council continuity for linked revisits ──────────────────
 *
 * When a session has parent_session_id set (RET-5 Sprint 1), the Council
 * should reason as a continuation of the parent decision — not treat the
 * revisit as a fresh, unrelated session. This module gathers everything
 * load-bearing from the parent sitting (decision text, prior synthesis,
 * examiner answers, pushback, logged outcome, and the commitment fields
 * captured at the time) and shapes it into two injection-ready blocks:
 *
 *   personaBlock        — informational, woven into each initial advisor's
 *                          system prompt. Not mandatory to reference.
 *   synthesisDirective   — MANDATORY, appended as the terminal layer of the
 *                          synthesis system prompt (highest instruction
 *                          adherence — same rationale as the R3 relevance
 *                          block in app/api/persona/route.ts).
 *
 * Evidence gathering (examiner Q&A + pushback) mirrors the pattern already
 * established in app/api/mirror/contradictions/route.ts, scoped to a single
 * parent session instead of a user's full history.
 *
 * Per KDD 196: this lives in a plain lib file — never as a named export from
 * app/api/persona/route.ts, which Next's route-type validation restricts to
 * GET/POST/etc.
 */

import { createServiceClient } from '@/lib/supabase'
import { decrypt } from '@/lib/encryption'
import { PERSONAS } from '@/lib/personas'
import type { PersonaKey } from '@/lib/types'

export interface ContinuityContext {
  isRevisit:          boolean
  parentSessionId:    string | null
  personaBlock:       string   // '' when not a revisit
  synthesisDirective: string   // '' when not a revisit
}

export const EMPTY_CONTINUITY_CONTEXT: ContinuityContext = {
  isRevisit:          false,
  parentSessionId:    null,
  personaBlock:       '',
  synthesisDirective: '',
}

// Same threshold the Contradiction Detector's evidence gatherer uses — skips
// one-word answers ("yes", "not sure") that would pad the prompt with noise.
const MIN_EVIDENCE_LENGTH = 15

// Caps total examiner + pushback lines injected, so a heavily-revisited or
// heavily-challenged parent session doesn't blow out prompt size.
const MAX_EVIDENCE_LINES = 6

const PARENT_SYNTHESIS_CHAR_CAP = 600

function formatParentDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
}

export async function fetchContinuityContext(sessionId: string): Promise<ContinuityContext> {
  try {
    const supabase = createServiceClient()

    const { data: current } = await supabase
      .from('sessions')
      .select('parent_session_id')
      .eq('id', sessionId)
      .single()

    const parentId = current?.parent_session_id ?? null
    if (!parentId) return EMPTY_CONTINUITY_CONTEXT

    const [parentResult, synthesisResult, examinerResult, pushbackResult, outcomeResult] = await Promise.all([
      supabase
        .from('sessions')
        .select('decision_text, context_text, commitment_leaning, commitment_switch, created_at')
        .eq('id', parentId)
        .single(),
      supabase
        .from('messages')
        .select('content')
        .eq('session_id', parentId)
        .eq('persona', 'synthesis')
        .eq('role', 'assistant')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('examiner_responses')
        .select('question_text, response_text')
        .eq('session_id', parentId)
        .not('response_text', 'is', null),
      supabase
        .from('messages')
        .select('content, persona')
        .eq('session_id', parentId)
        .eq('role', 'user'),
      supabase
        .from('outcomes')
        .select('what_decided, council_helped')
        .eq('session_id', parentId)
        .maybeSingle(),
    ])

    if (!parentResult.data) return EMPTY_CONTINUITY_CONTEXT

    const parentDecision = decrypt(parentResult.data.decision_text) ?? ''
    const parentContext  = decrypt(parentResult.data.context_text)  ?? ''
    const leaning        = decrypt(parentResult.data.commitment_leaning) ?? ''
    const switchTrigger  = decrypt(parentResult.data.commitment_switch)  ?? ''
    const parentDateStr  = formatParentDate(parentResult.data.created_at)

    const synthesisText = synthesisResult.data?.content ? (decrypt(synthesisResult.data.content) ?? '') : ''

    // ── Evidence: examiner answers first (deliberate reflection), then
    // pushback (reactive challenge) — capped, not truncated mid-thought.
    const evidenceLines: string[] = []
    for (const row of examinerResult.data ?? []) {
      const a = decrypt(row.response_text) ?? ''
      if (a.trim().length < MIN_EVIDENCE_LENGTH) continue
      const q = decrypt(row.question_text) ?? ''
      evidenceLines.push(`Examiner Q: ${q}\nUser's answer: ${a}`)
    }
    for (const row of pushbackResult.data ?? []) {
      const content = decrypt(row.content) ?? ''
      if (content.trim().length < MIN_EVIDENCE_LENGTH) continue
      const personaLabel = PERSONAS[row.persona as PersonaKey]?.label ?? row.persona
      evidenceLines.push(`Pushback to ${personaLabel}: "${content.slice(0, 300)}"`)
    }
    const cappedEvidence = evidenceLines.slice(0, MAX_EVIDENCE_LINES)

    const hasOutcome   = !!outcomeResult.data
    const outcomeLine  = hasOutcome
      ? `\nOUTCOME LOGGED: ${decrypt(outcomeResult.data!.what_decided) ?? ''} (Council helped: ${outcomeResult.data!.council_helped})`
      : ''

    const hasCommitment  = !!(leaning || switchTrigger)
    const commitmentLine = hasCommitment
      ? `\nAT THE TIME, the user said they were leaning toward: ${leaning || 'not captured'}.${switchTrigger ? ` What they said would change their course: ${switchTrigger}` : ''}`
      : ''

    const evidenceBlock = cappedEvidence.length > 0
      ? `\n\nWHAT CAME UP WHEN THIS WAS FIRST EXAMINED:\n${cappedEvidence.join('\n\n')}`
      : ''

    // ── Persona-facing block — informational, not mandatory to reference.
    const personaBlock = `CONTINUITY — this is a direct revisit of a decision the user brought to Quorum on ${parentDateStr}, not a new or unrelated decision:\n"${parentDecision}"${parentContext ? `\nContext at the time: ${parentContext}` : ''}${synthesisText ? `\n\nTHE COUNCIL'S PRIOR SYNTHESIS:\n${synthesisText.slice(0, PARENT_SYNTHESIS_CHAR_CAP)}` : ''}${commitmentLine}${evidenceBlock}${outcomeLine}\n\nThis is the SAME decision continuing, not a structurally similar but separate one. If your prior position still holds, say so plainly. If the new context changes your view, name what changed it.`

    // ── Synthesis directive — MANDATORY, appended as the terminal system-
    // prompt layer (highest adherence — same rationale as the R3 relevance
    // block). Numbered items are conditional on what evidence actually exists,
    // so the directive never references evidence that wasn't found.
    const directiveItems = [
      `1. What the Council's prior synthesis concluded then, and whether today's Council analysis confirms, revises, or contradicts it.`,
      cappedEvidence.length > 0
        ? `2. Where the examiner answers and pushback from that earlier session are still load-bearing for today's analysis — and where they've been superseded by what's new.`
        : null,
      hasOutcome
        ? `${cappedEvidence.length > 0 ? '3' : '2'}. The outcome the user logged from that earlier sitting, and what it implies for today.`
        : null,
      hasCommitment
        ? `${[cappedEvidence.length > 0, hasOutcome].filter(Boolean).length + 1}. Whether the new information changes what would make the user switch course, as they defined it then.`
        : null,
    ].filter((x): x is string => x !== null)

    const synthesisDirective = `

CONTINUITY DIRECTIVE — NON-NEGOTIABLE:
This session is a revisit of a decision first brought to Quorum on ${parentDateStr}. The user is not starting over — they are continuing.

Your synthesis MUST explicitly address, in your own words (woven into the synthesis, not a separate labelled section):
${directiveItems.join('\n')}

Do not treat this as a fresh decision. The user will notice if the Council appears to have forgotten what was already established.`

    return {
      isRevisit:          true,
      parentSessionId:    parentId,
      personaBlock,
      synthesisDirective,
    }
  } catch (err) {
    console.error('[DecisionContinuity] fetchContinuityContext failed:', err)
    return EMPTY_CONTINUITY_CONTEXT
  }
}
