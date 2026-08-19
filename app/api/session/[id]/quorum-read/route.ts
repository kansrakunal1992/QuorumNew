// app/api/session/[id]/quorum-read/route.ts
// PR7 — "Quorum's Read": the pre-Council structural summary screen.
//
// Read-only, no ownership check beyond session existing — same exposure
// level as synthesis-summary/route.ts in this same directory, which
// established that convention for session-scoped read routes.
//
// Returns everything the client needs to render the screen in one round
// trip: the AI-generated plain-English summary (lib/quorum-read.ts's
// buildStructuralSummary — GPT-5-mini, unconditional, see that file's
// header comment on why), plus the deterministic tension prediction and
// readiness state (both free/instant, computed here rather than trusted
// from the client — same reasoning as PR5's persona/route.ts readiness
// recomputation: this needs to be correct even if the client's local state
// somehow drifted).
//
// Client (QuorumReadCard.tsx) calls this once, after Examiner completes
// and only when readiness !== 'NOT_READY' (that case shows the "Not ready
// to call" banner instead — see SynthesisCard.tsx — and this screen would
// be redundant with it).

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { decrypt }             from '@/lib/encryption'
import { computeReadiness }    from '@/lib/readiness'
import { predictTension, buildStructuralSummary } from '@/lib/quorum-read'
import type { ScoredVector }   from '@/lib/ontology-tagger'
import type { RuleEngineResult } from '@/lib/rule-engine'

interface Params { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Params) {
  try {
    const { id: sessionId } = await params
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    const [sessionResult, ontologyResult, responsesResult] = await Promise.all([
      supabase.from('sessions').select('decision_text').eq('id', sessionId).single(),
      supabase.from('sessions_ontology').select('ontology_vector, rule_engine_result').eq('session_id', sessionId).single(),
      supabase.from('examiner_responses').select('question_text, response_text, criticality').eq('session_id', sessionId),
    ])

    const decisionText = decrypt(sessionResult.data?.decision_text) ?? ''
    const sv           = ontologyResult.data?.ontology_vector as ScoredVector | undefined
    const ruleResult   = ontologyResult.data?.rule_engine_result as RuleEngineResult | undefined

    if (!sv || !ruleResult) {
      // Ontology tagging hasn't completed yet, or this session predates it
      // (v1.0). Nothing to show — client falls back to skipping this screen.
      return NextResponse.json({ available: false })
    }

    const decryptedResponses = (responsesResult.data ?? []).map(r => ({
      question_text: decrypt(r.question_text) ?? '',
      response_text: decrypt(r.response_text) ?? null,
      criticality:   r.criticality as 'critical' | 'important' | 'optional' | null,
    }))
    const { readiness, unresolvedImportant } = computeReadiness(decryptedResponses)

    const tensionPrediction = predictTension(sv)

    // Best-effort — buildStructuralSummary already returns null on any
    // failure (see that function's doc comment); the client renders a
    // dimension-label fallback when summary is null rather than blocking.
    const summary = await buildStructuralSummary(decisionText, sv, ruleResult)

    return NextResponse.json({
      available: true,
      readiness,
      unresolvedImportantCount: unresolvedImportant.length,
      tensionPrediction,
      summary,
    })
  } catch (err) {
    console.error('[QuorumRead] Route error:', err)
    return NextResponse.json({ available: false })
  }
}
