/**
 * lib/decision-continuity.ts
 * ── RET-5 Sprint 2: Council continuity for linked revisits ──────────────────
 * ── + auto-trigger extension: continuity on high-confidence structural match ─
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
 *                          block in app/api/persona/route.ts). Empty string
 *                          for inferred matches — see below.
 *
 * AUTO-TRIGGER EXTENSION: previously this only fired when the user explicitly
 * used "Reanalyze" (parent_session_id set). Structural matching already runs
 * on every live session and writes to structural_scores — this extension
 * reads that existing table (no new scoring logic, no new LLM call) and, when
 * the best match clears STRUCTURAL_AUTO_CONTINUITY_THRESHOLD, reuses the same
 * evidence-gathering pipeline below to build continuity context, exactly as
 * for an explicit revisit.
 *
 * The one deliberate difference: an inferred match is the system's *guess*
 * that two decisions are related, not the user's confirmed statement that
 * they are. Overclaiming that certainty would mean telling the Council "this
 * IS the same decision" when it might not be. So synthesisDirective — the
 * MANDATORY, non-negotiable layer — stays empty for inferred matches.
 * Only personaBlock fires, worded as inferred similarity ("this looks like it
 * may be connected to..."), not confirmed continuation ("this is the same
 * decision continuing..."). isRevisit vs isInferredMatch on the returned
 * context lets a caller tell the two apart if that distinction ever matters
 * downstream (e.g. for logging).
 *
 * Evidence gathering (examiner Q&A + pushback) mirrors the pattern already
 * established in app/api/mirror/contradictions/route.ts, scoped to a single
 * reference session instead of a user's full history.
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
  isInferredMatch:    boolean   // true only for the auto-trigger path below
  parentSessionId:    string | null
  personaBlock:       string   // '' when neither path fires
  synthesisDirective: string   // '' when not an explicit revisit
}

export const EMPTY_CONTINUITY_CONTEXT: ContinuityContext = {
  isRevisit:          false,
  isInferredMatch:    false,
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

// Auto-trigger bar. Deliberately stricter than MATCH_THRESHOLD=45 (the bar
// for a lightweight "structural echo" citation elsewhere in the app) — this
// injects a materially larger amount of context (prior synthesis, examiner
// answers, outcome), so it should only fire when the match is genuinely
// strong, not merely present. Confirmed with the person building this.
const STRUCTURAL_AUTO_CONTINUITY_THRESHOLD = 60

function formatParentDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
}

// Finds the best-scoring OTHER session for this one from structural_scores —
// a read-only query against a table the existing retrieval pipeline already
// populates during every live session. No new scoring, no new LLM call.
// structural_scores is a symmetric pair table (session_id_a/session_id_b),
// so this checks both columns and returns whichever side isn't sessionId.
async function findBestStructuralMatch(
  supabase: ReturnType<typeof createServiceClient>,
  sessionId: string,
): Promise<{ matchedSessionId: string; score: number } | null> {
  const { data } = await supabase
    .from('structural_scores')
    .select('session_id_a, session_id_b, total_score')
    .or(`session_id_a.eq.${sessionId},session_id_b.eq.${sessionId}`)
    .gte('total_score', STRUCTURAL_AUTO_CONTINUITY_THRESHOLD)
    .order('total_score', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null
  const row = data as any
  const matchedSessionId = row.session_id_a === sessionId ? row.session_id_b : row.session_id_a
  return { matchedSessionId, score: row.total_score }
}

export async function fetchContinuityContext(sessionId: string): Promise<ContinuityContext> {
  try {
    const supabase = createServiceClient()

    const { data: current } = await supabase
      .from('sessions')
      .select('parent_session_id')
      .eq('id', sessionId)
      .single()

    const explicitParentId = current?.parent_session_id ?? null

    // ── Resolve which "reference session" (if any) to build continuity from,
    // and which mode: explicit revisit (full mandatory treatment) or inferred
    // match (informational only). Explicit always wins if both would fire —
    // a user who clicked Reanalyze has already told us the relationship;
    // there's no need to also guess at it.
    let referenceSessionId: string | null = null
    let isInferredMatch = false

    if (explicitParentId) {
      referenceSessionId = explicitParentId
    } else {
      const bestMatch = await findBestStructuralMatch(supabase, sessionId)
      if (bestMatch) {
        referenceSessionId = bestMatch.matchedSessionId
        isInferredMatch = true
        console.log(`[DecisionContinuity] Auto-trigger: inferred match score ${bestMatch.score} | session ${sessionId} → ${referenceSessionId}`)
      }
    }

    if (!referenceSessionId) return EMPTY_CONTINUITY_CONTEXT

    const [parentResult, synthesisResult, examinerResult, pushbackResult, outcomeResult] = await Promise.all([
      supabase
        .from('sessions')
        .select('decision_text, context_text, commitment_leaning, commitment_switch, created_at')
        .eq('id', referenceSessionId)
        .single(),
      supabase
        .from('messages')
        .select('content')
        .eq('session_id', referenceSessionId)
        .eq('persona', 'synthesis')
        .eq('role', 'assistant')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('examiner_responses')
        .select('question_text, response_text')
        .eq('session_id', referenceSessionId)
        .not('response_text', 'is', null),
      supabase
        .from('messages')
        .select('content, persona')
        .eq('session_id', referenceSessionId)
        .eq('role', 'user'),
      supabase
        .from('outcomes')
        .select('what_decided, council_helped')
        .eq('session_id', referenceSessionId)
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
    // Wording differs by mode: explicit revisit states the connection as
    // fact ("this IS a direct revisit"); inferred match states it as the
    // system's own read, honestly hedged ("this looks like it may connect
    // to..."), since that's actually true — no user confirmed this one.
    const personaBlock = isInferredMatch
      ? `POSSIBLE CONNECTION — this decision's structural profile closely matches one the user brought to Quorum on ${parentDateStr}, though they have not confirmed the two are related:\n"${parentDecision}"${parentContext ? `\nContext at the time: ${parentContext}` : ''}${synthesisText ? `\n\nTHE COUNCIL'S SYNTHESIS ON THAT EARLIER DECISION:\n${synthesisText.slice(0, PARENT_SYNTHESIS_CHAR_CAP)}` : ''}${commitmentLine}${evidenceBlock}${outcomeLine}\n\nIf this genuinely looks like the same underlying question resurfacing, you may reference it — but do not assert continuity as fact the way you would for a confirmed revisit. Treat this as a pattern worth naming, not a established history.`
      : `CONTINUITY — this is a direct revisit of a decision the user brought to Quorum on ${parentDateStr}, not a new or unrelated decision:\n"${parentDecision}"${parentContext ? `\nContext at the time: ${parentContext}` : ''}${synthesisText ? `\n\nTHE COUNCIL'S PRIOR SYNTHESIS:\n${synthesisText.slice(0, PARENT_SYNTHESIS_CHAR_CAP)}` : ''}${commitmentLine}${evidenceBlock}${outcomeLine}\n\nThis is the SAME decision continuing, not a structurally similar but separate one. If your prior position still holds, say so plainly. If the new context changes your view, name what changed it.`

    // ── Synthesis directive — MANDATORY, appended as the terminal system-
    // prompt layer (highest adherence — same rationale as the R3 relevance
    // block). Numbered items are conditional on what evidence actually exists,
    // so the directive never references evidence that wasn't found.
    // Deliberately skipped entirely for inferred matches — see module comment.
    let synthesisDirective = ''
    if (!isInferredMatch) {
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

      synthesisDirective = `

CONTINUITY DIRECTIVE — NON-NEGOTIABLE:
This session is a revisit of a decision first brought to Quorum on ${parentDateStr}. The user is not starting over — they are continuing.

Your synthesis MUST explicitly address, in your own words (woven into the synthesis, not a separate labelled section):
${directiveItems.join('\n')}

Do not treat this as a fresh decision. The user will notice if the Council appears to have forgotten what was already established.`
    }

    return {
      isRevisit:          !isInferredMatch,
      isInferredMatch,
      parentSessionId:    isInferredMatch ? null : referenceSessionId,
      personaBlock,
      synthesisDirective,
    }
  } catch (err) {
    console.error('[DecisionContinuity] fetchContinuityContext failed:', err)
    return EMPTY_CONTINUITY_CONTEXT
  }
}
