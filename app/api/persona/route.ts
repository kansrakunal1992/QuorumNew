/**
 * QUORUM — Persona Route (Sprint 19 / R2 / R1 / R3 / R5 / R6 update)
 *
 * Sprint 19 additions:
 *
 *   Council Context Enrichment — extended to all 6 initial personas
 *     Previously (Sprint 12), buildCouncilContext() was only injected for
 *     'synthesis' and 'decision_brief'. Initial Council personas ran blind
 *     to rule engine signals.
 *
 *     Now: fetchCouncilContext() fires for ALL persona calls where
 *     messages.length === 0 (first-pass Council) AND the session has a
 *     stored v2.0 ontology_vector + rule_engine_result.
 *
 *     Pushback calls (messages.length > 0, !rawMessages) are excluded —
 *     they are user-reactive and don't need structural re-injection.
 *
 *     Gracefully no-ops for v1.0 sessions or missing data. Non-blocking.
 *
 * Sprint R2 additions:
 *
 *   Longitudinal Bias Injection — all initial personas + synthesis
 *
 *     fetchUserBiasContext() queries bias_library for the user's bias profile
 *     (detection_count >= 1, so early users with 1–3 sessions are included)
 *     and injects two differentiated blocks:
 *
 *       personaAlert    → appended to each initial persona's system prompt.
 *                         Single sentence. Only fires for CONFIRMED + DISTORTING
 *                         biases (detection_count >= 2 + signal = distorting).
 *
 *       synthesisBlock  → appended to synthesis system prompt. Full block with
 *                         all bias rows (confirmed + forming), all scores, and
 *                         a MANDATORY assessment directive.
 *
 *     userId is resolved server-side from the sessions table using sessionId —
 *     no client-side change required (PersonaPanel/SynthesisCard unchanged).
 *
 * Sprint R1 additions:
 *
 *   Persona-specific structural directives
 *     getPersonaStructuralDirective(personaKey) appended to structuralBlock.
 *     contrarian and stakeholder_mirror added to PERSONAS_WITH_STRUCTURAL_CONTEXT.
 *
 *   System prompt layer order (after R1):
 *     1. persona.prompt            — core identity and mandate
 *     2. councilContext            — ontology + rule engine signals
 *     3. synthesisBlock            — longitudinal bias record (synthesis only)
 *     4. pushbackProtocol          — pushback acknowledgment (pushback calls only)
 *     5. personaAlertBlock         — top distorting bias alert (initial personas only)
 *
 * Sprint R3 additions:
 *
 *   Council Weighting Directive — synthesis only, non-negotiable
 *
 *     computePersonaRelevance() scores all 6 advisor personas against the
 *     session's rule engine signals, ontology dimensions, and structural match
 *     quality. buildRelevanceBlock() serialises the result as a MANDATORY
 *     NON-NEGOTIABLE directive appended as the final layer in the synthesis
 *     system prompt.
 *
 *     This prevents synthesis from applying flat equal weight to all 6
 *     advisors regardless of which structural dimensions dominate the decision.
 *     A high-irreversibility session where Risk Architect and Contrarian fired
 *     should resolve Council divergence in their favour — not flatten the blend.
 *
 *     Position: appended LAST in the synthesis system prompt (after synthesisBlock)
 *     so it is the final instruction seen before synthesis output begins.
 *     LLM adherence is highest for terminal system prompt instructions.
 *
 *     fetchCouncilContext() extended to also return:
 *       ruleEngineResult  — the full RuleEngineResult (already fetched, now returned)
 *       maxStructuralScore — extracted from matches_json, sourced from
 *                            structural_matches (NOT sessions_ontology — see
 *                            BUGFIX note at the fetchCouncilContext call site).
 *     One additional DB query (structural_matches, keyed by session_id). No client-side changes.
 *
 *   Updated system prompt layer order (after R3, synthesis calls):
 *     1. persona.prompt            — core identity and mandate
 *     2. councilContext            — ontology + rule engine signals
 *     3. synthesisBlock            — longitudinal bias record (synthesis only)
 *     4. relevanceBlock            — MANDATORY council weighting directive (synthesis only) ← NEW
 *
 * Sprint R5 additions:
 *
 *   Structural output traceability (conditional)
 *     A lightweight output requirement appended to the structuralBlock — inside
 *     the user turn, after the existing persona-specific structural mandate.
 *
 *     Design: conditional, not mandatory. If the structural record genuinely
 *     shaped the persona's angle, they close with one sentence beginning
 *     \"Structurally, this decision [observation].\" If the record did not apply
 *     to their specific analytical angle, the sentence is omitted entirely.
 *
 * Sprint R6 additions:
 *
 *   Structural citation → tag, not free-form sentence
 *     R5's free-form closing sentence was never parsed on the frontend — it
 *     streamed in as anonymous prose, indistinguishable from the rest of the
 *     persona's analysis. Worse, the only visible signal that structural
 *     retrieval had fired at all was a single hardcoded banner on the
 *     pattern_analyst card, driven by a session-wide flag — disconnected from
 *     whether pattern_analyst (or any of the other 4 eligible personas) had
 *     actually produced a citation.
 *
 *     Fix: the conditional sentence is now wrapped in <structural>...</structural>,
 *     matching the existing <lens>/<position>/<realcost>/<lean> tag convention.
 *     PersonaPanel extracts and strips it per-persona and renders a citation
 *     badge ONLY on cards whose own output actually contains the tag — no
 *     more session-wide flag standing in for five personas' individual
 *     editorial judgment.
 *
 * RET-5 Sprint 2 additions:
 *
 *   Council continuity for linked revisits (decision-continuity.ts)
 *
 *     fetchContinuityContext() fires in parallel with fetchCouncilContext() for
 *     all initial persona and synthesis calls. Returns EMPTY_CONTINUITY_CONTEXT
 *     (no-op) when the session has no parent_session_id.
 *
 *     When a parent exists, gathers from it:
 *       - decision text + context text
 *       - prior Council synthesis (capped at 600 chars)
 *       - examiner Q&A + user pushback (up to 6 lines, decrypted)
 *       - logged outcome (what_decided + council_helped)
 *       - commitment_leaning + commitment_switch (where they were leaning
 *         and what they said would change their course)
 *
 *     Two injection points:
 *       personaBlock        → prepended to initial persona user turn.
 *                             Informational framing; not a mandate.
 *       synthesisDirective  → appended AFTER relevanceBlock (Layer 4) as the
 *                             true terminal layer in synthesis system prompt.
 *                             NON-NEGOTIABLE. Forces explicit reference to
 *                             prior synthesis, examiner evidence, and outcome.
 *
 *     Updated system prompt layer order (synthesis, when revisit):
 *       1. persona.prompt
 *       2. councilContext
 *       3. synthesisBlock         — longitudinal bias record
 *       4. relevanceBlock         — MANDATORY council weighting directive
 *       5. synthesisDirective     — MANDATORY continuity / prior-sitting reference ← NEW
 */

