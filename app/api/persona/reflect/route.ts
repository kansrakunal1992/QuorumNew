// app/api/persona/reflect/route.ts
// ── Unified session, point 3 ────────────────────────────────────────────────
// Generates the one-line reflection shown above Examiner's first question.
// Separate from /api/persona/predict (different job: paraphrase-back, not
// a hypothesis about the eventual choice) and from persona/route.ts (same
// isolation reasoning as predict/route.ts — see lib/prediction-engine.ts).
// Takes sessionId (not raw text) and decrypts server-side, matching predict/
// route.ts's pattern — keeps ExaminerPanel from needing decisionText threaded
// in as a new prop. Only reachable when the unified session flag is on.

import { NextResponse }            from 'next/server'
import { createServiceClient }     from '@/lib/supabase'
import { decrypt }                 from '@/lib/encryption'
import { isUnifiedSessionEnabled } from '@/lib/feature-flags'
import { generateReflectionLine }  from '@/lib/prediction-engine'

export async function POST(req: Request) {
  if (!isUnifiedSessionEnabled()) {
    return NextResponse.json({ error: 'Not enabled' }, { status: 404 })
  }
  let body: { sessionId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const sessionId = body.sessionId
  if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })

  const supabase = createServiceClient()
  const { data: session } = await supabase
    .from('sessions')
    .select('decision_text')
    .eq('id', sessionId)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  const decisionText = decrypt(session.decision_text) ?? ''
  if (!decisionText) return NextResponse.json({ line: null })

  const line = await generateReflectionLine(decisionText)
  return NextResponse.json({ line })
}
