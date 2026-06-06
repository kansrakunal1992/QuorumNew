import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { encrypt, decrypt } from '@/lib/encryption'

export async function POST(req: Request) {
  // S5-01: rate limit session creation — 20 per 15 min per IP
  const rlResult = checkLimit(getClientIP(req), LIMITS.session)
  if (!rlResult.allowed) return tooManyRequests(rlResult, 'session requests')

  try {
    // S4-02: Derive user_id from Bearer token — never trust body
    let serverUserId: string | null = null
    const authHeader = req.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim()
      if (token) {
        try {
          const anonClient = createClient()
          const { data: { user } } = await anonClient.auth.getUser(token)
          serverUserId = user?.id ?? null
        } catch { serverUserId = null }
      }
    }
    const { decision_text, context_text, register_mode, pre_decision_confidence, user_email, device_id } = await req.json()

    if (!decision_text?.trim()) {
      return NextResponse.json({ error: 'decision_text is required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from('sessions')
      .insert({
        decision_text: encrypt(decision_text.trim()),
        context_text: encrypt(context_text?.trim() || null),
        register_mode: register_mode ?? 'analytical',
        // ── Sprint 14: baseline confidence before Council ──────────────────
        pre_decision_confidence: (typeof pre_decision_confidence === 'number' && pre_decision_confidence >= 1 && pre_decision_confidence <= 10)
          ? pre_decision_confidence : null,
        status: 'active',
        // ── Sprint 4b: user identity chain ─────────────────────────────────
        // user_email: entered optionally on home page (pre-auth).
        //   Allows bias accumulation before magic-link auth completes.
        //   After auth, link_sessions_to_user RPC also populates user_id.
        // device_id: generated silently on first visit, stored in localStorage.
        //   Third-tier fallback — accumulation scoped to this device only.
        //   If user later adds email, their email-keyed bias rows take over.
        user_email: user_email?.trim().toLowerCase() || null,
        device_id:  device_id || null,
        // ── Sprint 6 fix: stamp user_id at session creation when user is authenticated
        // Client reads this from supabase.auth.getSession() and passes it here.
        // Avoids relying solely on the post-auth link-sessions RPC to backfill.
        user_id: serverUserId,
      })
      .select('id')
      .single()

    if (error) {
      console.error('Supabase insert error:', error)
      return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
    }

    const sessionId = data.id

    // ── Fire ontology tagger async ─────────────────────────────────────────
    fireOntologyTagger(sessionId, decision_text.trim(), context_text?.trim() ?? null)

    return NextResponse.json({ id: sessionId })
  } catch (err) {
    console.error('Session route error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function fireOntologyTagger(
  sessionId: string,
  decisionText: string,
  contextText: string | null
) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  const internalSecret = process.env.INTERNAL_API_SECRET ?? ''
  fetch(`${baseUrl}/api/ontology`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': internalSecret },
    body: JSON.stringify({ sessionId, decisionText, contextText }),
  }).catch(err => {
    console.error('[Session] Ontology tagger fire failed:', err)
  })
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  return NextResponse.json({
    ...data,
    decision_text:        decrypt(data.decision_text),
    context_text:         decrypt(data.context_text),
    // Sprint Chunk 1: decrypt commitment fields stored encrypted
    commitment_leaning:   decrypt(data.commitment_leaning)    ?? null,
    commitment_switch:    decrypt(data.commitment_switch)     ?? null,
    rule_recall_rule_text: decrypt(data.rule_recall_rule_text) ?? null,
  })
}
