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

// Human-readable labels for ontology decision types.
// These replace raw taxonomy terms (e.g. "allocation decision") with language
// that speaks directly to the user about what kind of move they're making.
const DECISION_TYPE_LABELS: Record<string, string> = {
  commitment:   'a commitment you\'re locking yourself into',
  allocation:   'a resource allocation call — deciding where to put your chips',
  transition:   'a major transition — one chapter closing, another opening',
  acquisition:  'an acquisition — taking something new into your world',
  renunciation: 'a letting-go decision',
  governance:   'a governance question — how control or authority gets structured',
  delegation:   'a question of trust — who gets the wheel',
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

  const dtLabel = decisionType
    ? (DECISION_TYPE_LABELS[decisionType] ?? decisionType)
    : null

  const arc = archetype ? capitalize(archetype) : null

  // Priority: most specific signal first
  if (arc && emotion) {
    return `Quorum read you as a ${arc} making this call through a lens of ${emotion}. Does that track?`
  }
  if (arc && reversibility?.includes('irrevers')) {
    return `Quorum read you as a ${arc} standing at a one-way door. What you choose here doesn't easily reverse.`
  }
  if (arc && dtLabel) {
    return `Quorum read you as a ${arc} working through ${dtLabel}.`
  }
  if (arc) {
    return `Quorum read this as a ${arc} move — a decision shaped by who you are, not just what's in front of you.`
  }
  if (emotion && reversibility?.includes('irrevers')) {
    return `Quorum read this as ${emotion}-driven — and one of those calls you can't easily undo. Once you move, there's no neutral gear.`
  }
  if (emotion) {
    return `Quorum read ${emotion} as the real undercurrent here. Was that what you were actually feeling going into this?`
  }
  if (reversibility?.includes('irrevers')) {
    return `Quorum read this as a one-way door. The real weight here isn't the trade-offs — it's what you're permanently closing off.`
  }
  if (dtLabel) {
    return `Quorum read this at its core as ${dtLabel}.`
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
