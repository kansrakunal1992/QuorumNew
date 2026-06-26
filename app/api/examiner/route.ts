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

// ─────────────────────────────────────────────────────────────────────────────
// SB-2: Full-generation question functions
// All three (S0, E0, redirect) are generated fresh per session from the
// decision text + user profile. No template reuse — every question is unique.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S0 — Subject Orientation. Full generation; no template bank.
 * Asks the single most load-bearing unspecified thing in the brief.
 * Passes profile context (archetype + risk_stance) when available.
 */
async function generateS0Question(
  decision:    string,
  profileCtx?: string,   // e.g. "Protector archetype, conservative risk stance"
): Promise<string> {
  const FALLBACK = "Walk us through the situation: what is this, where things stand operationally, and what's making this the moment to decide?"
  const prompt = `You are a senior advisor who has just read a decision brief from a high-stakes decision-maker.

Your task: ask the ONE follow-up question you would ask if meeting this person 1:1 — the most important thing that is under-specified, assumed, or load-bearing for how this decision should be approached.

RULES:
- Do NOT ask them to summarise the whole situation or explain everything
- Ask about the one specific thing most critical for understanding this correctly
- Peer register — not an interviewer or a consultant, a trusted advisor
- Maximum 25 words
- Return ONLY the question — no quotes, no explanation, no preamble
${profileCtx ? `\nUSER CONTEXT: ${profileCtx}. Let this subtly shape what angle matters most, but stay anchored to what the brief actually contains.\n` : ''}
DECISION BRIEF: "${decision.slice(0, 450)}"

QUESTION:`.trim()

  try {
    const raw   = await createCompletion(prompt, 80, { provider: 'deepseek' })
    const clean = raw.trim().replace(/^["']|["']$/g, '').trim()
    if (!clean || clean.split(' ').length > 40) return FALLBACK
    return clean
  } catch (err) {
    console.error('[Examiner SB-2] generateS0Question failed:', err)
    return FALLBACK
  }
}

/**
 * E0 — Emotional/Gut question. Always fires (non-REDIRECT). Full generation.
 * Surfaces the emotional or identity dimension NOT explicitly named in the brief.
 * Uses fear profile (if available) and inferred dominant_emotion to sharpen.
 */
async function generateE0Question(
  decision:       string,
  fearProfile?:   string,   // e.g. "fear of loss, fear of judgment"
  dominantEmotion?: string, // e.g. "anxiety"
  biasHint?:      string,
): Promise<string> {
  const FALLBACK = "What's the part of this you haven't said out loud yet — even to yourself?"
  const prompt = `You are the Quorum Examiner. Read this decision brief carefully.

Your task: generate ONE question that surfaces the emotional or identity dimension this person has NOT explicitly named — the thing present in what they wrote but not said directly.

This is NOT a clarifying question about facts or next steps.
It is a question that requires the person to look inward — at what they fear, what they're protecting, or what this decision means about who they are.

RULES:
- Must be specific to THIS brief — not a generic "how do you feel about this?"
- Should make the person pause. The right question cannot be answered in 5 seconds.
- Peer register — trusted mentor, not therapist, not coach
- Maximum 25 words
- Return ONLY the question — no quotes, no explanation, no preamble
${fearProfile ? `\nUSER FEAR PROFILE (self-identified): ${fearProfile}. Sharpen the question toward the most active fear visible in the brief.\n` : ''}${dominantEmotion && dominantEmotion !== 'ambivalence' ? `\nINFERRED EMOTIONAL TONE: ${dominantEmotion}.\n` : ''}${biasHint ? `\nUSER PATTERN CONTEXT (prior decisions): ${biasHint}.\n` : ''}
DECISION BRIEF: "${decision.slice(0, 450)}"

QUESTION:`.trim()

  try {
    const raw   = await createCompletion(prompt, 80, { provider: 'anthropic' })
    const clean = raw.trim().replace(/^["']|["']$/g, '').trim()
    if (!clean || clean.split(' ').length > 40) return FALLBACK
    return clean
  } catch (err) {
    console.error('[Examiner SB-2] generateE0Question failed:', err)
    return FALLBACK
  }
}

/**
 * Redirect question — generated for both R1 and R7 REDIRECT modes.
 * Tells the user exactly what they need to resolve before the Council can run cleanly.
 * Replaces the static banner title as the primary call-to-action.
 */
async function generateRedirectQuestion(
  decision:  string,
  rule:      'R1' | 'R7',
  rationale?: string,
): Promise<string> {
  const FALLBACK_R1 = "What is the upstream decision or event that must resolve before this one becomes yours to make?"
  const FALLBACK_R7 = "What specific information — that doesn't yet exist — would materially change which option is right?"

  const prompt = rule === 'R1'
    ? `A decision has been flagged because it has an upstream dependency that must be resolved first.

Generate ONE specific question that tells this person exactly what they need to resolve before this decision can be properly assessed. Name the specific blocking element — not a generic "what depends on this."

Maximum 25 words. Return ONLY the question — no quotes, no preamble.
${rationale ? `\nBLOCKING CONTEXT: ${rationale}` : ''}
DECISION BRIEF: "${decision.slice(0, 450)}"

QUESTION:`
    : `A decision has been flagged because specific information that doesn't exist yet would materially change the outcome.

Generate ONE specific question naming exactly what information this person needs to gather before this decision can be cleanly assessed.

Maximum 25 words. Return ONLY the question — no quotes, no preamble.
DECISION BRIEF: "${decision.slice(0, 450)}"

QUESTION:`

  try {
    const raw   = await createCompletion(prompt.trim(), 80, { provider: 'deepseek' })
    const clean = raw.trim().replace(/^["']|["']$/g, '').trim()
    if (!clean || clean.split(' ').length > 40) return rule === 'R1' ? FALLBACK_R1 : FALLBACK_R7
    return clean
  } catch (err) {
    console.error(`[Examiner SB-2] generateRedirectQuestion(${rule}) failed:`, err)
    return rule === 'R1' ? FALLBACK_R1 : FALLBACK_R7
  }
}

/**
 * C0 — JTBD anchor question bank (5 variants).
 * Each variant probes success definition from a genuinely different vantage:
 *   v1 — outcome + process (original)
 *   v2 — retrospective look-back (three-year frame)
 *   v3 — definitional ("what does 'this went well' actually mean")
 *   v4 — asymmetric cost-benefit (what winning points to + what loss costs)
 *   v5 — hidden intent (what the framing doesn't capture)
 *
 * biasHint + profileCtx passed to C0 personalisation (diagnostic sharpening).
 * Never overlaps with E0 — C0 is forward/outcome-facing, E0 is inward/emotion-facing.
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
const PERSONALISE_PROMPT = (ruleId: string, template: string, decision: string, biasHint?: string, profileCtx?: string) => `
You are the Quorum Examiner. Rewrite the diagnostic question below so it is specific to the decision described.

RULES:
- Keep the core intent identical — do not change what information is being sought
- Replace generic language with concrete details from the decision text (e.g. names, assets, amounts, relationships, domains) wherever they are present
- Maximum 28 words
- Return ONLY the rewritten question — no quotes, no explanation, no preamble
${biasHint ? `\nUSER BIAS PROFILE (confirmed longitudinal patterns from prior decisions): ${biasHint}\nADDITIONAL RULE: If this specific diagnostic question is directly relevant to a documented pattern above, make it harder — sharper and more targeted at that exact blind spot. Otherwise, personalise to the decision text normally.\n` : ''}${profileCtx ? `\nUSER PROFILE: ${profileCtx}. Let this subtly shape the angle of the question where relevant.\n` : ''}
DECISION: "${decision.slice(0, 450)}"

TEMPLATE QUESTION (${ruleId}): "${template}"

REWRITTEN QUESTION:`.trim()

async function personaliseRuleQuestion(
  ruleId:     string,
  template:   string,
  decision:   string,
  biasHint?:  string,  // Sprint R_JC
  profileCtx?: string, // SB-2: profile context for C0 sharpening
): Promise<string> {
  try {
    const raw   = await createCompletion(PERSONALISE_PROMPT(ruleId, template, decision, biasHint, profileCtx), 80, { provider: 'deepseek' })
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
      // SB-2: user_email added for profile fallback when user_id is null
      .select('decision_text, context_text, user_id, user_email')
      .eq('id', sessionId)
      .single(),
  ])

  const data         = ontologyRes.data
  const decisionText = decrypt(sessionRes.data?.decision_text) ?? ''
  const contextText  = decrypt(sessionRes.data?.context_text ?? '') ?? ''
  const userId       = (sessionRes.data as { user_id?: string | null } | null)?.user_id ?? null

  // Sprint R_JC: fetch confirmed distorting bias hint for question sharpening.
  const biasHint = userId ? await fetchExaminerBiasHint(userId) : ''

  // SB-2: fetch user profile for E0 fear context + S0/C0 profile awareness
  let fearProfile:   string | null = null
  let profileCtx:    string | null = null
  let dominantEmotion: string | null = null
  if (userId) {
    const [profileRes, ontologyFullRes] = await Promise.all([
      supabase.from('user_profiles').select('archetype, primary_fears, risk_stance, life_stage').eq('user_id', userId).single(),
      supabase.from('sessions_ontology').select('dominant_emotion').eq('session_id', sessionId).maybeSingle(),
    ])
    const profile = profileRes.data
    if (profile) {
      if (profile.primary_fears?.length) {
        fearProfile = profile.primary_fears.join(', ')
      }
      const parts: string[] = []
      if (profile.archetype)   parts.push(`${profile.archetype} archetype`)
      if (profile.risk_stance) parts.push(`${profile.risk_stance} risk stance`)
      if (profile.life_stage)  parts.push(`${profile.life_stage} stage`)
      if (parts.length) profileCtx = parts.join(', ')
    }
    dominantEmotion = ontologyFullRes?.data?.dominant_emotion ?? null
  }

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

    // ── SB-2: S0 trigger — thin brief only (context paste no longer suppresses) ─
    // S0 and context_text serve different purposes:
    //   context_text = background material the user pasted in (emails, term sheets)
    //   S0           = a deepening question about what the brief itself doesn't say
    // Previously suppressing S0 when context was present assumed they were equivalent.
    // They are not. S0 now fires purely on word count < 25 words, regardless of context.
    //
    // Suppressed in REDIRECT mode (redirect IS the message in that case).
    const decisionWordCount = decisionText.trim().split(/\s+/).filter(Boolean).length
    const shouldAddS0       = decisionWordCount < 25 && ruleResult.mode !== 'REDIRECT'

    // ── SB-2: Slot budget ─────────────────────────────────────────────────────
    // Max 3 questions total. New budget:
    //   Slot 1: E0  — always (emotional/inward question), non-REDIRECT only
    //   Slot 2: S0  — if brief < 25 words (takes priority over rule slot)
    //           OR 1 rule question — if S0 doesn't fire and rules exist
    //   Slot 3: C0  — always, non-REDIRECT only
    //
    // Previous budget (2 rule slots) is replaced. Rule questions compete for
    // slot 2 only when S0 doesn't fire. Maximum 1 rule question per session.
    const shouldAddE0 = ruleResult.mode !== 'REDIRECT'
    const shouldAddC0 = ruleResult.mode !== 'REDIRECT'

    // Rule slot: 1 max, only when S0 is not firing
    const ruleForSlot2 = !shouldAddS0
      ? [...(ruleResult.triggered_rules ?? []), ...(ruleResult.flag_rules ?? [])].slice(0, 1)
      : []

    // ── Early exit — only when no questions would fire at all ────────────────
    // E0 + C0 always fire on non-REDIRECT, so this only applies to REDIRECT with
    // no questions (which generates its redirect question instead of normal flow).
    if (ruleResult.mode === 'REDIRECT') {
      // REDIRECT: generate an exact resolution question and return immediately.
      // The UI (ExaminerPanel) renders questions[0].text as the call-to-action
      // in the REDIRECT banner — so we slot the generated question there.
      const redirectQ = await generateRedirectQuestion(
        decisionText,
        (redirectRule ?? 'R1') as 'R1' | 'R7',
        upstreamRationale ?? undefined,
      )
      return NextResponse.json({
        questions:          [{ order: 1, text: redirectQ, gap: `${redirectRule} — REDIRECT`, rule_id: redirectRule }],
        rule_mode:          'REDIRECT',
        redirect_rule:      redirectRule,
        upstream_rationale: upstreamRationale,
        status:             'ready',
      })
    }

    // ── Parallel generation — E0, S0/rule, C0 all concurrent ─────────────────
    // E0: full generation (anthropic — better at emotional/identity questions)
    // S0: full generation (deepseek — domain grounding question)
    // Rule: template + personalise (deepseek — structural diagnostic)
    // C0: template + personalise with bias + profile context (deepseek)
    const [e0Text, s0OrRuleTexts, c0Text] = await Promise.all([
      // Slot 1: E0 — always generated fresh
      decisionText
        ? generateE0Question(decisionText, fearProfile ?? undefined, dominantEmotion ?? undefined, biasHint || undefined)
        : Promise.resolve("What's the part of this you haven't said out loud yet — even to yourself?"),

      // Slot 2: S0 (generated) or rule question (personalised), mutually exclusive
      shouldAddS0 && decisionText
        ? generateS0Question(decisionText, profileCtx ?? undefined).then(q => [q])
        : ruleForSlot2.length > 0 && decisionText
          ? Promise.all(ruleForSlot2.map(r => personaliseRuleQuestion(r.rule_id, r.question, decisionText, biasHint || undefined)))
          : Promise.resolve([] as string[]),

      // Slot 3: C0 — always, now receives profileCtx for sharper personalisation
      decisionText
        ? personaliseRuleQuestion('C0', pickTemplate(C0_TEMPLATES, sessionId), decisionText, biasHint || undefined, profileCtx ?? undefined)
        : Promise.resolve(pickTemplate(C0_TEMPLATES, sessionId)),
    ])

    // ── Question assembly: E0 → S0 or rule → C0 ──────────────────────────────
    // Order rationale:
    //   E0 first  — inward/emotional question sets reflective tone before analysis
    //   S0/rule   — domain grounding (S0) or structural flag (rule)
    //   C0 last   — reflective close: what does success look like here?
    const questions: Array<{ order: number; text: string; gap: string; rule_id: string | null }> = []

    // E0 — slot 1, always
    questions.push({
      order:   1,
      text:    e0Text,
      gap:     'E0 — EMOTIONAL',
      rule_id: 'E0',
    })

    // S0 or rule — slot 2, conditional
    if (shouldAddS0 && s0OrRuleTexts.length > 0) {
      questions.push({
        order:   2,
        text:    s0OrRuleTexts[0],
        gap:     'S0 — ORIENTATION',
        rule_id: 'S0',
      })
    } else if (ruleForSlot2.length > 0 && s0OrRuleTexts.length > 0) {
      questions.push({
        order:   2,
        text:    s0OrRuleTexts[0],
        gap:     `${ruleForSlot2[0].rule_id} — ${ruleForSlot2[0].mode}`,
        rule_id: ruleForSlot2[0].rule_id,
      })
    }

    // C0 — slot 3, always
    if (shouldAddC0) {
      questions.push({
        order:   questions.length + 1,
        text:    c0Text,
        gap:     'C0 — CONTEXT',
        rule_id: 'C0',
      })
    }

    console.log(
      `[Examiner GET] SB-2 v2.0 | session ${sessionId} | mode: ${ruleResult.mode} | ` +
      `questions: ${questions.map(q => q.rule_id).join(',')} | ` +
      `s0: ${shouldAddS0} (${decisionWordCount}w) | profile: ${!!profileCtx} | fears: ${!!fearProfile}`
    )

    return NextResponse.json({
      questions,
      rule_mode:          ruleResult.mode,
      redirect_rule:      null,
      upstream_rationale: null,
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