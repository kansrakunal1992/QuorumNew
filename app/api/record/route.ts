import { createServiceClient } from '@/lib/supabase'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { decrypt } from '@/lib/encryption'

// DELETE — hard-delete a session and all its related rows (messages, outcomes cascade)
// Auth: user must own the session (user_id match) OR session must have no user_id (device-only)
export async function DELETE(req: Request) {
  try {
    const { sessionId } = await req.json()
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Resolve caller identity from auth token (optional — device-only sessions have no user_id)
    let callerId: string | null = null
    const authHeader = req.headers.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const anonClient = createSupabaseClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        )
        const { data: { user } } = await anonClient.auth.getUser(authHeader.slice(7))
        callerId = user?.id ?? null
      } catch { /* invalid token — continue as anonymous */ }
    }

    // Fetch the session to verify ownership before deleting
    const { data: session, error: fetchError } = await supabase
      .from('sessions')
      .select('id, user_id')
      .eq('id', sessionId)
      .single()

    if (fetchError || !session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // Ownership check:
    // - If session has a user_id, caller must match
    // - If session has no user_id (device-only), allow delete (no identity to verify against)
    if (session.user_id && session.user_id !== callerId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Delete session — messages, outcomes, examiner_responses, sessions_ontology
    // all cascade via ON DELETE CASCADE foreign keys
    const { error: deleteError } = await supabase
      .from('sessions')
      .delete()
      .eq('id', sessionId)

    if (deleteError) {
      console.error('Session delete error:', deleteError)
      return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Record DELETE error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST — mark session as completed
export async function POST(req: Request) {
  try {
    const { sessionId } = await req.json()

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    const { error } = await supabase
      .from('sessions')
      .update({ status: 'completed' })
      .eq('id', sessionId)

    if (error) {
      console.error('Record update error:', error)
      return NextResponse.json({ error: 'Failed to save record' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Record route error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET — fetch full decision record (session + all messages)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('sessionId')

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const [sessionResult, messagesResult] = await Promise.all([
    supabase.from('sessions').select('*').eq('id', sessionId).single(),
    supabase
      .from('messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true }),
  ])

  if (sessionResult.error || !sessionResult.data) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const session = sessionResult.data
  const messages = (messagesResult.data ?? []).map(m => ({
    ...m,
    content: decrypt(m.content),
  }))

  return NextResponse.json({
    session: {
      ...session,
      decision_text: decrypt(session.decision_text),
      context_text:  decrypt(session.context_text),
    },
    messages,
  })
}
