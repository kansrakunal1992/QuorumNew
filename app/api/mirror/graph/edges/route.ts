// app/api/mirror/graph/edges/route.ts
// ── Decision Graph: create user_asserted edge (Sprint G2) ────────────────────
//
// POST /api/mirror/graph/edges
// Body: { session_id_a: string, session_id_b: string, explanation_text: string }
//
// Auth:    Bearer token → resolveUserId
// Access:  getMirrorAccessState === 'unlocked'
//
// Creates a user_asserted edge — the one narrow category-6 element: a single-
// sentence causal/narrative link the system's computed engines cannot infer
// (e.g. "leaving that job is why I made this six months later").
//
// Design constraints (KDD, Sprint G1 design session):
//   • explanation_text max 400 chars — enforced server-side.
//   • Stored encrypted (AES-256-GCM, same as decision_text).
//   • Pair canonicalised (session_id_a < session_id_b UUID lexicographic).
//   • Both sessions must belong to the authenticated user.
//   • Upserted — re-annotating the same pair replaces the prior explanation.
//   • Sprint G3 UI renders user_asserted edges with a visually distinct style
//     (never implying the system found a structural match it didn't).
//
// Response: { edge: GraphEdge } (created/updated, explanation_text decrypted)
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }            from 'next/server'
import { createServiceClient }     from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { getMirrorAccessState }    from '@/lib/mirror-access'
import { decryptGraphEdge }        from '@/lib/graph-engine'
import { encrypt }                 from '@/lib/encryption'

const MAX_EXPLANATION_CHARS = 400
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

export async function POST(req: Request): Promise<NextResponse> {
  const supabase = createServiceClient()

  // ── 1. Auth ───────────────────────────────────────────────────────────────
  const userId = await resolveUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── 2. Mirror access ──────────────────────────────────────────────────────
  const accessState = await getMirrorAccessState(userId, supabase)
  if (accessState !== 'unlocked') {
    return NextResponse.json({ error: 'Mirror access required' }, { status: 403 })
  }

  // ── 3. Parse + validate body ──────────────────────────────────────────────
  let body: { session_id_a?: string; session_id_b?: string; explanation_text?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const { session_id_a, session_id_b, explanation_text } = body
  const explanationTrimmed = explanation_text?.trim() ?? ''

  if (!session_id_a?.trim() || !session_id_b?.trim()) {
    return NextResponse.json({ error: 'session_id_a and session_id_b are required' }, { status: 400 })
  }
  if (session_id_a === session_id_b) {
    return NextResponse.json({ error: 'session_id_a and session_id_b must differ' }, { status: 400 })
  }
  if (!UUID_RE.test(session_id_a) || !UUID_RE.test(session_id_b)) {
    return NextResponse.json({ error: 'Invalid session UUID format' }, { status: 400 })
  }
  if (!explanationTrimmed) {
    return NextResponse.json({ error: 'explanation_text is required' }, { status: 400 })
  }
  if (explanationTrimmed.length > MAX_EXPLANATION_CHARS) {
    return NextResponse.json(
      { error: `explanation_text must be ${MAX_EXPLANATION_CHARS} characters or fewer` },
      { status: 400 }
    )
  }

  // ── 4. Verify ownership of both sessions ──────────────────────────────────
  // Security: without this a user could annotate another user's decision by
  // submitting a foreign session_id.
  const { data: owned, error: ownerErr } = await supabase
    .from('sessions')
    .select('id')
    .in('id', [session_id_a, session_id_b])
    .eq('user_id', userId)

  if (ownerErr || !owned || owned.length < 2) {
    return NextResponse.json(
      { error: 'One or both sessions not found or not owned by this user' },
      { status: 404 }
    )
  }

  // ── 5. Canonicalise + write ───────────────────────────────────────────────
  const [sid_a, sid_b] = session_id_a < session_id_b
    ? [session_id_a, session_id_b]
    : [session_id_b, session_id_a]

  const { data: newEdge, error: writeErr } = await supabase
    .from('graph_edges')
    .upsert(
      {
        user_id:             userId,
        session_id_a:        sid_a,
        session_id_b:        sid_b,
        edge_type:           'user_asserted',
        strength:            null,
        dimension_breakdown: null,
        explanation_text:    encrypt(explanationTrimmed),
        metadata:            null,
        dismissed_at:        null,   // reset dismissed state on re-annotation
        computed_at:         new Date().toISOString(),
      },
      { onConflict: 'session_id_a,session_id_b,edge_type' }
    )
    .select()
    .single()

  if (writeErr || !newEdge) {
    console.error('[mirror/graph/edges] write failed:', writeErr?.message)
    return NextResponse.json({ error: 'Failed to create edge' }, { status: 500 })
  }

  console.log(`[mirror/graph/edges] user_asserted: ${sid_a} ↔ ${sid_b} by ${userId}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return NextResponse.json({ edge: decryptGraphEdge(newEdge as any) })
}
