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
// flattening all values into a single array of lowercase strings.
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

// ── Flatten activation_contexts JSONB → keyword array ────────────────────────
//
// activation_contexts shape (from bias-scorer):
// {
//   decision_type:  ["financial", "career"],
//   pressure_type:  ["time_pressure"],
//   stakeholder:    ["trusted_contact"],
//   emotional_tone: ["anxiety"],
// }
//
// We flatten all values to a unique lowercase keyword list for client matching.

function extractKeywords(activation_contexts: unknown): string[] {
  if (!activation_contexts || typeof activation_contexts !== 'object') return []
  const contexts = activation_contexts as Record<string, unknown>
  const keywords = new Set<string>()

  for (const val of Object.values(contexts)) {
    if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'string') {
          // Normalise: replace underscores with space, lowercase
          // "time_pressure" → "time pressure", "financial" → "financial"
          keywords.add(item.toLowerCase().replace(/_/g, ' '))
          // Also add the raw form so "time_pressure" matches "time_pressure" in text
          keywords.add(item.toLowerCase())
        }
      }
    }
  }

  return Array.from(keywords)
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