import { PERSONAS }                            from '@/lib/personas'
import { createServiceClient }                 from '@/lib/supabase'
import { createStream }                        from '@/lib/ai-client'
import {
  PERSONAS_WITH_STRUCTURAL_CONTEXT,
  getPersonaStructuralDirective,             // Sprint R1
}                                            from '@/lib/structural-retrieval'
import { buildCouncilContext }               from '@/lib/rule-engine'
import { fetchUserBiasContext, EMPTY_USER_BIAS_CONTEXT } from '@/lib/bias-scorer'
import { computePersonaRelevance, buildRelevanceBlock } from '@/lib/persona-relevance'  // Sprint R3
import { type CouncilContext, EMPTY_COUNCIL_CONTEXT } from '@/lib/council-context'
import { fetchContinuityContext, EMPTY_CONTINUITY_CONTEXT } from '@/lib/decision-continuity'  // RET-5 Sprint 2
import {
  upsertStructuralEdge,            // Sprint G1: live graph edge writes
  fetchGraphSynthesisContext,      // Sprint G4: synthesis integration
  EMPTY_GRAPH_SYNTHESIS_CONTEXT,   // Sprint G4
} from '@/lib/graph-engine'
import type { OntologyScoreMap }             from '@/lib/bias-scorer'
import type { ScoredVector }                 from '@/lib/ontology-tagger'
import type { RuleEngineResult }             from '@/lib/rule-engine'
import type { PersonaKey, Message }          from '@/lib/types'
import { checkLimit, getClientIP, tooManyRequests, LIMITS } from '@/lib/rate-limit'
import { encrypt, decryptJson }              from '@/lib/encryption'

