// app/api/mirror/alerts/fallback/route.ts
// ── Mirror Module: Home-Screen Bias Alert — LLM Fallback (Sprint CX2 #5) ─────
//
// Called by BehaviorAlerts.tsx only when the static Layer 1 / Layer 2 phrase
// match found nothing for the current decision draft. Catches paraphrased
// bias language the phrase library doesn't have an exact string for.
//
// Hard constraints (per sign-off):
//   - PERSONALIZED ONLY. The model is only ever shown the bias keys this
//     specific user already has in bias_library with detection_count >= 2 —
//     the exact same set /api/mirror/alerts already returns. It can never
//     introduce a bias label the user hasn't already confirmed via Examiner.
//   - Per-user daily cap (BIAS_FALLBACK_DAILY_CAP, default 12) to bound
//     DeepSeek spend on a screen that's otherwise zero marginal cost.
//   - Zero user-facing failure modes. Any error, timeout, or cap-hit returns
//     { alert: null } with a 200 — never a thrown error the client has to
//     branch on. Hard 6s timeout so a slow DeepSeek response can never hang
//     the UI longer than the existing 800ms debounce + a beat.
//   - Every hit is logged to bias_alert_log (encrypted) for future phrase-
//     library audits — same table layer1/layer2 hits log to.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }      from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createCompletion }  from '@/lib/ai-client'
import { BIAS_PARAMETERS }   from '@/lib/bias-scorer'
import { getMirrorAccessState } from '@/lib/mirror-access'
import { encrypt }           from '@/lib/encryption'

const DAILY_CAP   = parseInt(process.env.BIAS_FALLBACK_DAILY_CAP ?? '12', 10)
const TIMEOUT_MS  = 6000
const MIN_WORDS   = 25   // don't bother the model on short, low-signal drafts

function getBiasLabel(key: string): string {
  return BIAS_PARAMETERS.find(b => b.key === key)?.label
    ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function startOfTodayUTC(): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })
}

export async function POST(req: Request) {
  // Never let any failure here surface as a non-200 — the client treats
  // anything other than a clean { alert } shape as "no alert".
  try {
    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ alert: null })
    }

    const body = await req.json().catch(() => null) as { decisionText?: string } | null
    const decisionText = (body?.decisionText ?? '').trim()
    if (decisionText.split(/\s+/).length < MIN_WORDS) {
      return NextResponse.json({ alert: null })
    }

    const token = authHeader.slice(7)
    const anonClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
    const { data: { user } } = await anonClient.auth.getUser(token)
    const userId = user?.id ?? null
    if (!userId) return NextResponse.json({ alert: null })

    const supabase = createServiceClient()

    // Same gate as /api/mirror/alerts — teaser and unlocked both eligible,
    // locked is not.
    const accessState = await getMirrorAccessState(userId, supabase)
    if (accessState === 'locked') return NextResponse.json({ alert: null })
    const accessTier: 'teaser' | 'unlocked' = accessState === 'teaser' ? 'teaser' : 'unlocked'

    // ── Personalization gate: only the user's own confirmed biases ──────────
    const { data: biasRows } = await supabase
      .from('bias_library')
      .select('bias_parameter, detection_count')
      .eq('user_id', userId)
      .gte('detection_count', 2)
      .order('detection_count', { ascending: false })
      .limit(8)

    const confirmedBiases = biasRows ?? []
    if (confirmedBiases.length === 0) return NextResponse.json({ alert: null })

    // ── Daily cap ──────────────────────────────────────────────────────────
    const { count: todayCount } = await supabase
      .from('bias_alert_log')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('source', 'fallback')
      .gte('created_at', startOfTodayUTC())

    if ((todayCount ?? 0) >= DAILY_CAP) return NextResponse.json({ alert: null })

    // ── Build prompt scoped ONLY to this user's confirmed biases ─────────────
    const candidateDefs = confirmedBiases
      .map(row => {
        const def = BIAS_PARAMETERS.find(b => b.key === row.bias_parameter)
        return def ? `- ${def.key}: ${def.definition}` : null
      })
      .filter(Boolean)
      .join('\n')

    const allowedKeys = new Set(confirmedBiases.map(r => r.bias_parameter as string))

    const prompt = `A user is drafting a decision they're about to bring to a council of advisors. Below is a list of cognitive biases that THIS SPECIFIC USER has been confirmed to exhibit in past decisions, with definitions.

${candidateDefs}

Decision draft:
"""
${decisionText.slice(0, 1500)}
"""

Does this draft show evidence of ANY of the biases listed above — and only those listed above? Respond with ONLY raw JSON, no markdown fences, no preamble:
{"biasKey": "<one of the keys above, or null if none clearly apply>", "evidence": "<one sentence, under 20 words, citing the specific language that suggests it>"}`

    let raw: string
    try {
      raw = await withTimeout(
        createCompletion(prompt, 200, { provider: 'deepseek', temperature: 0.1 }),
        TIMEOUT_MS,
      )
    } catch {
      return NextResponse.json({ alert: null })
    }

    let parsed: { biasKey: string | null; evidence?: string }
    try {
      const cleaned = raw.replace(/```json|```/g, '').trim()
      parsed = JSON.parse(cleaned)
    } catch {
      return NextResponse.json({ alert: null })
    }

    if (!parsed.biasKey || !allowedKeys.has(parsed.biasKey)) {
      return NextResponse.json({ alert: null })
    }

    const matchedRow = confirmedBiases.find(r => r.bias_parameter === parsed.biasKey)!
    const evidence = (parsed.evidence ?? '').slice(0, 200)

    // ── Log (encrypted) — same table layer1/layer2 hits log to ──────────────
    const { data: logRow } = await supabase
      .from('bias_alert_log')
      .insert({
        user_id:          userId,
        bias_key:         parsed.biasKey,
        source:           'fallback',
        access_tier:      accessTier,
        decision_snippet: encrypt(decisionText.slice(0, 200)),
        matched_detail:   encrypt(evidence),
      })
      .select('id')
      .single()

    return NextResponse.json({
      alert: {
        biasKey:        parsed.biasKey,
        biasLabel:      getBiasLabel(parsed.biasKey),
        detectionCount: matchedRow.detection_count,
        evidence,
        logId:          logRow?.id ?? null,
      },
    })
  } catch {
    return NextResponse.json({ alert: null })
  }
}
