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

  const [{ data: messages }, { count: totalSessionCount }, mirrorState, tourProfileResult, ontologyStatusResult, synthesisVersionsResult] = await Promise.all([
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
    // P1: "What Changed" drawer — restore synthesis-version history (verdict/
    // weights/leans per version) so a reload mid-deliberation doesn't reset
    // the drawer back to a single version. See supabase/add_synthesis_versions_table.sql.
    supabase.from('synthesis_versions').select('version, verdict_text, verdict_lean, weights, leans').eq('session_id', id).order('version', { ascending: true }),
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

  // P1 fix: appliedRuleRef (SessionView) was purely in-memory — a reload after
  // a network failure lost the user's "Apply this rule" choice from
  // RuleRecallBanner even though it's already persisted (rule_recall_choice /
  // rule_recall_rule_text on this same sessions row, written by
  // PATCH /api/session/commitment). Already present in `session` via
  // select('*') above — just needs decrypting and gating on choice==='applied'.
  const appliedRuleFromServer = session.rule_recall_choice === 'applied'
    ? decryptText(session.rule_recall_rule_text)
    : null

  // P1: decrypt verdict_text per version — weights/leans are stored plain
  // (advisor labels/scores/lean classification, not decision content).
  const initialSynthesisVersions = (synthesisVersionsResult.data ?? []).map(row => ({
    version:     row.version as number,
    verdictText: decryptText(row.verdict_text) ?? '',
    verdictLean: (row.verdict_lean ?? '') as string,
    weights:     (row.weights ?? {}) as Record<string, number>,
    leans:       (row.leans ?? {}) as Record<string, string>,
  }))

  const decryptedSession = {
    ...session,
    decision_text: decryptText(session.decision_text) ?? '',
    context_text:  decryptText(session.context_text),
  }

  // Build personaKey → full assistant content map from stored messages
  // Bug fix: this previously concatenated multiple rows for the same persona
  // (initial response + every pushback reply — the messages table gets a new
  // row per call, see app/api/persona/route.ts) with NO separator at all,
  // so on reload the last sentence of one response ran directly into the
  // first word of the next with no paragraph break. Noted here rather than
  // fully reconstructed: this map only feeds PersonaPanel's initialContent
  // (used to re-derive the header tags + the flowing "response" prose on
  // reload) — it does not restore per-exchange "You challenged" dividers,
  // since PersonaPanel doesn't parse that structure back out of a single
  // string. Restoring that history structure would be a separate, larger
  // change; this fix only stops prose from visibly running together.
  const initialMessages: Record<string, string> = {}
  for (const msg of messages ?? []) {
    if (msg.role === 'assistant' && msg.persona && msg.content) {
      const prev = initialMessages[msg.persona]
      initialMessages[msg.persona] = (prev ? prev + '\n\n' : '') + (decrypt(msg.content) ?? '')
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
    appliedRuleFromServer={appliedRuleFromServer}
    initialSynthesisVersions={initialSynthesisVersions}
  />
}
