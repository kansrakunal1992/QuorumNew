// app/api/mirror/alerts/route.ts
// ── Mirror Module: Behavioral Alerts Route (Sprint 7d) ────────────────────────
//
// GET /api/mirror/alerts
//
// Auth-gated: requires valid Bearer token (user_id)
// Does NOT require mirror_access — alerts are shown on the home page
// before paywall, to create pull toward Mirror unlock.
//
// Returns confirmed bias patterns (detection_count >= 2) with their
// activation_contexts so the client can do lightweight keyword matching
// against the user's typed decision text. No AI call; pure DB read.
//
// Shape returned:
//   { alerts: AlertBias[] }
//
// AlertBias:
//   { biasKey, biasLabel, detectionCount, activationKeywords: string[] }
//

// activationKeywords is derived from activation_contexts JSONB by
// reading the real session-level activation evidence stored by bias-score.
// The client checks if any of these appear in the decision text.

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


// ── Extract activation_contexts JSONB → keyword array ────────────────────────
//
// Actual activation_contexts shape stored by /api/bias-score:
// {
//   [sessionId]: {
//     reasoning: string,
//     decision_type?: string | null,
//     emotional_signature?: string,
//     urgency_present?: boolean,
//     counterparty_present?: boolean,
//     prosecutor_score?: number,
//     defense_score?: number
//   }
// }
//
// We extract grounded trigger terms only from the user's real historical
// activation evidence. No generic bias-level fallback map.

function normaliseKeyword(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .trim()
}

function addKeyword(keywords: Set<string>, value: unknown) {
  if (typeof value !== 'string') return

  const cleaned = normaliseKeyword(value)
  if (!cleaned) return

  keywords.add(cleaned)

  // Preserve raw underscore form too, in case future input contains it.
  const raw = value.toLowerCase().trim()
  if (raw && raw !== cleaned) keywords.add(raw)
}

function extractReasoningKeywords(reasoning: string): string[] {
  const text = reasoning.toLowerCase()
  const found = new Set<string>()

  const phraseCandidates = [
    'exit plan',
    'exit terms',
    'reversal plan',
    'return path',
    'fallback',
    'backup plan',
    're-entry',
    'walkaway',
    'walk away',
    'buyback',
    'buyout',
    'vesting',
    'lock-in',
    'lock in',

    'hidden dependency',
    'hidden dependencies',
    'unknowns',
    'unknown unknowns',
    'unmodelled',
    'unmodeled',
    'not fully modeled',
    'not fully modelled',
    'risk cascade',
    'complexity',

    'control',
    'active management',
    'outside control',
    'prevent',
    'manage',
    'discipline',

    'stated support',
    'support',
    'buy-in',
    'commitment',
    'alignment',
    'unspoken assumptions',
    'spouse',
    'co-founder',
    'partner',
    'family',

    'deadline',
    'urgency',
    'urgent',
    'delay',
    'price appreciation',
    'missing gains',
    'opportunity',
    'upside',

    'recent appreciation',
    'trailing data',
    'last 12 months',
    'recent',
    'latest',

    'stable job',
    'stability',
    'downside',
    'loss',
  ]

  for (const phrase of phraseCandidates) {
    if (text.includes(phrase)) {
      found.add(phrase)
    }
  }

  return Array.from(found)
}

function extractKeywords(activation_contexts: unknown): string[] {
  if (!activation_contexts || typeof activation_contexts !== 'object') return []
  const contexts = activation_contexts as Record<string, unknown>
  const keywords = new Set<string>()

  for (const val of Object.values(contexts)) {
    
  if (!val || typeof val !== 'object') continue
  
      const ctx = val as {
        reasoning?: unknown
        decision_type?: unknown
        emotional_signature?: unknown
        urgency_present?: unknown
        counterparty_present?: unknown
      }
  
      addKeyword(keywords, ctx.decision_type)
      addKeyword(keywords, ctx.emotional_signature)
  
      if (ctx.urgency_present === true) {
        keywords.add('urgent')
        keywords.add('urgency')
        keywords.add('deadline')
        keywords.add('delay')
        keywords.add('time pressure')
      }
  
      if (ctx.counterparty_present === true) {
        keywords.add('counterparty')
        keywords.add('partner')
        keywords.add('co-founder')
        keywords.add('spouse')
        keywords.add('family')
        keywords.add('stakeholder')
      }
  
      if (typeof ctx.reasoning === 'string') {
        for (const kw of extractReasoningKeywords(ctx.reasoning)) {
          keywords.add(kw)
        }
    }
  }

  return Array.from(keywords) 
  .filter(kw => kw.length >= 3)
  .slice(0, 30)
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  // ── 1. Resolve user_id from Bearer token ──────────────────────────────────
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

  if (!userId) {
    return NextResponse.json({ alerts: [] })
  }

  // ── 2. Fetch confirmed bias patterns ──────────────────────────────────────
  const supabase = createServiceClient()

  const { data: biasRows } = await supabase
    .from('bias_library')
    .select('bias_parameter, detection_count, activation_contexts')
    .eq('user_id', userId)
    .gte('detection_count', 2)              // confirmed only
    .order('detection_count', { ascending: false })
    .limit(8)                              // cap — client only shows 1 at a time anyway

  if (!biasRows || biasRows.length === 0) {
    return NextResponse.json({ alerts: [] })
  }

  // ── 3. Shape response ─────────────────────────────────────────────────────
  const alerts = biasRows.map(row => ({
    biasKey:            row.bias_parameter,
    biasLabel:          getBiasLabel(row.bias_parameter),
    detectionCount:     row.detection_count,
    activationKeywords: extractKeywords(row.activation_contexts),
  }))

  return NextResponse.json({ alerts })
}
