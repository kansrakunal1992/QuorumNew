import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  try {
    const { decision_text, context_text, register_mode, user_email, device_id } = await req.json()

    if (!decision_text?.trim()) {
      return NextResponse.json({ error: 'decision_text is required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from('sessions')
      .insert({
        decision_text: decision_text.trim(),
        context_text: context_text?.trim() || null,
        register_mode: register_mode ?? 'analytical',
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

  return NextResponse.json(data)
}
