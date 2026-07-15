import { notFound }            from 'next/navigation'
import { createServiceClient } from '@/lib/supabase'
import SessionView             from '@/components/SessionView'
import { decrypt }             from '@/lib/encryption'
import { getMirrorAccessState } from '@/lib/mirror-access'   // O4

interface Props {
  params: Promise<{ id: string }>
}

function decryptText(value: string | null | undefined): string | null {
  return decrypt(value) ?? null
}

export default async function SessionPage({ params }: Props) {
  const { id } = await params
  const supabase = createServiceClient()

  const { data: session, error } = await supabase.from('sessions').select('*').eq('id', id).single()

  if (error || !session) { notFound() }

  const [{ data: messages }, { count: totalSessionCount }, mirrorState, tourProfileResult, ontologyStatusResult] = await Promise.all([
    supabase.from('messages').select('persona, role, content').eq('session_id', id).order('created_at', { ascending: true }),
    session.user_id
      ? supabase.from('sessions').select('*', { count: 'exact', head: true }).eq('user_id', session.user_id)
      : Promise.resolve({ count: null }),
    // O4: resolve actual mirror access — never hardcode false for paying users
    session.user_id
      ? getMirrorAccessState(session.user_id, supabase)
      : Promise.resolve('locked' as const),
    // P0 fix: server-side truth for "has this user already seen the Council tour" —
    // same cross-device durability the Home tour already has (see
    // supabase/add_council_record_tour_completed_to_user_profiles.sql).
    session.user_id
      ? supabase.from('user_profiles').select('council_tour_completed_at').eq('user_id', session.user_id).single()
      : Promise.resolve({ data: null }),
    // P0 fix: examiner_status lives on sessions_ontology (keyed by session_id),
    // NOT on sessions — a prior version of this fix incorrectly read it off
    // the sessions row, where the column doesn't exist, so it silently always
    // evaluated to false. Fetching it here alongside everything else.
    supabase.from('sessions_ontology').select('examiner_status').eq('session_id', id).maybeSingle(),
  ])

  const councilTourDone = !!tourProfileResult?.data?.council_tour_completed_at

  // P0 fix: examiner_status is set to 'submitted' on both the submit and skip
  // paths (app/api/examiner/route.ts, table sessions_ontology). Previously
  // nothing on this page (or in SessionView) ever checked it, so a reload —
  // e.g. after a network error mid-Council — always re-asked the Examiner
  // from scratch. REDIRECT-mode sessions never set this column (that path
  // fires client-side only, without a POST), so they correctly remain
  // unaffected by this check.
  const examinerAlreadySubmitted = ontologyStatusResult.data?.examiner_status === 'submitted'

  // P0 follow-up fix: reconstruct the original Examiner Q&A so any advisor
  // that hadn't finished streaming before the reload (e.g. network failure
  // mid-Council) still gets the exact same context it would have received
  // on a normal run, instead of firing fresh with no Examiner context at all.
  // Only fetched when actually needed (submitted, not skipped-with-no-rows).
  let examinerSavedResponses: Array<{ question_text: string; response_text: string | null; gap: string }> = []
  if (examinerAlreadySubmitted) {
    const { data: savedRows } = await supabase
      .from('examiner_responses')
      .select('question_text, response_text, question_order, unknown_unknown_gap')
      .eq('session_id', id)
      .order('question_order', { ascending: true })
    examinerSavedResponses = (savedRows ?? []).map(r => ({
      question_text: decryptText(r.question_text) ?? '',
      response_text: decryptText(r.response_text),
      gap:           r.unknown_unknown_gap,
    }))
  }

  const decryptedSession = {
    ...session,
    decision_text: decryptText(session.decision_text) ?? '',
    context_text:  decryptText(session.context_text),
  }

  // Build personaKey → full assistant content map from stored messages
  const initialMessages: Record<string, string> = {}
  for (const msg of messages ?? []) {
    if (msg.role === 'assistant' && msg.persona && msg.content) {
      initialMessages[msg.persona] =
        (initialMessages[msg.persona] ?? '') + (decrypt(msg.content) ?? '')
    }
  }

  return <SessionView
    session={decryptedSession}
    initialMessages={initialMessages}
    totalSessionCount={totalSessionCount ?? undefined}
    encryptionEnabled={!!process.env.DB_ENCRYPTION_KEY}
    mirrorActive={mirrorState === 'unlocked'}     // O4: real mirror access state
    councilTourDone={councilTourDone}
    examinerAlreadySubmitted={examinerAlreadySubmitted}
    examinerSavedResponses={examinerSavedResponses}
  />
}
