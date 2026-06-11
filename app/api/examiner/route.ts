/**
 * QUORUM — Examiner Route
 *
 * Sprint S0 (June 12, 2026):
 *   - S0 (Subject Orientation) question added. Fires conditionally when the
 *     decision brief is underspecified: decision_text < 25 words AND no
 *     context_text provided. Gives the Council domain context about the
 *     decision subject that a brief text (e.g. "Should I sell MedML?") cannot
 *     supply. Stored with rule_id = 'S0' in examiner_responses — feeds
 *     synthesis immediately, available for longitudinal context in future.
 *   - Max questions reduced from 4 to 3. Rule slot budget: 2 without S0,
 *     1 with S0. C0 always retained (never displaced by S0).
 *   - S0_TEMPLATES (5 variants) + C0_TEMPLATES (5 variants) replace single
 *     constants. Selection is deterministic per sessionId via hash-mod —
 *     consistent on re-render, varied across sessions. Prevents templated
 *     feel for users logging multiple decisions.
 *   - S0 suppressed on REDIRECT mode (R1/R7) — same suppression as C0.
 *   - Early-exit guard (allRules.length === 0) updated: only exits early
 *     when S0 also would not fire. S0 can surface questions on zero-rule
 *     sessions where the brief is thin.
 *   - context_text added to session SELECT (needed for S0 trigger check).
 *   - All personalisation calls now run in a single Promise.all (rule
 *     questions + S0 + C0 fully parallel, no sequential dependency).
 *
 * Sprint R_JC (June 2, 2026):
 *   - biasHint (confirmed distorting bias patterns) injected into C0 +
 *     all rule question personalisation. NOT passed to S0 personalisation —
 *     S0 is a domain-context question, not a diagnostic probe.
 *   - fetchExaminerBiasHint() imported from lib/bias-scorer.
 *
 * Sprint D1 (Avoidance Detection foundation):
 *   - POST handler stamps sessions.last_action_at on submit + skip paths.
 *
 * Additional Risk B fix:
 *   - C0 fires on ALL decisions regardless of rule count.
 *     Only suppression: REDIRECT mode (R1/R7).
 *
 * Sprint 12 patch:
 *   - Background HTTP call to /api/bias-score replaces inline scorer.
 *   - GET handler: contextual rule question personalisation.
 */

import { NextResponse }          from 'next/server'
import { checkLimit, getClientIP, tooManyRequests, LIMITS } from '@/lib/rate-limit'
import { createServiceClient }   from '@/lib/supabase'
import { createCompletion }      from '@/lib/ai-client'
import { fetchExaminerBiasHint } from '@/lib/bias-scorer'  // Sprint R_JC
import { encrypt, decrypt }      from '@/lib/encryption'

