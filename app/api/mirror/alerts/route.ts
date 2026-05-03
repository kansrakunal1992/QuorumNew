// app/api/mirror/alerts/route.ts
// ── Mirror Module: Behavioral Alerts Route (Sprint 7d — fixed) ───────────────
//
// Copilot fix (correct): reads actual stored JSONB shape { [sessionId]: { ... } }
// instead of the assumed shape { decision_type: [], pressure_type: [] } that
// was never actually stored.
//
// Additional tightening vs Copilot version:
//   - Removed broad `counterparty_present` expansion ('partner', 'family',
//     'stakeholder', 'spouse') — these match every relational decision and were
//     the reason non-relational biases like exit_optionality_mispricing were
//     triggering on decisions that mentioned any co-founder/partner context.
//   - Removed `urgency_present` expansion from non-urgency biases — urgency
//     keywords like 'deadline', 'urgent' are only useful for fomo_urgency and
//     speed_bias, not for bias parameters that happen to co-occur with urgency.
//   - Kept extractReasoningKeywords: phrases pulled from actual reasoning text
//     are the most grounded and specific keywords we have.
//   - `decision_type` and `emotional_signature` are kept — they're stored per
//     session and are meaningful activation signals.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }         from 'next/server'
import { createServiceClient }   from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { BIAS_PARAMETERS }       from '@/lib/bias-scorer'

// ── Bias label lookup ─────────────────────────────────────────────────────────

function getBiasLabel(key: string): string {
  const found = BIAS_PARAMETERS.find(b => b.key === key)
  if (found) return found.label
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ── Urgency-specific bias keys ────────────────────────────────────────────────
//
// Only add urgency keywords for biases where urgency is a genuine activation
// signal (not just a co-occurring condition). Prevents exit_optionality from
// matching every decision that mentions a deadline.

const URGENCY_BIASES = new Set(['fomo_urgency', 'speed_bias', 'manufactured_urgency'])

// ── Reasoning phrase extraction ───────────────────────────────────────────────
//
// Pull specific, multi-word phrases from the AI's reasoning text for this bias.
// These are the most grounded keywords — they come from the actual content the
// model identified as evidence of the bias firing.
//
// Minimum phrase length = 6 chars to avoid trivially short matches.
// Only exact phrases (not regex) to avoid false positives.

function extractReasoningKeywords(reasoning: string): string[] {
  const text   = reasoning.toLowerCase()
  const found  = new Set<string>()

  const candidates = [
    // Exit / reversal
    'exit plan', 'exit terms', 'reversal plan', 'return path', 'fallback plan',
    're-entry', 'walkaway', 'walk away', 'buyback', 'buyout',
    'vesting schedule', 'lock-in period', 'lock in', 'lockup',

    // Hidden complexity
    'hidden dependency', 'hidden dependencies', 'unknown unknowns',
    'not fully modeled', 'not fully modelled', 'risk cascade',
    'unmodelled', 'unmodeled',

    // Relationship / alignment
    'stated support', 'assumed alignment', 'unspoken assumptions',
    'buy-in not confirmed', 'untested assumption',

    // Urgency
    'manufactured urgency', 'artificial deadline', 'self-imposed deadline',
    'price appreciation', 'missing gains',

    // Recency / anchoring
    'recent appreciation', 'trailing data', 'last 12 months',
    'anchored to recent',

    // Overconfidence / planning
    'optimistic assumption', 'best case assumption', 'planning fallacy',
    'underestimated downside',

    // Control
    'outside your control', 'outside control', 'not in your control',
    'active management required',

    // Social
    'social validation', 'others are doing', 'peer pressure',
    'network effect',

    // Complexity / scope
    'scope expansion', 'second-order effects', 'downstream consequences',
    'cascading risk',
  ]

  for (const phrase of candidates) {
    if (text.includes(phrase)) found.add(phrase)
  }

  return Array.from(found)
}

// ── Main keyword extractor ────────────────────────────────────────────────────
//
// Reads the actual stored JSONB shape:
//   { [sessionId]: { reasoning, decision_type, emotional_signature,
//                    urgency_present, counterparty_present, ... } }

function extractKeywords(biasKey: string, activation_contexts: unknown): string[] {
  if (!activation_contexts || typeof activation_contexts !== 'object') return []

  const contexts = activation_contexts as Record<string, unknown>
  const keywords = new Set<string>()

  for (const val of Object.values(contexts)) {
    if (!val || typeof val !== 'object') continue

    const ctx = val as {
      reasoning?:           unknown
      decision_type?:       unknown
      emotional_signature?: unknown
      urgency_present?:     unknown
    }

    // decision_type: e.g. "financial", "career", "operational"
    if (typeof ctx.decision_type === 'string' && ctx.decision_type.length >= 5) {
      keywords.add(ctx.decision_type.toLowerCase().replace(/_/g, ' '))
    }

    // emotional_signature: e.g. "anxiety", "excitement", "pressure"
    if (typeof ctx.emotional_signature === 'string' && ctx.emotional_signature.length >= 5) {
      keywords.add(ctx.emotional_signature.toLowerCase().replace(/_/g, ' '))
    }

    // urgency signals — ONLY for urgency-related biases
    if (ctx.urgency_present === true && URGENCY_BIASES.has(biasKey)) {
      keywords.add('urgency')
      keywords.add('deadline')
      keywords.add('time pressure')
    }

    // reasoning phrases — always, for all biases (most specific signal)
    if (typeof ctx.reasoning === 'string') {
      for (const kw of extractReasoningKeywords(ctx.reasoning)) {
        keywords.add(kw)
      }
    }
  }

  return Array.from(keywords)
    .filter(kw => kw.length >= 5)   // minimum 5 chars — removes 'loss', 'fund'
    .slice(0, 25)                    // cap per bias
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ alerts: [] })
  }

  const token = authHeader.slice(7)
  let userId: string | null = null

  try {
    const anonClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
    const { data: { user } } = await anonClient.auth.getUser(token)
    userId = user?.id ?? null
  } catch {
    return NextResponse.json({ alerts: [] })
  }

  if (!userId) return NextResponse.json({ alerts: [] })

  const supabase = createServiceClient()

  const { data: biasRows } = await supabase
    .from('bias_library')
    .select('bias_parameter, detection_count, activation_contexts')
    .eq('user_id', userId)
    .gte('detection_count', 2)
    .order('detection_count', { ascending: false })
    .limit(8)

  if (!biasRows || biasRows.length === 0) {
    return NextResponse.json({ alerts: [] })
  }

  const alerts = biasRows.map(row => ({
    biasKey:            row.bias_parameter,
    biasLabel:          getBiasLabel(row.bias_parameter),
    detectionCount:     row.detection_count,
    activationKeywords: extractKeywords(row.bias_parameter, row.activation_contexts),
  }))

  return NextResponse.json({ alerts })
}
