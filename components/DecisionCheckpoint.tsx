'use client'

// components/DecisionCheckpoint.tsx
// ── Natural Intake (v1) — the checkpoint screen ───────────────────────────────
//
// v4 flow (see docs/CHANGELOG_v4.md). The lean + priority taps now happen at
// the END of the chat (components/ChatIntake.tsx), so this screen no longer
// has a lean step. Moments, in order:
//   1. "Here's the decision I think you're actually making" — pure reflection
//      of the chat, no session created yet. Confirm / Edit / Let me add more.
//   2. Confirming creates a real session (POST /api/chat-intake/checkpoint,
//      which also copies the chat's lean + priority onto it) and immediately
//      starts Quorum's prediction in parallel with everything below.
//   3. "Quick check" — ONLY if the Examiner still needs something. Answers the
//      chat already covered are shown together and confirmed with one tap
//      (lib/examiner-derive.ts); only genuine gaps are asked. If nothing is
//      left, this step is skipped entirely.
//   4. The reveal — "You lean X / we predict Y", with Convene the Council as
//      the one primary action and "I'm done" as a small link. Prediction
//      comes AFTER the quick check on purpose: Quorum's hypothesis must not
//      be visible while the person is still answering questions that feed
//      bias scoring.
//   5. "I'm done" ends on a reward screen that keeps Convene one tap away.
//
// Deliberately does NOT render the Structural Read visualization or the
// six-persona grid — those stay exactly as SessionView.tsx already renders
// them, reached only via "Convene the Council".
//
// No internal terms ("Examiner", "rule_id", "structural read") ever reach
// this component's copy — see docs/COPY_AND_STRUCTURE_LOCK_v1.md.

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { ChatDecisionState } from '@/lib/types'
import { isUnifiedSessionEnabled } from '@/lib/feature-flags'
import { createClient } from '@/lib/supabase'
import { getAuthHeaders } from '@/lib/auth-headers'      // Phase 0: send the token on checkpoint
import { pushSessionId } from '@/lib/storage'            // Phase 0: "I'm done" sessions must reach local history
import { track } from '@/lib/track'                      // Phase 0: first-party events
import { buildLeanChoices, matchSavedLean, PRIORITIES } from '@/lib/chat-intake-lean'   // v9: lean + priority now live on this screen
import type { LeanChoice } from '@/lib/chat-intake-lean'
import { INTAKE_FLOW_VERSION, councilReadiness, fullAnswerFor, readinessLine, summaryProvenance } from '@/lib/chat-intake-depth'
import ExpandableText from '@/components/ExpandableText'
import { viewportBucket } from '@/lib/chat-intake-cards'   // v9: readiness + provenance
import { intakeReadiness } from '@/lib/chat-intake-cards'    // v8: readiness marker
import NextDecisionPrompt from '@/components/NextDecisionPrompt'  // Phase 1: continuity ending
import { setDecisionPrefill } from '@/lib/prefill'
import StakeholderOutreach from '@/components/StakeholderOutreach'   // Phase 2/3, v2

interface ExaminerQuestion {
  order:          number
  text:           string
  gap:            string
  rule_id:        string | null
  criticality:    'critical' | 'important' | 'optional'
  derived?:       boolean
  derivedAnswer?: string | null
}

// Deliberately NOT imported from lib/chat-intake-insight.ts — that file
// pulls in lib/ai-client.ts (server-only build guard), and this is a
// Client Component. Duplicating this 2-line shape here is the safe choice;
// see lib/chat-intake-context.ts's file header for the exact build failure
// that pattern caused last time and how it was fixed.
interface CheckpointInsight {
  stakesLevel: 'low' | 'high'
  message:     string
}

interface Props {
  chatIntakeId:      string
  onBackToChat:      () => void
  onSessionCreated:  (sessionId: string) => void
  /**
   * Phase 1: called by the "I'm done" ending's continuity block with any text
   * the person typed ('' if none). NaturalIntakeClient resets to a fresh chat
   * (and prefills the input). Falls back to a full reload when not provided.
   */
  onNewDecision?:    (prefill: string) => void
}

type SubPhase = 'loading' | 'reflect' | 'editing' | 'creating' | 'examine' | 'reveal' | 'submitting' | 'done'

interface PredictionView {
  predictedChoice: string
  reasoning:       string
}

// 'unavailable' = this session can't have a prediction (unified flag off, or
// an older in-flight chat that never saw the lean chips) — the reveal screen
// simply omits that card rather than showing an error.
type PredictionStatus = 'idle' | 'loading' | 'ready' | 'failed' | 'unavailable'

// Questions the Council cannot run without (lib/readiness.ts: only 'critical'
// ones produce NOT_READY). R1/R7 are excluded — those are REDIRECT hard
// blocks with their own override path on the session page.
function isCouncilCritical(q: ExaminerQuestion): boolean {
  return q.criticality === 'critical' && q.rule_id !== 'R1' && q.rule_id !== 'R7'
}

const cardStyle: CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-dim)',
  borderRadius: 18,
  padding: 20,
}

