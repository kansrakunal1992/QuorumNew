// app/api/session/route.ts
// ── Sprint 4 (S4-02): Fix client-supplied user_id ────────────────────────────
//
// VULNERABILITY FIXED: user_id is no longer accepted from the request body.
// Previous code trusted the client-supplied user_id directly — any caller
// could pass an arbitrary UUID and stamp a session under another user's account.
//
// FIX: user_id is derived entirely server-side from the Authorization header.
//   1. Client sends `Authorization: Bearer <access_token>` (from supabase.auth.getSession())
//   2. Server calls anonClient.auth.getUser(token) to verify the token
//   3. Verified user.id is used — body user_id field is silently ignored
//   4. If no valid token, user_id is null (anonymous session — correct behaviour)
//
// All other fields (decision_text, context_text, user_email, device_id) are
// unchanged — only user_id derivation moved to server.
// ─────────────────────────────────────────────────────────────────────────────

import { createServiceClient, createClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { encrypt, decrypt } from '@/lib/encryption'

export async function POST(req: Request) {
  try {
    // ── S4-02: Derive user_id from Bearer token — never trust the body ────────
    let serverUserId: string | null = null
    const authHeader = req.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim()
      if (token) {
        try {
          const anonClient = createClient()
          const { data: { user } } = await anonClient.auth.getUser(token)
          serverUserId = user?.id ?? null
        } catch {
          // Invalid or expired token — treat as anonymous
          serverUserId = null
        }
      }
    }

    // ── Parse body — note: user_id field in body is intentionally ignored ──────
    const {
      decision_text,
      context_text,
      register_mode,
      pre_decision_confidence,
      user_email,
      device_id,
      // user_id is intentionally NOT destructured — always derived server-side above
    } = await req.json()

    if (!decision_text?.trim()) {
      return NextResponse.json({ error: 'decision_text is required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from('sessions')
      .insert({
        decision_text: encrypt(decision_text.trim()),
        context_text:  encrypt(context_text?.trim() || null),
        register_mode: register_mode ?? 'analytical',
        // ── Sprint 14: baseline confidence before Council ──────────────────
        pre_decision_confidence: (
          typeof pre_decision_confidence === 'number' &&
          pre_decision_confidence >= 1 &&
          pre_decision_confidence <= 10
        ) ? pre_decision_confidence : null,
        status: 'active',
        // ── Sprint 4b: user identity chain ─────────────────────────────────
        // user_email: entered optionally on home page (pre-auth).
        user_email: user_email?.trim().toLowerCase() || null,
        // device_id: anonymous device fingerprint from localStorage.
        device_id:  device_id || null,
        // ── S4-02: user_id stamped from verified server-side token only ─────
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

  fetch(`${baseUrl}/api/ontology`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
    decision_text:         decrypt(data.decision_text),
    context_text:          decrypt(data.context_text),
    // Sprint Chunk 1: decrypt commitment fields stored encrypted
    commitment_leaning:    decrypt(data.commitment_leaning)    ?? null,
    commitment_switch:     decrypt(data.commitment_switch)     ?? null,
    rule_recall_rule_text: decrypt(data.rule_recall_rule_text) ?? null,
  })
}