// ─────────────────────────────────────────────────────────────────────────────
// Template banks — deterministic per session, varied across sessions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S0 — Subject Orientation question bank (5 variants).
 * Each variant elicits the same three things — what the subject is, its
 * current state, and what triggered the decision — but with genuinely
 * different sentence architecture. personaliseRuleQuestion() injects the
 * specific entity name and decision details on top.
 *
 * Design constraints:
 *   - Purely informational / domain-grounding. Never reflective or values-based
 *     (that is C0's territory). No overlap with success-definition framing.
 *   - Must work whether or not the decision names a specific entity.
 *   - Appropriate register for founders, CXOs, Family Office MDs.
 */
const S0_TEMPLATES = [
  "Brief us on this — what it is, where it stands right now, and what's made this question live for you.",
  "Before we work on this: what exactly is this, what's its current state, and what's brought this decision to a head?",
  "Give us the grounding: what is this, where does it sit today, and what triggered this question now?",
  "We need the context: what exactly is this, what's happened with it recently, and why is this decision surfacing now?",
  "Walk us through the situation: what is this, where things stand operationally, and what's making this the moment to decide?",
]

/**
 * C0 — JTBD anchor question bank (5 variants).
 * Each variant probes success definition from a genuinely different vantage:
 *   v1 — outcome + process (original)
 *   v2 — retrospective look-back (three-year frame)
 *   v3 — definitional ("what does 'this went well' actually mean")
 *   v4 — asymmetric cost-benefit (what winning points to + what loss costs)
 *   v5 — hidden intent (what the framing doesn't capture)
 *
 * biasHint is still passed to C0 personalisation (diagnostic sharpening).
 * Never overlaps with S0 — always reflective / forward-looking / values-adjacent.
 */
const C0_TEMPLATES = [
  "What would this decision have to deliver for you to feel it was genuinely the right call — not just in outcome, but in how it unfolded?",
  "When you look back on this in three years, what would have to be true for you to feel you got it right?",
  "Separate from how it turns out — what does 'this went well' actually mean for you in this specific situation?",
  "If this works out, what will you point to as the reason you made the right call — and what would a wrong outcome cost you that the upside doesn't cancel out?",
  "What are you actually trying to protect or achieve here that the obvious framing of this decision doesn't capture?",
]

/**
 * pickTemplate — deterministic per sessionId, varied across sessions.
 * Hash-mod selection: consistent on re-render (no question flicker),
 * but produces a different template index for different sessionIds.
 * C0 and S0 index into separate banks — no cross-contamination risk.
 */
function pickTemplate(templates: string[], sessionId: string): string {
  const hash = sessionId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return templates[hash % templates.length]
}

// ─────────────────────────────────────────────────────────────────────────────
// Personalisation prompt + helper
// ─────────────────────────────────────────────────────────────────────────────

// Sprint R_JC: biasHint is an optional compact string of the user's top
// confirmed distorting bias patterns. When present, the rewrite instruction
// includes an additional directive to sharpen questions that are directly
// relevant to a documented blind spot. Questions unrelated to the bias profile
// are personalised to the decision text normally — the hint doesn't override
// the core diagnostic intent, it reinforces it where evidence warrants.
// NOT passed to S0 personalisation — S0 is domain-context gathering, not
// a diagnostic probe; bias sharpening is irrelevant there.
const PERSONALISE_PROMPT = (ruleId: string, template: string, decision: string, biasHint?: string) => `
You are the Quorum Examiner. Rewrite the diagnostic question below so it is specific to the decision described.

RULES:
- Keep the core intent identical — do not change what information is being sought
- Replace generic language with concrete details from the decision text (e.g. names, assets, amounts, relationships, domains) wherever they are present
- Maximum 28 words
- Return ONLY the rewritten question — no quotes, no explanation, no preamble
${biasHint ? `\nUSER BIAS PROFILE (confirmed longitudinal patterns from prior decisions): ${biasHint}\nADDITIONAL RULE: If this specific diagnostic question is directly relevant to a documented pattern above, make it harder — sharper and more targeted at that exact blind spot. Otherwise, personalise to the decision text normally.\n` : ''}
DECISION: "${decision.slice(0, 450)}"

TEMPLATE QUESTION (${ruleId}): "${template}"

REWRITTEN QUESTION:`.trim()

async function personaliseRuleQuestion(
  ruleId:    string,
  template:  string,
  decision:  string,
  biasHint?: string,  // Sprint R_JC
): Promise<string> {
  try {
    const raw   = await createCompletion(PERSONALISE_PROMPT(ruleId, template, decision, biasHint), 80, { provider: 'deepseek' })
    const clean = raw.trim().replace(/^["']|["']$/g, '').trim()
    if (!clean || clean.split(' ').length > 40) return template
    return clean
  } catch (err) {
    console.error(`[Examiner GET] personaliseRuleQuestion failed for ${ruleId}:`, err)
    return template
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// v1.0 fallback — gap question generation
// ─────────────────────────────────────────────────────────────────────────────

const GAP_QUESTION_PROMPT = (gaps: string[]) => `You convert terse "unknown-unknown" gap descriptions into 3 concise, conversational diagnostic questions for a high-stakes decision-maker.

Rules:
- Each question must target the specific gap provided — do not genericise
- Write in second person ("What...?", "Have you...?", "Who...?")
- Maximum 20 words per question — tight, specific, no preamble
- Return ONLY a JSON array of 3 strings, nothing else, no markdown fences

Gaps to convert:
${gaps.map((g, i) => `gap_${i + 1}: "${g}"`).join('\n')}`

async function generateGapQuestions(gaps: string[]): Promise<string[]> {
  const nonEmpty = gaps.filter(Boolean)
  if (nonEmpty.length === 0) return []
  try {
    const raw    = await createCompletion(GAP_QUESTION_PROMPT(nonEmpty), 400, { provider: 'anthropic' })
    const clean  = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(clean)
    return Array.isArray(parsed) ? parsed.slice(0, 3).map(String) : []
  } catch (err) {
    console.error('[Examiner GET] generateGapQuestions failed:', err)
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — serve Examiner questions
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('sessionId')

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const [ontologyRes, sessionRes] = await Promise.all([
    supabase
      .from('sessions_ontology')
      .select('examiner_gap_1, examiner_gap_2, examiner_gap_3, tagger_status, tagger_version, rule_engine_result, ontology_vector')
      .eq('session_id', sessionId)
      .single(),
    supabase
      .from('sessions')
      // Sprint S0: context_text added — needed for S0 trigger (thin-brief detection).
      // Sprint R_JC: user_id for biasHint fetch.
      .select('decision_text, context_text, user_id')
      .eq('id', sessionId)
      .single(),
  ])

  const data         = ontologyRes.data
  const decisionText = decrypt(sessionRes.data?.decision_text) ?? ''
  // Sprint S0: decrypt context_text; null-safe (context_text is optional).
  const contextText  = decrypt(sessionRes.data?.context_text ?? '') ?? ''
  const userId       = (sessionRes.data as { user_id?: string | null } | null)?.user_id ?? null  // Sprint R_JC

  // Sprint R_JC: fetch confirmed distorting bias hint for question sharpening.
  // Lightweight query (bias_library, 1–2 rows). Returns '' for anonymous sessions
  // or users with no confirmed patterns — safe no-op.
  const biasHint = userId ? await fetchExaminerBiasHint(userId) : ''

  if (ontologyRes.error || !data || data.tagger_status !== 'complete') {
    return NextResponse.json({
      questions: null,
      rule_mode: null,
      status:    data?.tagger_status ?? 'not_found',
    })
  }

  if (data.tagger_version === 'v2.0' && data.rule_engine_result) {
    const ruleResult = data.rule_engine_result as {
      mode:            string
      triggered_rules: Array<{ rule_id: string; mode: string; question: string; low_confidence?: boolean }>
      flag_rules:      Array<{ rule_id: string; mode: string; question: string }>
    }

    // Only expose upstream_dependency rationale when R1 specifically fires.
    // R7 (information-first redirect) also sets mode='REDIRECT' but is unrelated
    // to upstream dependency — surfacing upstream_dependency.rationale for R7
    // produces contradictory copy ("no external blocking element" inside a block).
    const redirectRule: string | null =
      ruleResult.mode === 'REDIRECT'
        ? (ruleResult.triggered_rules ?? []).find(r => r.mode === 'REDIRECT')?.rule_id ?? null
        : null

    const upstreamRationale: string | null =
      redirectRule === 'R1' && data.ontology_vector
        ? (data.ontology_vector as Record<string, { rationale?: string }>)
            ?.upstream_dependency?.rationale ?? null
        : null

    // ── S0: Subject Orientation — thin-brief detection ────────────────────────
    // Fires when decision_text is < 25 words AND no context_text was provided.
    // Rationale: a brief decision text gives the Council almost no domain context
    // about the decision subject (e.g. "Should I sell MedML?" tells us nothing
    // about what MedML is). S0 elicits that context directly from the user —
    // better evidence than any web search, and it enters the permanent record.
    //
    // Suppressed on REDIRECT mode (same as C0 — redirect is the whole point there).
    // Not triggered by tagger ambiguity score: ambiguity ≥ 4 captures
    // decision-maker values confusion, not system context deficit — different
    // diagnostic purpose, different question type. Brevity + no-context is the
    // precise trigger for missing domain information.
    const decisionWordCount = decisionText.trim().split(/\s+/).filter(Boolean).length
    const hasContext        = contextText.trim().length > 0
    const shouldAddS0       = decisionWordCount < 25 && !hasContext && ruleResult.mode !== 'REDIRECT'

    // ── Rule slot budget ──────────────────────────────────────────────────────
    // Max 3 questions total (reduced from 4). Budget:
    //   S0 fires → 1 rule slot + S0 + C0 = 3
    //   S0 absent → 2 rule slots + C0    = 3
    // C0 is never displaced — it feeds fetchUserPrinciplesBlock() longitudinally
    // (KDD 121) and anchors success definition for synthesis.
    const ruleSlotBudget = shouldAddS0 ? 1 : 2
    const allRules = [
      ...(ruleResult.triggered_rules ?? []),
      ...(ruleResult.flag_rules ?? []),
    ].slice(0, ruleSlotBudget)

    // ── Early exit — only when neither rules nor S0 would surface anything ────
    // Previously: exit when allRules.length === 0 (simple decisions → no questions).
    // Now: also allow S0 to surface on zero-rule sessions where the brief is thin.
    if (allRules.length === 0 && !shouldAddS0) {
      return NextResponse.json({ questions: [], rule_mode: 'OPEN', status: 'no_rules' })
    }

    // ── Template selection — deterministic per sessionId ──────────────────────
    // pickTemplate() hashes sessionId to an index into each bank.
    // S0 and C0 index separate banks — no structural overlap between them.
    const s0Template  = pickTemplate(S0_TEMPLATES, sessionId)
    const c0Template  = pickTemplate(C0_TEMPLATES, sessionId)
    const shouldAddC0 = ruleResult.mode !== 'REDIRECT'

    // ── Parallel personalisation — all AI calls in a single Promise.all ───────
    // Rule questions, S0, and C0 personalise concurrently (no sequential deps).
    // S0 does NOT receive biasHint — it is domain-context gathering, not a
    // diagnostic probe; bias sharpening is inappropriate there.
    // C0 receives biasHint as before (Sprint R_JC).
    const [personalisedRuleTexts, s0Text, c0Text] = await Promise.all([
      decisionText
        ? Promise.all(
            allRules.map(rule =>
              personaliseRuleQuestion(rule.rule_id, rule.question, decisionText, biasHint)
            )
          )
        : Promise.resolve(allRules.map(r => r.question)),

      shouldAddS0 && decisionText
        ? personaliseRuleQuestion('S0', s0Template, decisionText)   // no biasHint
        : Promise.resolve(s0Template),

      shouldAddC0 && decisionText
        ? personaliseRuleQuestion('C0', c0Template, decisionText, biasHint)
        : Promise.resolve(c0Template),
    ])

    // ── Question assembly: rule questions → S0 → C0 ──────────────────────────
    // Order rationale:
    //   Rules first  — structural flags the system raised (decision-specific)
    //   S0 second    — orient us on the domain subject
    //   C0 last      — reflective close: what does success look like here?
    const questions: Array<{ order: number; text: string; gap: string; rule_id: string | null }> = []

    allRules.forEach((rule, i) => {
      questions.push({
        order:   questions.length + 1,
        text:    personalisedRuleTexts[i],
        gap:     `${rule.rule_id} — ${rule.mode}`,
        rule_id: rule.rule_id,
      })
    })

    if (shouldAddS0) {
      questions.push({
        order:   questions.length + 1,
        text:    s0Text,
        gap:     'S0 — ORIENTATION',
        rule_id: 'S0',
      })
    }

    if (shouldAddC0) {
      questions.push({
        order:   questions.length + 1,
        text:    c0Text,
        gap:     'C0 — CONTEXT',
        rule_id: 'C0',
      })
    }

    console.log(
      `[Examiner GET] v2.0 | session ${sessionId} | mode: ${ruleResult.mode} | ` +
      `questions: ${questions.map(q => q.rule_id).join(',')} | ` +
      `s0: ${shouldAddS0} (${decisionWordCount}w, ctx:${hasContext})`
    )

    return NextResponse.json({
      questions,
      rule_mode:          ruleResult.mode,
      redirect_rule:      redirectRule,       // 'R1' | 'R7' | null — used by UI to select correct banner copy
      upstream_rationale: upstreamRationale,  // only populated for R1; null for R7
      status:             'ready',
    })
  }

  // ── v1.0 fallback — gap-based question generation (unchanged) ──────────────
  const gaps = [data.examiner_gap_1, data.examiner_gap_2, data.examiner_gap_3]
    .filter(Boolean) as string[]

  if (gaps.length === 0) {
    return NextResponse.json({ questions: [], rule_mode: null, status: 'no_gaps' })
  }

  const questionTexts = await generateGapQuestions(gaps)
  const questions = questionTexts.map((text, i) => ({
    order:   i + 1,
    text,
    gap:     gaps[i] ?? '',
    rule_id: null,
  }))

  return NextResponse.json({ questions, rule_mode: null, status: 'ready' })
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — save examiner responses + fire downstream scoring (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

type ExaminerResponseRow = {
  question_text:       string
  response_text:       string | null
  question_order:      number
  unknown_unknown_gap: string
  rule_id:             string | null
}

export async function POST(req: Request) {
  // S5-01: rate limit examiner calls — 40 per 10 min per IP
  const rlResult = checkLimit(getClientIP(req), LIMITS.examiner)
  if (!rlResult.allowed) return tooManyRequests(rlResult, 'analysis requests')

  try {
    const body = await req.json()

    const { sessionId, responses, skipped } = body as {
      sessionId:  string
      responses?: ExaminerResponseRow[]
      skipped?:   boolean
    }

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // ── Skipped path ──────────────────────────────────────────────────────────
    if (skipped) {
      await supabase
        .from('sessions_ontology')
        .update({ examiner_status: 'submitted' })
        .eq('session_id', sessionId)

      // Sprint D1: stamp last_action_at — user engaged (even via skip)
      stampLastActionAt(sessionId, supabase).catch(err =>
        console.error('[Examiner POST] last_action_at stamp (skip) error:', err)
      )

      // Still trigger bias scoring on skip — personas + ontology are enough
      fireBiasScore(sessionId, req).catch(err =>
        console.error('[Examiner POST] Bias trigger (skip) error:', err)
      )
      fireIndependenceScore(sessionId, req).catch(err =>
        console.error('[Examiner POST] Independence trigger (skip) error:', err)
      )
      fireContradictions(sessionId, req).catch(err =>
        console.error('[Examiner POST] Contradictions trigger (skip) error:', err)
      )

      return NextResponse.json({ ok: true })
    }

    if (!responses?.length) {
      return NextResponse.json({ error: 'responses required' }, { status: 400 })
    }

    // ── Save examiner_responses ───────────────────────────────────────────────
    // S0 responses stored with rule_id = 'S0' — distinguishable from rule
    // questions and C0 for any future longitudinal use (e.g. domain context
    // accumulation across sessions). question_text + response_text encrypted
    // at rest per the Security Sprint (June 2, 2026).
    const rows = responses.map(r => ({
      session_id:           sessionId,
      question_text:        encrypt(r.question_text),
      response_text:        encrypt(r.response_text),
      question_order:       r.question_order,
      unknown_unknown_gap:  r.unknown_unknown_gap,
      bias_parameter_probed: null,
      rule_id:              r.rule_id ?? null,
    }))

    const { error: insertError } = await supabase.from('examiner_responses').insert(rows)
    if (insertError) {
      console.error('[Examiner POST] examiner_responses insert failed:', insertError)
      return NextResponse.json({ error: 'Failed to save responses' }, { status: 500 })
    }

    // ── Update examiner status ────────────────────────────────────────────────
    await supabase
      .from('sessions_ontology')
      .update({ examiner_status: 'submitted' })
      .eq('session_id', sessionId)

    // Sprint D1: stamp last_action_at — examiner submit is the primary
    // activity signal for avoidance detection. NOT created_at: a session
    // submitted 60 days ago but worked on 3 days ago is not avoidance.
    stampLastActionAt(sessionId, supabase).catch(err =>
      console.error('[Examiner POST] last_action_at stamp error:', err)
    )

    // ── Trigger bias scoring via dedicated endpoint (non-blocking) ────────────
    fireBiasScore(sessionId, req).catch(err =>
      console.error('[Examiner POST] Bias trigger error:', err)
    )
    fireIndependenceScore(sessionId, req).catch(err =>
      console.error('[Examiner POST] Independence trigger error:', err)
    )
    fireContradictions(sessionId, req).catch(err =>
      console.error('[Examiner POST] Contradictions trigger error:', err)
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[Examiner POST] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

/**
 * Sprint D1 — stamp sessions.last_action_at = now().
 * Called fire-and-forget from examiner POST (submit + skip paths).
 * Non-fatal: logs on error, never throws to caller.
 * The D2 avoidance detector uses COALESCE(last_action_at, created_at)
 * so a missed stamp degrades gracefully to created_at semantics.
 */
async function stampLastActionAt(
  sessionId: string,
  supabase:  ReturnType<typeof createServiceClient>,
): Promise<void> {
  const { error } = await supabase
    .from('sessions')
    .update({ last_action_at: new Date().toISOString() })
    .eq('id', sessionId)

  if (error) {
    console.error(`[Examiner POST] last_action_at stamp failed for session ${sessionId}:`, error)
  }
}

/**
 * /api/bias-score owns all bias_library accumulation logic — schema-correct,
 * handles identity resolution (user_id → user_email → device_id → anonymous).
 * Derives base URL from the incoming request so it works across envs.
 */
async function fireBiasScore(sessionId: string, req: Request): Promise<void> {
  // Use localhost to avoid SSL termination errors on Railway self-calls.
  // Railway exposes PORT (default 8080); INTERNAL_API_URL overrides for other envs.
  const port = process.env.PORT ?? '8080'
  const base = process.env.INTERNAL_API_URL ?? `http://localhost:${port}`
  const internalSecret = process.env.INTERNAL_API_SECRET ?? ''
  const res = await fetch(`${base}/api/bias-score`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': internalSecret },
    body:    JSON.stringify({ sessionId }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[Examiner POST] /api/bias-score returned ${res.status}:`, body)
  } else {
    console.log(`[Examiner POST] Bias score triggered for session ${sessionId}`)
  }
}

/**
 * Fire-and-forget HTTP call to /api/mirror/independence.
 * Recalculates Decision Independence Score for the session owner.
 * Upserts one row per session_id — idempotent, safe to call every submit.
 * No-ops silently if session has no user_id (anonymous session).
 */
async function fireIndependenceScore(sessionId: string, _req: Request): Promise<void> {
  const port = process.env.PORT ?? '8080'
  const base = process.env.INTERNAL_API_URL ?? `http://localhost:${port}`
  const res = await fetch(`${base}/api/mirror/independence`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ sessionId }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[Examiner POST] /api/mirror/independence returned ${res.status}:`, body)
  } else {
    console.log(`[Examiner POST] Independence score triggered for session ${sessionId}`)
  }
}

/**
 * Fire-and-forget HTTP call to /api/mirror/contradictions.
 * Runs two-pass contradiction detection pipeline if ≥5 sessions with evidence
 * AND last run was >7 days ago (RERUN_DAYS_THRESHOLD inside the route).
 * The 7-day throttle is intentional — the AI pipeline is expensive and
 * contradictions do not change meaningfully session-to-session.
 * No-ops silently if session has no user_id (anonymous session).
 */
async function fireContradictions(sessionId: string, _req: Request): Promise<void> {
  const port = process.env.PORT ?? '8080'
  const base = process.env.INTERNAL_API_URL ?? `http://localhost:${port}`
  const res = await fetch(`${base}/api/mirror/contradictions`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ sessionId }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[Examiner POST] /api/mirror/contradictions returned ${res.status}:`, body)
  } else {
    console.log(`[Examiner POST] Contradictions triggered for session ${sessionId}`)
  }
}