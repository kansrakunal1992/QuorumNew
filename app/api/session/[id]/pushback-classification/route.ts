// app/api/session/[id]/pushback-classification/route.ts
//
// POST — called by PersonaPanel right after a pushback reply's stream
// completes (fire-and-forget, non-blocking — same pattern as
// synthesis-version/route.ts: a failed write here should never affect the
// reply the user is already reading).
//
// PURPOSE
// Every persona already classifies each pushback internally (Step 1 of the
// pushback protocol, lib/personas.ts) as weak | partially_valid |
// materially_valid | recommendation_changing — this was previously computed
// and then discarded the instant that one reply finished streaming. This
// route is the capture layer the "what changes your mind" cross-session
// aggregate (lib/mind-change-patterns.ts) depends on.
//
// IDENTITY
// Same resolution pattern as echo-hint/route.ts — anonymous sessions (no
// user_id or user_email) are simply not persisted here. There is no
// cross-session pattern to build for a session with no persistent identity,
// so silently skipping is correct, not a bug to route around.

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'

interface Params { params: Promise<{ id: string }> }

const VALID_PERSONAS = [
  'contrarian', 'risk_architect', 'pattern_analyst',
  'stakeholder_mirror', 'elder', 'competitor',
]
const VALID_CLASSIFICATIONS = [
  'weak', 'partially_valid', 'materially_valid', 'recommendation_changing',
]

export async function POST(req: Request, { params }: Params) {
  try {
    const { id: sessionId } = await params
    if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

    const { personaKey, classification } = await req.json() as {
      personaKey?:     string
      classification?: string
    }

    if (!personaKey || !VALID_PERSONAS.includes(personaKey)) {
      return NextResponse.json({ error: 'valid personaKey required' }, { status: 400 })
    }
    if (!classification || !VALID_CLASSIFICATIONS.includes(classification)) {
      return NextResponse.json({ error: 'valid classification required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Same identity resolution as echo-hint/route.ts.
    const { data: currentSession } = await supabase
      .from('sessions')
      .select('user_email, user_id')
      .eq('id', sessionId)
      .single()

    const userEmail = currentSession?.user_email ?? null
    const userId    = currentSession?.user_id    ?? null

    // Anonymous session — nothing to build a cross-session pattern from.
    // Not an error; this is the expected, silent path for device-only use.
    if (!userEmail && !userId) {
      return NextResponse.json({ ok: true, skipped: 'no_identity' })
    }

    const { error } = await supabase
      .from('pushback_classifications')
      .insert({
        session_id: sessionId,
        persona_key: personaKey,
        classification,
        user_id:    userId,
        user_email: userEmail,
      })

    if (error) {
      console.error('[PushbackClassification POST] supabase error:', error)
      return NextResponse.json({ error: 'Failed to save classification' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[PushbackClassification POST] Route error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