// ── Council context fetch (Sprint 12 / R2 / R3 update) ───────────────────────
//
// Sprint R2: return shape extended with userId for fetchUserBiasContext().
// Sprint R3: return shape further extended with ruleEngineResult and
//   maxStructuralScore for computePersonaRelevance() at synthesis time.
//   matches_json is read from structural_matches (its actual home table,
//   populated by the structural-match route) via one additional query —
//   see BUGFIX note at the fetchCouncilContext call site for why this
//   is NOT read from sessions_ontology.
//
// Sprint TB1 (June 2026): this shape was previously hand-typed as an inline
// object literal in 7 separate places across this file (the function
// signature, the retry wrapper's signature, 3 early returns inside the try
// block, the catch block, and the no-fetch fallback in POST) — a diligence
// finding from the same engagement: a function signature extended with new
// optional fields in three places caused exactly one fallback literal
// elsewhere to be missed on first deploy, a TypeScript build failure that
// shipped a partial shape until caught. Named here once; every site below
// now references CouncilContext / EMPTY_COUNCIL_CONTEXT instead of
// retyping the shape. A future field addition that misses one of these
// sites will now fail to compile rather than silently passing partial
// data into synthesis.

async function fetchCouncilContext(sessionId: string): Promise<CouncilContext> {
  try {
    const supabase = createServiceClient()

    const [ontologyResult, sessionResult, structuralMatchResult] = await Promise.all([
      supabase
        .from('sessions_ontology')
        // Sprint BT Phase 2b: +decision_type_primary, +dominant_emotion — the
        // CURRENT session's own canonical categorical fields, needed to check
        // whether a discovered category trigger (lib/bias-trigger-engine.ts)
        // is active for THIS decision. No race condition here — both are
        // written by the same ontology-tagger call as ontology_vector itself,
        // well before synthesis runs (unlike Phase 2a's flag triggers, which
        // depend on a separate fire-and-forget bias-score call).
        //
        // BUGFIX (root-caused via S2-02 diagnostic, July 2026): matches_json
        // was previously selected here too, but it does NOT exist on
        // sessions_ontology — it lives on the separate structural_matches
        // cache table (populated by /api/structural-match, keyed by
        // session_id). Selecting a nonexistent column makes Postgres reject
        // the ENTIRE query (error 42703), so `data` came back null on every
        // single call — silently collapsing ontology_vector and
        // rule_engine_result to null downstream even though the ontology
        // tagger had written real data. This was the actual cause of
        // computePersonaRelevance always returning flat 0.50 baseline.
        .select('tagger_version, ontology_vector, rule_engine_result, decision_type_primary, dominant_emotion')
        .eq('session_id', sessionId)
        .single(),
      supabase
        .from('sessions')
        // S2-05: read validation_correction_carry (prior session's correction, copied at
        // session creation) rather than validation_correction (current session's own correction,
        // which doesn't exist yet at persona-call time — it's only set after synthesis + validation).
        .select('user_id, framing_intent, validation_correction_carry')
        .eq('id', sessionId)
        .single(),
      // BUGFIX: matches_json's real source — structural_matches, not sessions_ontology.
      // Encrypted at rest (matches the pattern in app/api/structural-match/route.ts),
      // decrypted below via decryptJson. maybeSingle() because a match cache row may
      // not exist yet (e.g. this session's structural retrieval hasn't run/cached).
      supabase
        .from('structural_matches')
        .select('matches_json')
        .eq('session_id', sessionId)
        .maybeSingle(),
    ])

    const userId             = sessionResult.data?.user_id ?? null
    const framingIntent      = (sessionResult.data as { framing_intent?: string | null } | null)?.framing_intent ?? null
    const validationCorrection = (sessionResult.data as { validation_correction_carry?: string | null } | null)?.validation_correction_carry ?? null

    const { data, error } = ontologyResult

    // Production warning (not diagnostic-only) — this branch silently discarding
    // real ontology data was the root cause of the flat-0.50 weighting bug
    // (July 2026). Kept permanently so a future schema drift on sessions_ontology
    // surfaces immediately in logs instead of silently degrading synthesis quality.
    if (error || !data) {
      if (error) console.warn('[fetchCouncilContext] sessions_ontology query failed:', JSON.stringify(error), '| sessionId:', sessionId)
      return { ...EMPTY_COUNCIL_CONTEXT, userId }
    }
    // .trim() guards against trailing whitespace/control chars in the stored
    // value causing a silent strict-equality mismatch on tagger_version.
    if (data.tagger_version?.trim() !== 'v2.0') {
      return { ...EMPTY_COUNCIL_CONTEXT, userId }
    }
    if (!data.ontology_vector || !data.rule_engine_result) {
      return { ...EMPTY_COUNCIL_CONTEXT, userId }
    }

    // Sprint R3 / BUGFIX: extract max structural score from matches_json —
    // now correctly sourced from structural_matches (decrypted), not from
    // sessions_ontology (which never had this column — see note above).
    let maxStructuralScore: number | null = null
    try {
      const rawMatchesJson = structuralMatchResult.data?.matches_json
      const decrypted = rawMatchesJson ? decryptJson(rawMatchesJson) : null
      const matches = Array.isArray(decrypted)
        ? decrypted as Array<{ structural_score?: number }>
        : null
      if (matches && matches.length > 0) {
        const scores = matches.map(m => m.structural_score ?? 0).filter(s => s > 0)
        if (scores.length > 0) maxStructuralScore = Math.max(...scores)
      }
    } catch {
      // matches_json absent, malformed, or not yet cached — maxStructuralScore stays null
    }

    // SB-3: fetch user profile for council context injection
    let userProfile: import('@/lib/rule-engine').CouncilUserProfile | null = null
    if (userId) {
      const { data: profileData } = await supabase
        .from('user_profiles')
        .select('archetype, primary_fears, mbti_type, life_stage, risk_stance')
        .eq('user_id', userId)
        .single()
      userProfile = profileData ?? null
    }

    const ruleEngineResult = data.rule_engine_result as RuleEngineResult

    return {
      councilContextStr: buildCouncilContext(
        data.ontology_vector as ScoredVector,
        ruleEngineResult,
        userProfile,          // SB-3: profile block
        framingIntent,        // SB-3: framing intent directive
        validationCorrection, // SB-3: prior session correction
      ),
      ontologyVector:     data.ontology_vector as OntologyScoreMap,
      userId,
      ruleEngineResult,                    // Sprint R3
      maxStructuralScore,                  // Sprint R3
      decisionTypePrimary: (data.decision_type_primary as string) ?? null,  // Sprint BT Phase 2b
      dominantEmotion:     (data.dominant_emotion as string) ?? null,        // Sprint BT Phase 2b
    }
  } catch (err) {
    console.error('[Persona] fetchCouncilContext failed:', err)
    return EMPTY_COUNCIL_CONTEXT
  }
}