const primaryBtn: CSSProperties = {
  padding: '13px 20px', borderRadius: 14, border: 'none',
  background: 'var(--gold)', color: 'var(--bg-void)',
  fontWeight: 600, fontSize: 15.5, cursor: 'pointer', width: '100%',
}

const secondaryBtn: CSSProperties = {
  padding: '13px 20px', borderRadius: 14, border: '1px solid var(--border-mid)',
  background: 'transparent', color: 'var(--text-2)',
  fontWeight: 500, fontSize: 15, cursor: 'pointer', width: '100%',
}

export default function DecisionCheckpoint({ chatIntakeId, onBackToChat, onSessionCreated, onNewDecision }: Props) {
  const [subPhase, setSubPhase]     = useState<SubPhase>('loading')
  const [state, setState]           = useState<ChatDecisionState>({})
  const [editedText, setEditedText] = useState('')
  const [original, setOriginal]       = useState('')    // v8: the person's own first words, shown beside the refined decision
  const summaryTracked = useRef(false)
  // v9: lean + priority were an extra panel at the end of the chat; they are part of this one confirmation now.
  const unified = isUnifiedSessionEnabled()
  const [leanPick, setLeanPick]         = useState<LeanChoice | null>(null)
  const [priorityPick, setPriorityPick] = useState<string | null>(null)
  const [launchError, setLaunchError]   = useState<string | null>(null)
  const [userMessages, setUserMessages] = useState<string[]>([])         // the person's own messages, to expand clipped answers
  const [leanOpen, setLeanOpen]         = useState<Record<number, boolean>>({})   // lean choices expanded to their full wording
  const [derivedReview, setDerivedReview] = useState(false)   // chat-covered Examiner answers are shown on the reveal screen, confirmed by Convene
  const [saveFailed, setSaveFailed]   = useState(false)         // the Examiner save failed 3 times: offer "continue anyway"
  const [feedback, setFeedback]       = useState<string | null>(null)
  const confirmInFlight = useRef(false)                         // a second tap / double-click can never start a second creation
  const [sessionId, setSessionId]   = useState<string | null>(null)
  const [questions, setQuestions]   = useState<ExaminerQuestion[]>([])
  const [answers, setAnswers]       = useState<Record<number, string>>({})
  const [confirmed, setConfirmed]   = useState<Record<number, boolean>>({})
  const [nextAction, setNextAction] = useState('')
  const [showNextAction, setShowNextAction] = useState(false)
  const [authToken, setAuthToken]   = useState<string | null>(null)
  const [insight, setInsight]       = useState<CheckpointInsight | null>(null)
  const [insightLoading, setInsightLoading] = useState(false)
  const [prediction, setPrediction]           = useState<PredictionView | null>(null)
  const [predictionStatus, setPredictionStatus] = useState<PredictionStatus>('idle')
  // The in-flight prediction request, so Convene can wait for it instead of
  // racing it: the session page also asks for a prediction if none is saved,
  // and two concurrent first calls would each generate their own answer.
  const predictionInFlight = useRef<Promise<void> | null>(null)

  // A question is resolved when the person confirmed a chat-derived answer or
  // typed one. Used to decide whether Convene would hit the NOT_READY wall.
  const isResolved = (q: ExaminerQuestion) =>
    (!!q.derived && !!confirmed[q.order]) || !!answers[q.order]?.trim()
  const councilBlocked = questions.some(q => isCouncilCritical(q) && !isResolved(q))

  // Same "does this person have a live session" check ChatIntake.tsx and
  // PlanBadge.tsx already do — needed here so the prediction call
  // (loadPrediction, below) can attribute the session to a signed-in user.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!cancelled) setAuthToken(session?.access_token ?? null)
      } catch { /* fine — the prediction route accepts a missing token */ }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    fetch(`/api/chat-intake?chatIntakeId=${chatIntakeId}`)
      .then(r => r.json())
      .then(d => {
        const s = (d.intake?.decision_state ?? {}) as ChatDecisionState
        setState(s)
        setEditedText(s.decisionStatement ?? '')
        const firstUser = ((d.messages ?? []) as { role: string; content: string }[]).find(m => m.role === 'user')?.content?.trim() ?? ''
        setOriginal(firstUser)
        setUserMessages(((d.messages ?? []) as { role: string; content: string }[]).filter(m => m.role === 'user').map(m => m.content))
        setLeanPick(matchSavedLean(buildLeanChoices(s.options), s.chosenLean, s.chosenLeanLabel))
        setPriorityPick(s.optimizationPriority ?? null)
        setSubPhase('reflect')
        // v8 marker: the refined-decision summary was shown. Ids / counts only.
        if (!summaryTracked.current) {
          summaryTracked.current = true
          const r = intakeReadiness(s)
          track('intake_summary_shown', {
            chat_intake_id:    chatIntakeId,
            flow_version:      s.flowVersion ?? null,
            viewport:          viewportBucket(),
            readiness_state:   r.state,
            decision_category: s.decisionKind ?? 'other',
            unknown_count:     r.unknownCount,
            has_tension:       !!s.contradictions?.length,
            changed_from_original: !!firstUser && !!s.decisionStatement && firstUser !== s.decisionStatement,
          })
        }
      })
      .catch(() => setSubPhase('reflect'))
  }, [chatIntakeId])

  // Quorum's prediction. Idempotent server-side, so a retry or a second mount
  // can't bill a second call or produce a second, different answer.
  function loadPrediction(sid: string): void {
    setPredictionStatus('loading')
    predictionInFlight.current = runPrediction(sid)
  }

  async function runPrediction(sid: string): Promise<void> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (authToken) headers.Authorization = `Bearer ${authToken}`
      const res = await fetch('/api/persona/predict', {
        method: 'POST', headers, body: JSON.stringify({ sessionId: sid }),
      })
      if (!res.ok) throw new Error(`predict ${res.status}`)
      const d = await res.json()
      // The engine's own "couldn't form a hypothesis" fallback is the literal
      // string 'Unclear' — showing "we predict you'll choose Unclear" would be
      // worse than showing nothing.
      if (!d?.predictedChoice || d.predictedChoice === 'Unclear') throw new Error('no usable prediction')
      setPrediction({ predictedChoice: d.predictedChoice, reasoning: d.reasoning ?? '' })
      setPredictionStatus('ready')
    } catch (err) {
      console.error('[DecisionCheckpoint] prediction failed:', err)
      setPredictionStatus('failed')
    }
  }

  // The Examiner only has questions once the ontology tagger has finished, so
  // a null list means "not ready yet", not "nothing to ask". A short poll
  // keeps a slow tagger from silently skipping the quick-check step (which
  // would just push the same questions onto the session page instead).
  async function fetchExaminerQuestions(sid: string): Promise<ExaminerQuestion[]> {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const res  = await fetch(`/api/examiner?sessionId=${sid}`)
        const data = await res.json()
        if (Array.isArray(data?.questions)) return data.questions as ExaminerQuestion[]
      } catch { /* fall through to retry */ }
      await new Promise(r => setTimeout(r, 1500))
    }
    return []
  }

  async function confirmAndCreateSession(overrideText?: string) {
    setSubPhase('creating')
    try {
      const headers = { 'Content-Type': 'application/json', ...(await getAuthHeaders()) }   // Phase 0 fix: forwarded to POST /api/session so user_id is set for signed-in people
      let res: Response
      let data: { sessionId?: string; leanSaved?: boolean; resumed?: boolean; error?: string; inProgress?: boolean }
      // v9: if another request (a double-tap, a second tab) is mid-creation for this same decision, wait and ask again —
      // the server then resumes that session instead of making a second one.
      for (let attempt = 0; ; attempt++) {
        res  = await fetch('/api/chat-intake/checkpoint', { method: 'POST', headers, body: JSON.stringify({ chatIntakeId, editedDecisionText: overrideText }) })
        data = await res.json().catch(() => ({}))
        if (res.status === 409 && data?.inProgress && attempt < 4) { await new Promise(r => setTimeout(r, 1500)); continue }
        break
      }
      if (res.status === 429) {
        track('intake_checkpoint_error', { chat_intake_id: chatIntakeId, flow_version: state.flowVersion ?? INTAKE_FLOW_VERSION, stage: 'rate_limited' })
        setLaunchError(data?.error ?? 'Too many requests just now \u2014 give it a minute and tap again.')
        setSubPhase('reflect')
        return
      }
      if (!res.ok || !data.sessionId) throw new Error(data?.error || 'Failed to create session')
      setSessionId(data.sessionId)
      if (!data.resumed) track('decision_checkpointed', { signed_in: !!authToken, flow_version: state.flowVersion ?? null }, { sessionId: data.sessionId })

      // Everything below is fired in parallel, not awaited one after another.
      // The prediction starts the instant the session exists (its lean and
      // priority were copied on in the checkpoint route), so it's usually
      // ready by the time the reveal screen needs it.
      if (isUnifiedSessionEnabled() && data.leanSaved) {
        loadPrediction(data.sessionId)
      } else {
        setPredictionStatus('unavailable')
      }

      setInsightLoading(true)
      fetch('/api/chat-intake/insight', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ chatIntakeId }),
      })
        .then(r => r.json())
        .then(d => { if (d?.stakesLevel) setInsight(d as CheckpointInsight) })
        .catch(() => { /* the reveal just omits that line */ })
        .finally(() => setInsightLoading(false))

      const qs = await fetchExaminerQuestions(data.sessionId)
      setQuestions(qs)

      // Nothing left to ask: skip the quick-check step entirely.
      // v9: if the chat already covered EVERY question, show those answers on the reveal screen instead of a separate
      // step. They stay labelled "from chat" (derived_from_chat) and are only recorded when the person taps Convene
      // with them in view - the same one-tap confirmation as before, never recorded silently.
      const covered = qs.length > 0 && qs.every(q => q.derived && (q.derivedAnswer ?? '').trim())
      if (covered) {
        setConfirmed(Object.fromEntries(qs.map(q => [q.order, true])))
        setDerivedReview(true)
        setSubPhase('reveal')
      } else {
        setSubPhase(qs.length > 0 ? 'examine' : 'reveal')
      }
    } catch (err) {
      console.error('[DecisionCheckpoint] session creation failed:', err)
      track('intake_checkpoint_error', { chat_intake_id: chatIntakeId, flow_version: state.flowVersion ?? INTAKE_FLOW_VERSION })
      setLaunchError('That didn\u2019t go through. Tap again \u2014 nothing you entered is lost.')
      setSubPhase('reflect')
    }
  }

  // v9: one entry point for "That's right": saves the lean + priority (needed by the prediction), then creates the session.
  // Guarded so a double-tap or a retry can never run two creations at once; the server also resumes an existing session.
  async function onConfirm(overrideText?: string) {
    if (confirmInFlight.current) return
    confirmInFlight.current = true
    setLaunchError(null)
    try {
      if (unified && leanPick && priorityPick) {
        const res = await fetch('/api/chat-intake/lean', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chatIntakeId,
            initialInstinct:      leanPick.value,
            optimizationPriority: priorityPick,
            label:                leanPick.isUnsure ? null : leanPick.fullLabel,
          }),
        })
        if (!res.ok) throw new Error('lean save failed')
      }
      await confirmAndCreateSession(overrideText)
    } catch (err) {
      console.error('[DecisionCheckpoint] confirm failed:', err)
      track('intake_checkpoint_error', { chat_intake_id: chatIntakeId, flow_version: state.flowVersion ?? INTAKE_FLOW_VERSION })
      setLaunchError('That didn\u2019t save. Tap again \u2014 nothing you entered is lost.')
      setSubPhase('reflect')
    } finally {
      confirmInFlight.current = false
    }
  }

  // v9: fetch() does not throw on a 429 / 500, so the old version reported success whenever the network was up — a
  // failed save was invisible, and the scorers and the session page's readiness gate then worked from missing rows.
  // Now: the response is checked, a failed save is retried with a short back-off, and the caller is told the truth.
  async function submitExaminer(): Promise<boolean> {
    if (!sessionId) return false
    const responses = questions.map(q => ({
      question_text:       q.text,
      response_text:       q.derived && confirmed[q.order] ? q.derivedAnswer : (answers[q.order]?.trim() || null),
      question_order:      q.order,
      unknown_unknown_gap: q.gap,
      rule_id:             q.rule_id,
      criticality:         q.criticality,
      derived_from_chat:   !!(q.derived && confirmed[q.order]),
    }))
    if (responses.length === 0) return true
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch('/api/examiner', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ sessionId, responses }),
        })
        if (res.ok) return true
        console.error('[DecisionCheckpoint] examiner submit returned', res.status)
      } catch (err) {
        console.error('[DecisionCheckpoint] examiner submit failed:', err)
      }
      if (attempt < 2) await new Promise(r => setTimeout(r, 600 * (attempt + 1)))
    }
    return false
  }

  // One tap on the quick-check screen confirms every answer the chat already
  // covered (they're all on screen, above the button) and moves on.
  function handleExamineContinue() {
    setConfirmed(prev => {
      const next = { ...prev }
      questions.forEach(q => { if (q.derived) next[q.order] = true })
      return next
    })
    setSubPhase('reveal')
  }

  async function handleConveneCouncil() {
    // A critical question still blank would put the person at a "Not ready to
    // call" wall on the session page — send them back to answer it here,
    // where it takes one line, instead.
    if (councilBlocked) {
      setSubPhase('examine')
      return
    }
    // v9: the Council was REQUESTED. Whether it actually started is reported separately by the session page
    // (council_execution_started), so a failed hand-off is visible in the funnel instead of looking like a launch.
    track('council_launch_requested', {
      chat_intake_id:   chatIntakeId,
      flow_version:     state.flowVersion ?? null,
      derived_answers:  questions.filter(q => q.derived && confirmed[q.order]).length,
      typed_answers:    questions.filter(q => !q.derived && (answers[q.order] ?? '').trim()).length,
      derived_reviewed_on_reveal: derivedReview,
      lean_saved:       !!leanPick,
    }, { sessionId: sessionId ?? undefined })
    setSubPhase('submitting')
    // Let a still-running prediction land first (capped, so a slow search
    // can never trap someone on this screen) — the session page then loads
    // the saved one instead of generating a second, different answer.
    if (predictionInFlight.current) {
      await Promise.race([predictionInFlight.current, new Promise(r => setTimeout(r, 15000))])
    }
    const saved = await submitExaminer()
    if (!saved) {
      // Don't launch on rows that were never saved: the scorers and the session page's readiness gate read them.
      track('intake_checkpoint_error', { chat_intake_id: chatIntakeId, flow_version: state.flowVersion ?? INTAKE_FLOW_VERSION, stage: 'examiner_save' })
      setLaunchError('I couldn\u2019t save your answers just now. Tap again to retry \u2014 or continue and I\u2019ll ask anything still open on the next screen.')
      setSaveFailed(true)
      setSubPhase('reveal')
      return
    }
    onSessionCreated(sessionId!)
  }

  async function handleImDone() {
    setSubPhase('submitting')
    // Skip saving blank rows for a critical question: if the person changes
    // their mind on the next screen, the session page can still ask it,
    // instead of finding it already recorded as skipped.
    if (!councilBlocked) await submitExaminer()
    await fetch('/api/chat-intake/done', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        sessionId,
        nextAction: nextAction.trim() || undefined,
      }),
    })
    // Phase 0 fix: an "I'm done" session never visits /session/[id], which is
    // where SessionView adds the id to local history -- so these decisions
    // were missing from the on-device count, the hero cards and the prediction
    // tally. (Consent-gated, same as pushSessionId's other callers.)
    if (sessionId) pushSessionId(sessionId)
    track('decision_completed', { path: 'done' }, { sessionId })
    setSubPhase('done')
  }

  if (subPhase === 'loading' || subPhase === 'creating' || subPhase === 'submitting') {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)' }}>
        {subPhase === 'creating' ? "Working through it…" : subPhase === 'submitting' ? 'Saving…' : 'One moment…'}
      </div>
    )
  }

  if (subPhase === 'done') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 20, fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>Got it — saved.</div>
        <div style={{ color: 'var(--text-3)', fontSize: 14.5, maxWidth: 340 }}>
          This is part of your Quorum history now, whether or not you dig deeper.
        </div>
        {predictionStatus === 'ready' && prediction && (
          <div style={{ color: 'var(--text-2)', fontSize: 14.5, maxWidth: 340, lineHeight: 1.5 }}>
            We predicted you'd choose <strong style={{ color: 'var(--text-1)' }}>{prediction.predictedChoice}</strong>. Curious whether the Council sees it the same way?
          </div>
        )}
        {/* Second chance, now the primary action: the session and every
            answer already exist, so this is pure navigation — nothing to
            re-submit (handleImDone already did, unless a critical question
            was still open, in which case the session page asks it). */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 300 }}>
          <button style={primaryBtn} onClick={() => sessionId && onSessionCreated(sessionId)}>
            Actually, convene the Council
          </button>
          <div style={{ fontSize: 12.5, color: 'var(--text-4)', marginTop: -4 }}>About a minute</div>
        </div>

        {/* Phase 1: replaces the faint "Start a new decision" reload link.
            Council stays the primary action above (deliberate -- see the
            note on the Convene button); this block is the continuity layer:
            tally, why another decision helps, park/bring-it-now, and the
            soft "keep my record" card. */}
        <div style={{ width: '100%', maxWidth: 340, marginTop: 12 }}>
          <NextDecisionPrompt
            surface="done_screen"
            emphasis="secondary"
            sessionId={sessionId}
            onBringNow={(t) => {
              if (onNewDecision) { onNewDecision(t); return }
              setDecisionPrefill(t)
              window.location.reload()
            }}
          />
        </div>
      </div>
    )
  }

  const container: CSSProperties = {
    flex: 1, maxWidth: 560, margin: '0 auto', width: '100%',
    padding: '28px 20px calc(20px + env(safe-area-inset-bottom, 0px))',
    display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto',
  }

  if (subPhase === 'reflect' || subPhase === 'editing') {
    // v8: a short, honest list of what the person actually told us (their own words / taps) — never Quorum's inference.
    const prov      = summaryProvenance(state)
    const readiness = councilReadiness(state)
    const canConfirm = !unified || (!!leanPick && !!priorityPick)
    const chip = (sel: boolean): CSSProperties => ({
      padding: '9px 14px', borderRadius: 999, fontSize: 14.5, lineHeight: 1.3, textAlign: 'left', cursor: 'pointer',
      border: sel ? '2px solid var(--gold)' : '1px solid var(--border-mid)',
      background: sel ? 'var(--gold-dim)' : 'var(--bg-card)', color: sel ? 'var(--text-1)' : 'var(--text-2)',
    })
    const block = (title: string, children: ReactNode) => (
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-4)', marginBottom: 4 }}>{title}</div>
        {children}
      </div>
    )
    const ul: CSSProperties = { margin: 0, paddingLeft: 18, fontSize: 14.5, color: 'var(--text-2)', display: 'flex', flexDirection: 'column', gap: 2 }
    return (
      <div style={container}>
        <div style={{ color: 'var(--text-3)', fontSize: 13.5, letterSpacing: 0.3 }}>Here's the decision I think you're actually making</div>

        {subPhase === 'reflect' ? (
          <div style={cardStyle}>
            <div role="status" style={{ fontSize: 14, color: 'var(--text-1)', marginBottom: 12 }}>{readinessLine(readiness)}</div>
            {!!original && original !== editedText && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12.5, color: 'var(--text-4)', marginBottom: 4 }}>You started with</div>
                <div style={{ fontSize: 14.5, color: 'var(--text-2)', fontStyle: 'italic' }}>{'\u201C'}{original.length > 200 ? `${original.slice(0, 197)}\u2026` : original}{'\u201D'}</div>
              </div>
            )}
            <div style={{ fontSize: 18, fontFamily: 'var(--font-display)', color: 'var(--text-1)', marginBottom: 14 }}>
              {editedText || 'The decision, once I have enough to name it'}
            </div>
            {prov.youTold.length > 0 && block('What you told me', (
              <ul style={ul}>{prov.youTold.map((r, i) => <li key={`t${i}`}>{r.label}: <ExpandableText text={r.value} full={fullAnswerFor(r.value, userMessages)} /></li>)}</ul>
            ))}
            {prov.youChose.length > 0 && block('What you chose', (
              <ul style={ul}>{prov.youChose.map((r, i) => <li key={`c${i}`}>{r.label}: {r.values.join('; ')}{r.addedWords ? ' (plus your own words)' : ''}</li>)}</ul>
            ))}
            {prov.myReading.length > 0 && block('My reading \u2014 provisional, correct anything that\u2019s off', (
              <ul style={ul}>{prov.myReading.map((r, i) => <li key={`m${i}`}>{r}</li>)}</ul>
            ))}
            {prov.notKnown.length > 0 && block('Still open', (
              <ul style={ul}>{prov.notKnown.map((r, i) => (
                <li key={`n${i}`}>{r.label}{r.why === 'not_asked' ? ' \u2014 not asked; I\u2019ll flag it to the Council' : r.why === 'skipped' ? ' \u2014 you skipped this' : r.why === 'gap' ? ' \u2014 still open, I won\u2019t guess' : ' \u2014 not known yet'}</li>
              ))}</ul>
            ))}
            {state.stakeholders?.some(x => !/^(you|me|myself|i)$/i.test(x.name.trim())) && (
              <div>
                <div style={{ fontSize: 12.5, color: 'var(--text-4)', marginBottom: 4 }}>Who's involved</div>
                <div style={{ fontSize: 14.5, color: 'var(--text-2)' }}>{state.stakeholders.filter(x => !/^(you|me|myself|i)$/i.test(x.name.trim())).map(s => s.name).join(', ')}</div>
              </div>
            )}
          </div>
        ) : (
          <textarea
            aria-label="The decision, in your words"
            value={editedText}
            onChange={e => setEditedText(e.target.value)}
            rows={3}
            autoFocus
            style={{
              padding: 14, borderRadius: 14, border: '1px solid var(--border-mid)',
              background: 'var(--bg-inset)', color: 'var(--text-1)', fontSize: 16,
              fontFamily: 'var(--font-body)', resize: 'vertical',
            }}
          />
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
          {subPhase === 'reflect' && (
            <div style={{ fontSize: 13, color: 'var(--text-3)' }}>This is my current understanding. Correct anything that doesn{'\u2019'}t feel right.</div>
          )}
          {unified && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0' }}>
              <div role="group" aria-labelledby="lean-q">
                <div id="lean-q" style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--text-1)', marginBottom: 8 }}>Where are you leaning?</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {buildLeanChoices(state.options).map((c, i) => {
                    const sel = leanPick?.fullLabel === c.fullLabel
                    const clipped = !c.isUnsure && c.fullLabel !== c.label
                    // Clipped on a phone by default; the full wording opens in place (automatically once chosen, or via the "+" control).
                    const open = clipped && (leanOpen[i] ?? sel)
                    return (
                      <span key={`${i}-${c.fullLabel}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%' }}>
                        <button type="button" title={c.fullLabel} aria-pressed={sel} onClick={() => setLeanPick(c)} style={chip(sel)}>{open ? c.fullLabel : c.label}</button>
                        {clipped && (
                          <button type="button" aria-expanded={open} aria-label={open ? 'Show shorter wording' : 'Show full wording'}
                            onClick={() => setLeanOpen(o => ({ ...o, [i]: !open }))}
                            style={{ background: 'none', border: 'none', minWidth: 32, minHeight: 32, fontSize: 15, color: 'var(--text-3)', cursor: 'pointer' }}>{open ? '\u2212' : '+'}</button>
                        )}
                      </span>
                    )
                  })}
                </div>
              </div>
              <div role="group" aria-labelledby="prio-q">
                <div id="prio-q" style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--text-1)', marginBottom: 8 }}>What matters most here?</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {PRIORITIES.map(pr => (
                    <button key={pr.value} type="button" aria-pressed={priorityPick === pr.value}
                      onClick={() => setPriorityPick(pr.value)} style={chip(priorityPick === pr.value)}>{pr.label}</button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {/* one-tap quality signal: did this capture what they are really deciding? (an id, never text) */}
          <div role="group" aria-label="Did this capture what you are really deciding?" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--text-3)' }}>
            <span>Did this capture what you{'\u2019'}re really deciding?</span>
            {(['yes', 'partly', 'no'] as const).map(v => (
              <button key={v} type="button" aria-pressed={feedback === v} disabled={feedback !== null}
                onClick={() => { setFeedback(v); track('intake_summary_feedback', { chat_intake_id: chatIntakeId, flow_version: state.flowVersion ?? null, captured: v }) }}
                style={{ ...chip(feedback === v), padding: '6px 12px', fontSize: 13.5, opacity: feedback !== null && feedback !== v ? 0.5 : 1 }}>
                {v === 'yes' ? 'Yes' : v === 'partly' ? 'Partly' : 'Not really'}
              </button>
            ))}
          </div>
          {launchError && <div role="alert" style={{ fontSize: 13.5, color: 'var(--text-1)' }}>{launchError}</div>}
          <button
            style={{ ...primaryBtn, ...(canConfirm ? {} : { background: 'var(--border-dim)', color: 'var(--text-4)', cursor: 'default' }) }}
            aria-disabled={!canConfirm}
            onClick={() => {
              if (!canConfirm) { setLaunchError('Pick where you\u2019re leaning and what matters most \u2014 it helps me predict, and it\u2019s saved before you see my read.'); return }
              const edited = subPhase === 'editing' && editedText.trim() !== (state.decisionStatement ?? '').trim()
              track('intake_summary_action', { chat_intake_id: chatIntakeId, flow_version: state.flowVersion ?? null, action: 'confirm', edited })
              if (subPhase === 'editing') onConfirm(editedText)
              else onConfirm()
            }}
          >
            That{'\u2019'}s right
          </button>
          {subPhase === 'reflect' && (
            <button style={secondaryBtn} onClick={() => { track('intake_summary_action', { chat_intake_id: chatIntakeId, action: 'edit' }); setSubPhase('editing') }}>Not quite — let me fix it</button>
          )}
          <button style={{ ...secondaryBtn, border: 'none', color: 'var(--text-4)' }} onClick={() => { track('intake_summary_action', { chat_intake_id: chatIntakeId, action: 'add_more' }); onBackToChat() }}>
            Let me add more first
          </button>
        </div>
      </div>
    )
  }

  const labelStyle: CSSProperties = {
    fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em',
    textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 12,
  }

  // ── subPhase === 'examine' — the quick check ────────────────────────────────
  // Only reached when the Examiner has something to ask. Chat-covered answers
  // sit together in one card behind a single "These look right" tap; only
  // genuine gaps get a text box.
  if (subPhase === 'examine') {
    const derivedQs = questions.filter(q => q.derived)
    const openQs    = questions.filter(q => !q.derived)
    const buttonLabel =
      derivedQs.length > 0 && openQs.length === 0 ? 'These look right'
      : derivedQs.length > 0                      ? 'These look right — continue'
      : 'Continue'

    return (
      <div style={container}>
        <div style={{ color: 'var(--text-3)', fontSize: 13.5, letterSpacing: 0.3 }}>
          {derivedQs.length > 0 && openQs.length === 0 ? 'Did I get this right?' : 'A quick check before we go on'}
        </div>

        {derivedQs.length > 0 && (
          <div style={cardStyle}>
            <div style={labelStyle}>What you've already told me</div>
            {derivedQs.map((q, i) => (
              <div key={q.order} style={{ marginBottom: i === derivedQs.length - 1 ? 0 : 16 }}>
                <div style={{ fontSize: 12.5, color: 'var(--text-4)', marginBottom: 4 }}>{q.text}</div>
                <div style={{ fontSize: 14.5, color: 'var(--text-1)', lineHeight: 1.5 }}>“{q.derivedAnswer}”</div>
                <button
                  type="button"
                  onClick={() => setQuestions(prev => prev.map(pq => pq.order === q.order ? { ...pq, derived: false } : pq))}
                  style={{ background: 'none', border: 'none', padding: 0, marginTop: 6, fontSize: 12.5, color: 'var(--text-4)', cursor: 'pointer', textDecoration: 'underline' }}
                >
                  Change this
                </button>
              </div>
            ))}
          </div>
        )}

        {openQs.map(q => (
          <div key={q.order} style={cardStyle}>
            {isCouncilCritical(q) && (
              <div style={{ ...labelStyle, color: 'var(--gold)', marginBottom: 8 }}>Needed for the Council to run</div>
            )}
            <div style={{ fontSize: 15, color: 'var(--text-1)', marginBottom: 10 }}>{q.text}</div>
            <textarea
              value={answers[q.order] ?? ''}
              onChange={e => setAnswers(prev => ({ ...prev, [q.order]: e.target.value }))}
              rows={2}
              placeholder={isCouncilCritical(q) ? 'Your answer' : 'Your answer (optional)'}
              style={{
                width: '100%', padding: 12, borderRadius: 12, border: '1px solid var(--border-mid)',
                background: 'var(--bg-inset)', color: 'var(--text-1)', fontSize: 15,
                fontFamily: 'var(--font-body)', resize: 'vertical',
              }}
            />
          </div>
        ))}

        <button style={primaryBtn} onClick={handleExamineContinue}>{buttonLabel}</button>
      </div>
    )
  }

  // ── subPhase === 'reveal' — Quorum's read, then the one real choice ─────────
  const leanText =
    state.chosenLeanLabel?.trim() || (state.chosenLean === 'unsure' ? 'Not sure yet' : null)
  const showPredictionCard = predictionStatus !== 'unavailable'

  return (
    <div style={container}>
      <div style={{ color: 'var(--text-3)', fontSize: 13.5, letterSpacing: 0.3 }}>Before the Council weighs in</div>

      <div style={cardStyle}>
        {showPredictionCard && (
          <>
            {leanText && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12.5, color: 'var(--text-4)', marginBottom: 4 }}>You lean</div>
                <div style={{ fontSize: 15.5, color: 'var(--text-2)' }}>{leanText}</div>
              </div>
            )}
            <div>
              <div style={{ fontSize: 12.5, color: 'var(--text-4)', marginBottom: 6 }}>We predict you'll choose</div>
              {predictionStatus === 'ready' && prediction ? (
                <>
                  <div style={{ fontSize: 20, fontFamily: 'var(--font-display)', color: 'var(--text-1)', lineHeight: 1.3, marginBottom: 8 }}>
                    {prediction.predictedChoice}
                  </div>
                  {!!prediction.reasoning && (
                    <div style={{ fontSize: 14.5, color: 'var(--text-2)', lineHeight: 1.55 }}>{prediction.reasoning}</div>
                  )}
                </>
              ) : predictionStatus === 'failed' ? (
                <div style={{ fontSize: 14.5, color: 'var(--text-3)', lineHeight: 1.55 }}>
                  We couldn't form a read on this one yet — the Council can still weigh in.
                </div>
              ) : (
                <div style={{ fontSize: 14, color: 'var(--text-4)', fontStyle: 'italic' }}>Reading your situation…</div>
              )}
            </div>
          </>
        )}

        {/* One bridging line from the adaptive read (lib/chat-intake-insight.ts)
            — it either gives a real early verdict for a low-stakes call or
            names why THIS decision would benefit from more perspectives. */}
        {(insight || insightLoading) && (
          <div style={{ marginTop: showPredictionCard ? 16 : 0, paddingTop: showPredictionCard ? 16 : 0, borderTop: showPredictionCard ? '1px solid var(--border-dim)' : 'none' }}>
            {insight ? (
              <>
                <div style={{ fontSize: 12.5, color: 'var(--text-4)', marginBottom: 6 }}>
                  {insight.stakesLevel === 'low' ? "Quorum's early read" : 'Worth a closer look, because'}
                </div>
                <div style={{ fontSize: 14.5, color: 'var(--text-1)', lineHeight: 1.55 }}>{insight.message}</div>
              </>
            ) : (
              <div style={{ fontSize: 13.5, color: 'var(--text-4)', fontStyle: 'italic' }}>Reading this a little closer…</div>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Convene is ALWAYS the primary action now — previously a "low
            stakes" early read flipped "I'm done" to primary, which is where
            people left before the Council ever ran. A low-stakes read is
            still shown above; it just doesn't change which button is loudest. */}
        {derivedReview && questions.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, color: 'var(--text-4)', marginBottom: 4 }}>Taken from what you told me (not asked again)</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, color: 'var(--text-2)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {questions.map(q => (
                <li key={q.order}>
                  <span style={{ display: 'block', color: 'var(--text-3)', fontSize: 13 }}>{q.text}</span>
                  {q.derivedAnswer}
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => { setDerivedReview(false); setConfirmed({}); setSubPhase('examine') }}
              style={{ background: 'none', border: 'none', padding: '6px 0', fontSize: 13, color: 'var(--text-3)', textDecoration: 'underline', cursor: 'pointer' }}>
              Change any of these
            </button>
          </div>
        )}
        {launchError && <div role="alert" style={{ fontSize: 13.5, color: 'var(--text-1)', marginBottom: 10 }}>{launchError}</div>}
        <button style={primaryBtn} onClick={handleConveneCouncil}>
          {councilBlocked ? 'Answer one quick question first' : 'Convene the Council'}
        </button>
        {saveFailed && (
          <button type="button" onClick={() => { track('intake_checkpoint_error', { chat_intake_id: chatIntakeId, flow_version: state.flowVersion ?? INTAKE_FLOW_VERSION, stage: 'examiner_save_continue' }); onSessionCreated(sessionId!) }}
            style={{ ...secondaryBtn, marginTop: 8 }}>
            Continue anyway
          </button>
        )}
        <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5, textAlign: 'center' }}>
          {councilBlocked
            ? 'The Council needs that one answer before it can run.'
            : "See how six different perspectives read this against what you're leaning toward. About a minute."}
        </div>

        {!showNextAction ? (
          <button
            type="button"
            onClick={() => setShowNextAction(true)}
            style={{ background: 'none', border: 'none', padding: '6px 0', fontSize: 13.5, color: 'var(--text-4)', cursor: 'pointer', textDecoration: 'underline' }}
          >
            I'm done
          </button>
        ) : (
          <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13.5, color: 'var(--text-3)' }}>Anything you're actually going to do next? (optional)</div>
            <input
              value={nextAction}
              onChange={e => setNextAction(e.target.value)}
              placeholder="e.g. Talk to my co-founder before Friday"
              style={{
                padding: 12, borderRadius: 12, border: '1px solid var(--border-mid)',
                background: 'var(--bg-inset)', color: 'var(--text-1)', fontSize: 15,
              }}
            />
            <button style={secondaryBtn} onClick={handleImDone}>Done</button>
          </div>
        )}
      </div>

      {/* Phase 2/3, v2 — only appears when the chat actually named someone;
          never a standing "Integrations" menu (plan section 22). Sits below
          the actions on purpose so it can't push Convene off screen. */}
      {!!state.stakeholders?.length && sessionId && (
        <StakeholderOutreach sessionId={sessionId} stakeholders={state.stakeholders} authToken={authToken} />
      )}
    </div>
  )
}
