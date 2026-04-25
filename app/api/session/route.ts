import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  try {
    const { decision_text, context_text } = await req.json()

    if (!decision_text?.trim()) {
      return NextResponse.json({ error: 'decision_text is required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from('sessions')
      .insert({
        decision_text: decision_text.trim(),
        context_text: context_text?.trim() || null,
        status: 'active',
      })
      .select('id')
      .single()

    if (error) {
      console.error('Supabase insert error:', error)
      return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
    }

    const sessionId = data.id

    // ── Fire ontology tagger async ─────────────────────────────
    // Never awaited — user is not blocked.
    // Runs in the background. If it fails, sessions_ontology.tagger_status = 'failed'.
    // The app functions fully without the ontology tag.
    fireOntologyTagger(sessionId, decision_text.trim(), context_text?.trim() ?? null)

    return NextResponse.json({ id: sessionId })
  } catch (err) {
    console.error('Session route error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Fire-and-forget tagger call using internal API route
// Using fetch to own API rather than direct import keeps the async boundary clean
// and prevents any tagger error from ever reaching the session creation response.
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
    // Silent fail — tagger is background infrastructure, not critical path
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