/**
 * Sprint 19 fix — race condition guard for initial personas.
 *
 * Initial personas fire immediately in parallel with ontology tagging.
 * sessions_ontology is often not yet written when the first DB read happens,
 * so fetchCouncilContext returns null silently — context never injected.
 *
 * Fix: retry with 400ms intervals for up to 3 seconds. Ontology typically
 * writes within 1–2 seconds. Adds ≤400ms latency before streaming starts
 * in the common case (first or second retry succeeds), which is imperceptible
 * given personas take 5–15s to complete.
 *
 * Synthesis calls do NOT use this — ontology is always written by then.
 * userId is still returned even when ontology is not yet ready (from sessions table).
 */
async function fetchCouncilContextWithRetry(
  sessionId: string,
  maxWaitMs  = 3000,
  intervalMs = 400,
): Promise<CouncilContext> {
  const start = Date.now()
  while (true) {
    const result = await fetchCouncilContext(sessionId)
    if (result.councilContextStr !== null) return result
    const elapsed = Date.now() - start
    if (elapsed + intervalMs >= maxWaitMs) return result
    await new Promise(r => setTimeout(r, intervalMs))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  // S5-01: rate limit persona calls — 60 per 10 min per IP
  const rlResult = checkLimit(getClientIP(req), LIMITS.persona)
  if (!rlResult.allowed) return tooManyRequests(rlResult, 'analysis requests')

  try {
    const {
      sessionId,
      personaKey,
      messages,
      decisionText,
      contextText,
      rawMessages,
      registerMode,
      structuralContext,
      examinerContext,
      resubmitAlertId,
      isExaminerContextCall,
    }: {
      sessionId:               string
      personaKey:              PersonaKey
      messages:                Message[]
      decisionText:            string
      contextText?:            string
      rawMessages?:            boolean
      registerMode?:           'analytical' | 'clarification'
      isExaminerContextCall?:  boolean   // set by share-context + examiner updates — skips pushbackProtocol injection only; saves still run
      structuralContext?: string
      examinerContext?:   string
      resubmitAlertId?:   string   // Sprint D3: set when session resubmitted from avoidance alert
    } = await req.json()

    const persona = PERSONAS[personaKey]
    if (!persona) return new Response('Unknown persona', { status: 400 })

    // ── Determine call type ───────────────────────────────────────────────────
    const isSynthesisCall  = rawMessages && (personaKey === 'synthesis' || personaKey === 'decision_brief')
    const isInitialPersona = !rawMessages && messages.length === 0

    // ── Fetch council context + userId in one shot ────────────────────────────
    // Sprint R3: councilContextPromise now also resolves ruleEngineResult and
    // maxStructuralScore so computePersonaRelevance() needs no extra DB call.
    const councilContextPromise = (isSynthesisCall || isInitialPersona) && sessionId
      ? isInitialPersona
        ? fetchCouncilContextWithRetry(sessionId)
        : fetchCouncilContext(sessionId)
      : Promise.resolve(EMPTY_COUNCIL_CONTEXT)

    // ── RET-5 Sprint 2: continuity context — fires in parallel with council context ──
    // Only for the two call types that run full system-prompt assembly.
    // Non-blocking: EMPTY_CONTINUITY_CONTEXT returned when session has no parent.
    const continuityContextPromise = (isSynthesisCall || isInitialPersona) && sessionId
      ? fetchContinuityContext(sessionId)
      : Promise.resolve(EMPTY_CONTINUITY_CONTEXT)

    // ── Sprint R2: bias context — chained off councilContextPromise ───────────
    // Sprint BT Phase 2b: also threads the CURRENT session's decisionTypePrimary
    // and dominantEmotion through, so fetchUserBiasContext can check whether a
    // discovered category trigger is active for THIS decision (same pattern as
    // ontologyVector for dimension triggers).
    const biasContextPromise = (isSynthesisCall || isInitialPersona)
      ? councilContextPromise.then(({ ontologyVector, userId, decisionTypePrimary, dominantEmotion }) =>
          userId
            ? fetchUserBiasContext(userId, ontologyVector, decisionTypePrimary, dominantEmotion)
            : Promise.resolve(EMPTY_USER_BIAS_CONTEXT)
        )
      : Promise.resolve(EMPTY_USER_BIAS_CONTEXT)

    // ── Sprint G4: graph synthesis context — synthesis only ───────────────────
    // Fetches edges for the current session from graph_edges, builds a concise
    // synthesis block naming structural connections, contradictions, and shared
    // bias triggers to past decisions. Includes a Pattern Analyst weighting
    // directive when connectedCount >= 2.
    // Non-fatal: EMPTY_GRAPH_SYNTHESIS_CONTEXT on any error ('' = no-op).
    // Runs in parallel with biasContextPromise — no dependency between them.
    const graphContextPromise = isSynthesisCall
      ? councilContextPromise.then(({ userId, decisionTypePrimary }) =>
          fetchGraphSynthesisContext(
            createServiceClient(),
            userId,
            sessionId ?? null,
            decisionTypePrimary,
          ).catch(err => {
            console.warn('[Persona] fetchGraphSynthesisContext failed (non-fatal):', err)
            return EMPTY_GRAPH_SYNTHESIS_CONTEXT
          })
        )
      : Promise.resolve(EMPTY_GRAPH_SYNTHESIS_CONTEXT)

    // ── Build chat messages ───────────────────────────────────────────────────
    let chatMessages: { role: 'user' | 'assistant'; content: string }[]

    if (rawMessages && messages.length > 0) {
      chatMessages = messages.map(m => ({
        role:    m.role as 'user' | 'assistant',
        content: m.content,
      }))
    } else {
      const registerBlock = registerMode === 'clarification'
        ? `\nSESSION MODE — CLARIFICATION:\nThe decision-maker has indicated they are looking for help understanding what they want, not just analysis of outcomes. They are facing a values or identity question as much as a practical one. Weight your response accordingly: The Elder and Stakeholder Mirror perspectives are most relevant. Surface the values tension before the risk analysis. Do not optimise for a calculable outcome.\n`
        : `\nSESSION MODE — ANALYTICAL:\nThe decision-maker wants rigorous challenge of their thinking. Run your full framework without softening.\n`

      const contextBlock = contextText
        ? `\nCONTEXT PROVIDED BY DECISION-MAKER:\n${contextText}\n`
        : ''

      // Sprint R5 → R6: OUTPUT TRACEABILITY — conditional. Originally instructed a
      // free-form closing sentence ("Structurally, this decision..."), which the
      // frontend never parsed or displayed — it just streamed in as anonymous
      // prose. R6 converts it to a <structural> tag, matching the existing
      // <lens>/<position>/<realcost>/<lean> header-tag convention: the frontend
      // extracts it, strips it from displayed prose, and renders it as a
      // per-persona citation badge (see PersonaPanel extractHeaderTags).
      const structuralBlock = (
        structuralContext &&
        PERSONAS_WITH_STRUCTURAL_CONTEXT.has(personaKey) &&
        messages.length === 0
      )
        ? `\n${structuralContext}\n\nYOUR STRUCTURAL MANDATE: ${getPersonaStructuralDirective(personaKey)}\n\nOUTPUT TRACEABILITY (conditional): If the structural record above has genuinely shaped your angle — if you can draw a specific parallel or contrast — include exactly one <structural>...</structural> tag, placed as the very last thing in your response, after all other prose and tags. Inside it, write one sentence naming the specific observation (e.g. "This echoes the same avoidance-of-conflict pattern that shaped your March decision on the lease renewal."). Write it so it reads naturally as a citation, not as a continuation of your analysis. If the structural memory did not apply to your specific analytical angle, omit the tag entirely. Do not fabricate a citation.\n`
        : ''

      if (messages.length === 0) {
        const examinerBlock = examinerContext
          ? `\n\nEXAMINER CONTEXT — captured before the Council ran:\n${examinerContext}\n`
          : ''
        chatMessages = [{
          role:    'user',
          content: `${registerBlock}${structuralBlock}DECISION: ${decisionText}${contextBlock}${examinerBlock}\nPlease give your full assessment as ${persona.label}.`,
        }]
      } else {
        chatMessages = [
          {
            role:    'user',
            content: `${registerBlock}${structuralBlock}DECISION: ${decisionText}${contextBlock}\nPlease give your full assessment as ${persona.label}.`,
          },
          ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        ]
      }
    }

    // ── Resolve council context + bias context + continuity context in parallel ─
    const [councilResult, biasContext, continuityCtx, graphContext] = await Promise.all([
      councilContextPromise,
      biasContextPromise,
      continuityContextPromise,   // RET-5 Sprint 2
      graphContextPromise,        // Sprint G4
    ])
    const councilContext = councilResult.councilContextStr

    // ── RET-5 Sprint 2: continuity block — initial personas only ─────────────
    // Injected into the user turn (informational framing, not a mandate).
    // Position: prepended before registerBlock so it reads as the broadest
    // framing before session-mode and decision text. Only fires when this
    // session has a parent (continuityCtx.personaBlock is '' otherwise).
    if (isInitialPersona && continuityCtx.personaBlock) {
      chatMessages[0] = {
        ...chatMessages[0],
        content: `${continuityCtx.personaBlock}\n\n${chatMessages[0].content}`,
      }
      console.log(`[Persona] Continuity block injected for ${personaKey} | parent ${continuityCtx.parentSessionId?.slice(0, 8)} | session ${sessionId}`)
    }

    // ── Pushback acknowledgment protocol ──────────────────────────────────────
    // Skipped for examiner-context / share-context calls (isExaminerContextCall) —
    // those are supplemental AI-to-AI updates, not real user challenges. Injecting
    // the protocol causes the model to echo instruction text into its response and
    // the wrapper prompt text to leak into record-page "You challenged" blocks.
    const isPushbackCall = !rawMessages && messages.length > 0
    const lastMsg = messages[messages.length - 1]
    const pushbackText = isPushbackCall && !isExaminerContextCall && lastMsg?.role === 'user'
      ? lastMsg.content.trim()
      : null

    const pushbackProtocol = pushbackText
      ? `\n\nMANDATORY PUSHBACK PROTOCOL — NON-NEGOTIABLE:\nThe decision-maker has just submitted the following challenge or new information:\n"${pushbackText}"\n\nRESPONSE FORMAT — follow exactly, no exceptions:\n\n1. FIRST sentence only: identify what they introduced. One sentence. Nothing before it.\n   Valid forms: "You've introduced [X]." / "Your pushback adds [X]." / "The new information here is [X]."\n\n2. THEN in 3–5 sentences: state specifically what this changes in your prior analysis, and what it does NOT change — and why.\n\n3. Stop. Maximum 150 words total.\n\nHARD BANS — any violation renders the response invalid:\n• NEVER open with "PUSHBACK MODE" or any other label, header, or prefix\n• NEVER restart your full analysis framework — no "The pre-mortem:", no "Execution risk:", no "Assumption risk:", no "Dependency risk:" headers\n• NEVER repeat analysis you already gave — cover only what the pushback changes\n• NEVER start with "I" as the first word\n• NEVER use transition openers ("I hear you, but…" / "That said…" / "However…")\n• Keep under 150 words — always finish the sentence you are writing before stopping`
      : ''

    // ── Assemble system prompt ────────────────────────────────────────────────
    // Layer order (synthesis):
    //   1. persona.prompt         — core identity and mandate
    //   2. councilContext         — ontology + rule engine signals
    //   3. synthesisBlock         — longitudinal bias record (synthesis only)
    //   4. relevanceBlock         — MANDATORY council weighting directive (synthesis only) ← R3
    //
    // Layer order (initial personas):
    //   1. persona.prompt
    //   2. councilContext
    //   4. pushbackProtocol       — pushback acknowledgment enforcement (pushback only)
    //   5. personaAlertBlock      — top confirmed+distorting bias (initial personas only)

    let basePrompt = councilContext
      ? `${persona.prompt}\n\n${councilContext}`
      : persona.prompt

    // Layer 3: full bias block for synthesis — MANDATORY directive included
    if (isSynthesisCall && biasContext.synthesisBlock) {
      basePrompt = `${basePrompt}\n\n${biasContext.synthesisBlock}`
      console.log(`[Persona] Longitudinal bias block injected for synthesis | session ${sessionId}`)
    }

    // Layer 3.5 (Sprint G4): Decision Graph context — synthesis only
    // Injected after the bias block and before the relevance directive so it
    // sits with the other longitudinal/historical context layers, not the
    // structural/rule-engine signals which belong to Layer 2. Empty string
    // when no graph edges exist yet for this session (non-fatal no-op).
    if (isSynthesisCall && graphContext.synthesisBlock) {
      basePrompt = `${basePrompt}\n\n${graphContext.synthesisBlock}`
      console.log(`[Persona] Graph context injected for synthesis | ${graphContext.connectedCount} connection(s) | session ${sessionId}`)
    }

    // ── Sprint D3: Resubmission context ───────────────────────────────────────
    // When the user clicked "Bring it back →" from an avoidance alert in Mirror,
    // resubmitAlertId is present. Fetch the alert snapshot and inject a short
    // context block so synthesis acknowledges the elapsed time and asks whether
    // the framing has shifted — without framing it as failure.
    // Non-fatal: if the fetch fails or the userId is unknown, injection is skipped.
    if (isSynthesisCall && resubmitAlertId && councilResult.userId) {
      try {
        const supabaseD3 = createServiceClient()
        const { data: alertRow } = await supabaseD3
          .from('avoidance_alerts')
          .select('days_open, structural_echo, user_id')
          .eq('id', resubmitAlertId)
          .single()

        if (alertRow && (alertRow as any).user_id === councilResult.userId) {
          const daysOpen = (alertRow as any).days_open as number
          const echo     = (alertRow as any).structural_echo as { matchScore: number; decisionSnippet: string } | null

          const echoNote = echo
            ? ` A prior decision was structurally similar to this one (${echo.matchScore}/100 match: "${echo.decisionSnippet.slice(0, 80)}…"). Consider whether the dynamic that applied then is present here.`
            : ''

          const resubmissionBlock = `
RESUBMISSION CONTEXT — read this before synthesising:
This decision was first brought to Quorum ${daysOpen} days ago and was not resolved at that time. The user is now bringing it back.

Your synthesis should:
1. Acknowledge that time has passed — frame elapsed time as information, not as failure or avoidance. Something like: "The fact that this has been open for ${daysOpen} days is itself worth reading — whether that's because the conditions weren't right, or because something has shifted in the framing."
2. Note whether anything in the current Council analysis suggests the question has changed since it was first brought. If the framing, stakes, or options look different, name what changed and what that implies for the direction of this analysis.
3. Do NOT use the phrase "you avoided this" or any language that frames the elapsed time as a failure. The observation is neutral — time open is a signal, not an indictment.${echoNote}

MANDATORY: weave this context into your synthesis naturally. Do not create a separate section header for it.`

          basePrompt = `${basePrompt}\n\n${resubmissionBlock.trim()}`
          console.log(`[Persona] Resubmission context injected for synthesis | alert ${resubmitAlertId.slice(0, 8)} | ${daysOpen}d open`)
        }
      } catch (err) {
        // Non-fatal — synthesis proceeds without resubmission context
        console.warn('[Persona] Resubmission context fetch failed (non-fatal):', err)
      }
    }

    // Layer 4 (R3): council weighting directive — synthesis only, always last
    // Fires even when councilContext is null (persona may still have useful
    // baseline weights from ontology dimensions). No-ops gracefully if both
    // ruleEngineResult and ontologyVector are null (returns baseline 0.50 map
    // which produces a flat directive — still valid, just less informative).
    // Sprint CAL: personalCalibrationZones threaded through from biasContext —
    // already resolved above, no extra DB call needed.
    // S2-02: relevanceMap hoisted to outer scope so it can be exposed to the
    // client via the X-Persona-Relevance response header — this is the exact
    // map used in the MANDATORY directive, not a client-side recomputation.
    let relevanceMapForHeader: Record<string, number> | null = null
    if (isSynthesisCall) {
      const relevanceMap = computePersonaRelevance(
        councilResult.ruleEngineResult,
        councilResult.ontologyVector,
        councilResult.maxStructuralScore,
        biasContext.personalCalibrationZones,
      )

      relevanceMapForHeader = relevanceMap
      const relevanceBlock = buildRelevanceBlock(
        relevanceMap,
        councilResult.ruleEngineResult,
        councilResult.ontologyVector,
        councilResult.maxStructuralScore,
        biasContext.personalCalibrationZones,
      )
      basePrompt = `${basePrompt}${relevanceBlock}`
      console.log(`[Persona] Council weighting directive injected for synthesis | session ${sessionId}`)

      // ── RET-5 Sprint 2: continuity directive — terminal layer (after relevanceBlock) ──
      // Position matters: this must be the final instruction before synthesis output
      // begins. LLM adherence is highest for terminal system prompt instructions.
      // NON-NEGOTIABLE — synthesis must explicitly reference prior sitting evidence.
      // No-ops (empty string) when session has no parent_session_id.
      if (continuityCtx.synthesisDirective) {
        basePrompt = `${basePrompt}${continuityCtx.synthesisDirective}`
        console.log(`[Persona] Continuity synthesis directive injected | parent ${continuityCtx.parentSessionId?.slice(0, 8)} | session ${sessionId}`)
      }
    }

    // Layer 5: one-sentence bias alert for initial personas (confirmed + distorting only)
    const personaAlertBlock = (isInitialPersona && biasContext.personaAlert)
      ? `\n\n${biasContext.personaAlert}`
      : ''

    const systemPrompt = `${basePrompt}${pushbackProtocol}${personaAlertBlock}`

    if (councilContext) {
      console.log(`[Persona] Council context injected for ${personaKey} (${isInitialPersona ? 'initial' : 'synthesis'}) | session ${sessionId}`)
    }
    if (isInitialPersona && biasContext.personaAlert) {
      console.log(`[Persona] Bias alert injected for ${personaKey} | session ${sessionId}`)
    }

    // ── Stream ────────────────────────────────────────────────────────────────
    const { readable, getContent } = await createStream(
      systemPrompt,
      chatMessages,
      personaKey === 'synthesis' ? 'anthropic' : 'deepseek',
    )

    const passthrough = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader  = readable.getReader()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            controller.enqueue(value)
          }

          const assistantContent = getContent()?.trim()
          const supabase         = createServiceClient()

          // Save pushback / share-context user message.
          // For isExaminerContextCall, this is the examiner wrapper; the brief PDF
          // strips it via cleanPushbackText() and the record page does the same.
          // We save it so the full exchange (user context + advisor update) is
          // captured in the record and included in the Decision Brief.
          if (sessionId && messages.length > 0 && !rawMessages) {
            const lastMsg = messages[messages.length - 1]
            if (lastMsg.role === 'user') {
              await supabase.from('messages').insert({
                session_id: sessionId,
                persona:    personaKey,
                role:       'user',
                content:    encrypt(lastMsg.content),
              })
            }
          }

          // Save assistant response.
          // For isExaminerContextCall this is the advisor's update after receiving
          // peer-challenge context — deliberately saved so it appears in the record
          // page and is included in the Decision Brief PDF.
          if (sessionId && assistantContent) {
            const { error } = await supabase.from('messages').insert({
              session_id: sessionId,
              persona:    personaKey,
              role:       'assistant',
              content:    encrypt(assistantContent),
            })
            if (error) console.error('[Persona] Supabase insert error:', error)
          }

          controller.close()
        } catch (err) {
          controller.error(err)
        }
      },
    })

    return new Response(passthrough, {
      headers: {
        'Content-Type':      'text/plain; charset=utf-8',
        'Cache-Control':     'no-cache',
        'X-Accel-Buffering': 'no',
        // S2-02: expose the exact relevance map used in the synthesis directive
        // so the client can render the Council Weighting Strip without recomputation.
        ...(relevanceMapForHeader
          ? { 'X-Persona-Relevance': JSON.stringify(relevanceMapForHeader) }
          : {}),
      },
    })
  } catch (err) {
    console.error('[Persona] Route error:', err)
    return new Response('Internal server error', { status: 500 })
  }
}
