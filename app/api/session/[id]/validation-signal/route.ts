// app/api/session/[id]/validation-signal/route.ts
// SB-1: Returns the computed validation one-liner for the ValidationCard.
// Called client-side from ValidationCard after allPersonasDone fires.
// Reads sessions_ontology (dominant_emotion) + user_profiles (archetype).
// No sensitive data — session_id UUID is the access control (non-guessable).

import { createServiceClient, createClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

const LOW_SIGNAL_EMOTIONS = new Set(['ambivalence', 'resignation'])

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function buildValidationLine(
  dominantEmotion: string | null,
  archetype:       string | null,
  decisionType:    string | null,
  reversibility:   string | null,
): string | null {
  const emotion = dominantEmotion && !LOW_SIGNAL_EMOTIONS.has(dominantEmotion)
    ? dominantEmotion
    : null

  if (archetype && emotion) {
    return `Quorum read this as a ${capitalize(archetype)} decision shaped by ${emotion}.`
  }
  if (archetype) {
    if (reversibility?.includes('irrevers')) {
      return `Quorum read this as a ${capitalize(archetype)} decision with an irreversible floor.`
    }
    if (decisionType) {
      return `Quorum read this as a ${capitalize(archetype)} decision in ${decisionType} territory.`
    }
    return `Quorum read this as a ${capitalize(archetype)} decision.`
  }
  if (emotion) {
    return `Quorum read this as ${emotion}-driven. Does that match what you were actually feeling?`
  }
  if (reversibility?.includes('irrevers')) {
    return `Quorum read this primarily as an irreversibility question, not a trade-off question.`
  }
  if (decisionType) {
    return `Quorum read this primarily as a ${decisionType} decision.`
  }
  return null
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params
  if (!sessionId) return NextResponse.json({ signal: null })

  const supabase = createServiceClient()

  let callerId: string | null = null
  const auth = req.headers.get('Authorization')
  if (auth?.startsWith('Bearer ')) {
    try {
      const anon = createClient()
      const { data: { user } } = await anon.auth.getUser(auth.slice(7).trim())
      callerId = user?.id ?? null
    } catch { callerId = null }
  }

  const [ontologyResult, sessionResult] = await Promise.all([
    supabase
      .from('sessions_ontology')
      .select('dominant_emotion, decision_type_primary, stakes_reversibility')
      .eq('session_id', sessionId)
      .single(),
    supabase
      .from('sessions')
      .select('user_id, user_email, device_id, validation_state')
      .eq('id', sessionId)
      .single(),
  ])

  if (sessionResult.error || !sessionResult.data) {
    return NextResponse.json({ signal: null })
  }

  const session = sessionResult.data

  if (session.validation_state !== 'pending') {
    return NextResponse.json({ signal: null, already_validated: true })
  }

  let archetype: string | null = null
  const userId = callerId ?? session.user_id ?? null
  if (userId) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('archetype')
      .eq('user_id', userId)
      .single()
    archetype = profile?.archetype ?? null
  }

  const ontology = ontologyResult.data
  const validationLine = buildValidationLine(
    ontology?.dominant_emotion ?? null,
    archetype,
    ontology?.decision_type_primary ?? null,
    ontology?.stakes_reversibility ?? null,
  )

  return NextResponse.json({
    signal: validationLine
      ? { line: validationLine, archetype: archetype ?? null }
      : null,
  })
}
