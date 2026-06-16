// app/api/mirror/alerts/log/route.ts
// ── Mirror Module: Home-Screen Bias Alert Logging (Sprint CX2 #6) ───────────
//
// POST: log an alert as surfaced (layer1 or layer2 client-side match).
//       Fire-and-forget from BehaviorAlerts.tsx — never blocks the UI.
// PATCH: mark a previously logged alert as dismissed.
//
// decision_snippet and matched_detail are encrypted at rest (lib/encryption.ts),
// consistent with how sessions.decision_text is handled — this table stores
// the same category of sensitive raw user input.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { encrypt }             from '@/lib/encryption'

async function resolveUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  try {
    const anonClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
    const { data: { user } } = await anonClient.auth.getUser(authHeader.slice(7))
    return user?.id ?? null
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  try {
    const userId = await resolveUserId(req)
    if (!userId) return NextResponse.json({ id: null })

    const body = await req.json().catch(() => null) as {
      biasKey?:         string
      source?:          'layer1' | 'layer2'
      accessTier?:      'teaser' | 'unlocked'
      decisionSnippet?: string
      matchedPhrase?:   string
    } | null

    if (!body?.biasKey || !body.source || !body.accessTier) {
      return NextResponse.json({ id: null })
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('bias_alert_log')
      .insert({
        user_id:          userId,
        bias_key:         body.biasKey,
        source:           body.source,
        access_tier:      body.accessTier,
        decision_snippet: encrypt((body.decisionSnippet ?? '').slice(0, 200)),
        matched_detail:   encrypt((body.matchedPhrase ?? '').slice(0, 200)),
      })
      .select('id')
      .single()

    if (error) return NextResponse.json({ id: null })
    return NextResponse.json({ id: data.id })
  } catch {
    return NextResponse.json({ id: null })
  }
}

export async function PATCH(req: Request) {
  try {
    const userId = await resolveUserId(req)
    if (!userId) return NextResponse.json({ ok: false })

    const body = await req.json().catch(() => null) as { id?: string } | null
    if (!body?.id) return NextResponse.json({ ok: false })

    const supabase = createServiceClient()
    await supabase
      .from('bias_alert_log')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('id', body.id)
      .eq('user_id', userId)   // belt-and-suspenders — can only dismiss your own rows

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false })
  }
}
