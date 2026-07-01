import { createServiceClient, createClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { encrypt, decrypt } from '@/lib/encryption'
import { checkLimit, getClientIP, tooManyRequests, LIMITS } from '@/lib/rate-limit'

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

    const {
      decision_text,
      context_text,
      register_mode,
      framing_intent,
      pre_decision_confidence,
      user_email,
      device_id,
      parent_session_id,
    } = await req.json()

    if (!decision_text?.trim()) {
      return NextResponse.json({ error: 'decision_text is required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // ── RET-5 Sprint 1: validate parent_session_id belongs to the same identity ──
    let resolvedParentId: string | null = null
    let validationCorrectionCarry: string | null = null
    if (parent_session_id) {
      const { data: parentRow } = await supabase
        .from('sessions')
        .select('user_id, user_email, device_id, validation_correction')
        .eq('id', parent_session_id)
        .single()

      const requesterEmail = user_email?.trim().toLowerCase() || null
      const sameIdentity = !!(
        (serverUserId   && parentRow?.user_id    === serverUserId) ||
        (requesterEmail && parentRow?.user_email === requesterEmail) ||
        (device_id      && parentRow?.device_id  === device_id)
      )

      if (sameIdentity) {
        resolvedParentId = parent_session_id
        // S2-05: carry prior session correction into this session so the council context
        // can inject it at persona-call time (current session has no correction yet).
        const rawCarry = (parentRow as { validation_correction?: string | null } | null)?.validation_correction ?? null
        validationCorrectionCarry = rawCarry?.trim() || null
      } else if (parentRow) {
        console.warn(`[Session] parent_session_id ${parent_session_id} identity mismatch — dropping link`)
      }
    }

    const { data, error } = await supabase
      .from('sessions')
      .insert({
        decision_text: encrypt(decision_text.trim()),
        context_text:  encrypt(context_text?.trim() || null),
        register_mode: register_mode ?? 'analytical',
        // ── SB-1: Framing intent — three-way signal, maps to register_mode for rule engine
        // 'challenge' → analytical | 'clarify' → clarification | 'right' → analytical
        // Used by council context (SB-3) for synthesis directive.
        framing_intent: ['challenge', 'clarify', 'right'].includes(framing_intent)
          ? framing_intent
          : null,
        pre_decision_confidence: (
          typeof pre_decision_confidence === 'number' &&
          pre_decision_confidence >= 1 &&
          pre_decision_confidence <= 10
        ) ? pre_decision_confidence : null,
        status:    'active',
        user_email: user_email?.trim().toLowerCase() || null,
        device_id:  device_id || null,
        user_id:    serverUserId,
        parent_session_id: resolvedParentId,
        // S2-05: carry prior session correction for council context injection
        validation_correction_carry: validationCorrectionCarry,
      })
      .select('id')
      .single()

    if (error) {
      console.error('Supabase insert error:', error)
      return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
    }

    const sessionId = data.id

    fireOntologyTagger(sessionId, decision_text.trim(), context_text?.trim() ?? null)

    return NextResponse.json({ id: sessionId })
  } catch (err) {
    console.error('Session route error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function fireOntologyTagger(
  sessionId:    string,
  decisionText: string,
  contextText:  string | null
) {
  const baseUrl        = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const internalSecret = process.env.INTERNAL_API_SECRET ?? ''
  fetch(`${baseUrl}/api/ontology`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': internalSecret },
    body:    JSON.stringify({ sessionId, decisionText, contextText }),
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
    decision_text:          decrypt(data.decision_text),
    context_text:           decrypt(data.context_text),
    commitment_leaning:     decrypt(data.commitment_leaning)     ?? null,
    commitment_switch:      decrypt(data.commitment_switch)      ?? null,
    rule_recall_rule_text:  decrypt(data.rule_recall_rule_text)  ?? null,
  })
}
