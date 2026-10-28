'use client'

// components/DecisionCheckpoint.tsx
// ── Natural Intake — the confirm screen (v10: shortened journey) ──────────────
//
// v10 flow (see docs/CHANGELOG_v10.md). The goal: get a brand-new person to the Council in as few screens as
// possible without losing what the Council and Mirror need. Moments, in order:
//   1. One short confirm screen — the decision in a sentence, the two taps the session page requires (where you
//      lean, what matters most), and ONE primary button: Convene the Council. Everything else (what you told me,
//      what you chose, my reading) is folded behind "See what I understood".
//   2. Convene creates the session (POST /api/chat-intake/checkpoint, which copies the lean + priority onto it),
//      waits briefly for the Examiner's questions, and records them (lib/checkpoint-launch.ts):
//        • chat-covered answers to non-critical questions are recorded "from chat" without a screen;
//        • other non-critical questions are recorded blank — the Council is told they are unresolved;
//        • ONLY a critical question (one the Council cannot run without) is shown, as "one thing before the
//          Council runs". If there is none, the person goes straight to the Council.
//   3. Quorum's prediction is no longer shown or waited for here. SessionView makes it quietly (QuorumPrediction
//      with hidden) and the person first sees it after they decide (PredictionReveal).
//   4. "I'm done" and "Want to hear from <name> first?" are small links on the confirm screen. Outreach needs a
//      saved decision to attach to, so tapping it saves the decision first (exactly as Convene would).
//
// Deliberately does NOT render the Structural Read visualization or the six-persona grid — those stay exactly as
// SessionView.tsx already renders them, reached only via "Convene the Council".
//
// No internal terms ("Examiner", "rule_id", "structural read") ever reach this component's copy — see
// docs/COPY_AND_STRUCTURE_LOCK_v1.md.

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { ChatDecisionState } from '@/lib/types'
import { isUnifiedSessionEnabled } from '@/lib/feature-flags'
import { createClient } from '@/lib/supabase'
import { getAuthHeaders } from '@/lib/auth-headers'      // Phase 0: send the token on checkpoint
import { pushSessionId } from '@/lib/storage'            // Phase 0: "I'm done" sessions must reach local history
import { track } from '@/lib/track'                      // Phase 0: first-party events
import { buildLeanChoices, matchSavedLean, PRIORITIES } from '@/lib/chat-intake-lean'   // v9: lean + priority live on this screen
import type { LeanChoice } from '@/lib/chat-intake-lean'
import { INTAKE_FLOW_VERSION, councilReadiness, fullAnswerFor, readinessLine, summaryProvenance } from '@/lib/chat-intake-depth'
import { suggestPriority } from '@/lib/chat-intake-priority'              // v11: a one-tap-fewer suggestion for "what matters most"
import ExpandableText from '@/components/ExpandableText'
import { viewportBucket } from '@/lib/chat-intake-cards'   // v9: readiness + provenance
import { intakeReadiness } from '@/lib/chat-intake-cards'    // v8: readiness marker
import NextDecisionPrompt from '@/components/NextDecisionPrompt'  // Phase 1: continuity ending
import { setDecisionPrefill } from '@/lib/prefill'
import StakeholderOutreach from '@/components/StakeholderOutreach'   // Phase 2/3, v2
import { realStakeholders } from '@/lib/real-stakeholders'            // v10: never offer to "ask You"
import {
  autoConfirmed, blockingQuestions, buildExaminerRows, isCouncilCritical, isResolved,
  type CheckpointQuestion,
} from '@/lib/checkpoint-launch'                                       // v10: which questions are ever shown

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

type SubPhase = 'loading' | 'reflect' | 'editing' | 'creating' | 'examine' | 'outreach' | 'submitting' | 'done'
// What the person is in the middle of, so the waiting screen says the right thing.
type LaunchMode = 'convene' | 'done' | 'outreach'

interface PredictionView {
  predictedChoice: string
  reasoning:       string
}

// Only used on the "I'm done" ending, where the person chose not to convene and a prediction is the payoff.
// 'unavailable' = this session can't have a prediction (unified flag off, or an older in-flight chat).
type PredictionStatus = 'idle' | 'loading' | 'ready' | 'failed' | 'unavailable'

const LEAN_HINT = 'Pick where you\u2019re leaning and what matters most first \u2014 both are saved before the Council speaks, so nothing it says can sway them.'

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

const linkBtn: CSSProperties = {
  background: 'none', border: 'none', padding: '6px 0', fontSize: 13.5,
  color: 'var(--text-4)', cursor: 'pointer', textDecoration: 'underline',
}

export default function DecisionCheckpoint({ chatIntakeId, onBackToChat, onSessionCreated, onNewDecision }: Props) {
  const [subPhase, setSubPhase]     = useState<SubPhase>('loading')
  const [launchMode, setLaunchMode] = useState<LaunchMode>('convene')
  const [state, setState]           = useState<ChatDecisionState>({})
  const [editedText, setEditedText] = useState('')
  const [original, setOriginal]       = useState('')    // v8: the person's own first words, shown beside the refined decision
  const summaryTracked = useRef(false)
  // v9: lean + priority are part of the one confirmation. The session page refuses to start without them
  // (its own lean gate), so they stay required here rather than being asked again on the next screen.
  const unified = isUnifiedSessionEnabled()
  const [leanPick, setLeanPick]         = useState<LeanChoice | null>(null)
  const [priorityPick, setPriorityPick] = useState<string | null>(null)
  // v11: "what matters most" arrives pre-selected when the person's own words make it clear (lib/chat-intake-priority.ts).
  // It is only a suggestion — labelled as one, one tap to change — and is saved by their tap on Convene.
  const [prioritySuggested, setPrioritySuggested] = useState<string | null>(null)
  const priorityTouched = useRef(false)
  const [launchError, setLaunchError]   = useState<string | null>(null)
  const [examineError, setExamineError] = useState<string | null>(null)
  const [userMessages, setUserMessages] = useState<string[]>([])         // the person's own messages, to expand clipped answers
  const [leanOpen, setLeanOpen]         = useState<Record<number, boolean>>({})   // lean choices expanded to their full wording
  const [detailsOpen, setDetailsOpen]   = useState(false)               // v10: "See what I understood" is folded by default
  const [saveFailed, setSaveFailed]   = useState(false)         // the Examiner save failed 3 times: offer "continue anyway"
  const confirmInFlight = useRef(false)                         // a second tap / double-click can never start a second creation
  const [sessionId, setSessionId]   = useState<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)              // read by retries so a second attempt never re-saves the lean on a closed chat
  const leanSavedRef = useRef(false)
  const [questions, setQuestions]   = useState<CheckpointQuestion[]>([])
  const [answers, setAnswers]       = useState<Record<number, string>>({})
  const [confirmed, setConfirmed]   = useState<Record<number, boolean>>({})
  const [nextAction, setNextAction] = useState('')
  const [showNextAction, setShowNextAction] = useState(false)
  const [authToken, setAuthToken]   = useState<string | null>(null)
  const [prediction, setPrediction]           = useState<PredictionView | null>(null)
  const [predictionStatus, setPredictionStatus] = useState<PredictionStatus>('idle')
  // The in-flight prediction request ("I'm done" path only), so "Actually, convene the Council" can wait for it
  // instead of racing the session page's own request — two concurrent first calls would each make their own answer.
  const predictionInFlight = useRef<Promise<void> | null>(null)

  const canConfirm = !unified || (!!leanPick && !!priorityPick)

  // Needed so the "I'm done" prediction call can attribute the session to a signed-in user.
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
        const savedPriority = s.optimizationPriority ?? null
        setPriorityPick(savedPriority)
        if (!savedPriority) {
          const suggested = suggestPriority(((d.messages ?? []) as { role: string; content: string }[]).filter(m => m.role === 'user').map(m => m.content))
          if (suggested) { setPriorityPick(suggested); setPrioritySuggested(suggested) }
        }
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

  // Quorum's prediction — "I'm done" path only. Idempotent server-side, so a retry can't bill a second call.
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
      // The engine's own "couldn't form a hypothesis" fallback is the literal string 'Unclear' — showing
      // "we predict you'll choose Unclear" would be worse than showing nothing.
      if (!d?.predictedChoice || d.predictedChoice === 'Unclear') throw new Error('no usable prediction')
      setPrediction({ predictedChoice: d.predictedChoice, reasoning: d.reasoning ?? '' })
      setPredictionStatus('ready')
    } catch (err) {
      console.error('[DecisionCheckpoint] prediction failed:', err)
      setPredictionStatus('failed')
    }
  }

  // The Examiner only has questions once the ontology tagger has finished, so a null list means "not ready yet",
  // not "nothing to ask". The request asks the server to hold for up to ~5 s and answer the moment the tagger is done
  // (?wait=1, v11) instead of polling every second; a short retry covers a server that doesn't support it or a slow
  // tagger. Same ~10 s ceiling as before; if it is still not ready the session page asks, as it always has.
  async function loadQuestions(sid: string): Promise<CheckpointQuestion[]> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res  = await fetch(`/api/examiner?sessionId=${sid}&wait=1`)
        const data = await res.json()
        if (Array.isArray(data?.questions)) return data.questions as CheckpointQuestion[]
      } catch { /* fall through to retry */ }
      await new Promise(r => setTimeout(r, 500))
    }
    return []
  }

  // Saves the lean + priority (once), then creates — or resumes — the session. Returns null when the person was
  // told why it did not happen (rate limit); throws on any other failure so the caller can show its own message.
  async function ensureSession(overrideText?: string): Promise<string | null> {
    if (sessionIdRef.current) return sessionIdRef.current   // already created: a retry must not re-save the lean on a closed chat

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
      return null
    }
    if (!res.ok || !data.sessionId) throw new Error(data?.error || 'Failed to create session')
    sessionIdRef.current = data.sessionId
    leanSavedRef.current = !!data.leanSaved
    setSessionId(data.sessionId)
    if (!data.resumed) track('decision_checkpointed', { signed_in: !!authToken, flow_version: state.flowVersion ?? null }, { sessionId: data.sessionId })
    return data.sessionId
  }

  // v9: fetch() does not throw on a 429 / 500, so the old version reported success whenever the network was up — a
  // failed save was invisible, and the scorers and the session page's readiness gate then worked from missing rows.
  // Now: the response is checked, a failed save is retried with a short back-off, and the caller is told the truth.
  async function saveExaminerRows(sid: string, rows: ReturnType<typeof buildExaminerRows>): Promise<boolean> {
    if (rows.length === 0) return true
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch('/api/examiner', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ sessionId: sid, responses: rows }),
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

  // Records the questions and hands off to the session page. Everything is passed in explicitly: this is called
  // straight after state was set, so reading React state here would see the previous render's values.
  async function launch(sid: string, qs: CheckpointQuestion[], conf: Record<number, boolean>, ans: Record<number, string>): Promise<void> {
    const rows = buildExaminerRows(qs, conf, ans)
    // v9: the Council was REQUESTED. Whether it actually started is reported separately by the session page
    // (council_execution_started), so a failed hand-off is visible in the funnel instead of looking like a launch.
    track('council_launch_requested', {
      chat_intake_id:   chatIntakeId,
      flow_version:     state.flowVersion ?? null,
      derived_answers:  rows.filter(r => r.derived_from_chat).length,
      typed_answers:    rows.filter(r => !r.derived_from_chat && !!r.response_text).length,
      check_shown:      qs.some(isCouncilCritical),                 // v10: was the one-question check put in front of the person?
      auto_recorded:    Object.keys(autoConfirmed(qs)).length,      // v10: chat-covered answers recorded without a screen
      lean_saved:       !!leanPick,
      priority_source:  !prioritySuggested ? 'chosen' : priorityPick !== prioritySuggested ? 'changed' : priorityTouched.current ? 'chosen' : 'suggested',   // v11
    }, { sessionId: sid })
    setLaunchMode('convene')
    setSubPhase('submitting')
    const saved = await saveExaminerRows(sid, rows)
    if (!saved) {
      // Don't launch on rows that were never saved: the scorers and the session page's readiness gate read them.
      track('intake_checkpoint_error', { chat_intake_id: chatIntakeId, flow_version: state.flowVersion ?? INTAKE_FLOW_VERSION, stage: 'examiner_save' })
      setLaunchError('I couldn\u2019t save your answers just now. Tap again to retry \u2014 or continue and I\u2019ll ask anything still open on the next screen.')
      setSaveFailed(true)
      setSubPhase('reflect')
      return
    }
    onSessionCreated(sid)
  }

  // The one entry point for "Convene the Council". Guarded so a double-tap or a retry can never run two creations
  // at once; the server also resumes an existing session.
  async function handleConvene(overrideText?: string) {
    if (confirmInFlight.current) return
    confirmInFlight.current = true
    setLaunchError(null)
    setExamineError(null)
    setSaveFailed(false)
    setLaunchMode('convene')
    setSubPhase('creating')
    try {
      const sid = await ensureSession(overrideText)
      if (!sid) { setSubPhase('reflect'); return }
      const qs   = await loadQuestions(sid)
      const conf = { ...autoConfirmed(qs), ...confirmed }
      setQuestions(qs)
      setConfirmed(conf)
      // Only a critical question still open sends the person to a screen; everything else is recorded as-is.
      if (blockingQuestions(qs, conf, answers).length > 0) { setSubPhase('examine'); return }
      await launch(sid, qs, conf, answers)
    } catch (err) {
      console.error('[DecisionCheckpoint] convene failed:', err)
      track('intake_checkpoint_error', { chat_intake_id: chatIntakeId, flow_version: state.flowVersion ?? INTAKE_FLOW_VERSION })
      setLaunchError('That didn\u2019t go through. Tap again \u2014 nothing you entered is lost.')
      setSubPhase('reflect')
    } finally {
      confirmInFlight.current = false
    }
  }

  // The single critical question was answered (or the chat's answer confirmed) — record everything and go.
  async function handleExamineContinue() {
    if (confirmInFlight.current || !sessionId) return
    const next = { ...confirmed }
    // The chat-covered critical answers are on screen above the button; tapping it confirms them.
    for (const q of questions) if (isCouncilCritical(q) && q.derived) next[q.order] = true
    if (blockingQuestions(questions, next, answers).length > 0) {
      setExamineError('The Council needs that one answer before it can run.')
      return
    }
    confirmInFlight.current = true
    setExamineError(null)
    setConfirmed(next)
    try {
      await launch(sessionId, questions, next, answers)
    } catch (err) {
      console.error('[DecisionCheckpoint] launch failed:', err)
      setLaunchError('That didn\u2019t go through. Tap again \u2014 nothing you entered is lost.')
      setSubPhase('reflect')
    } finally {
      confirmInFlight.current = false
    }
  }

  // "Want to hear from <name> first?" — outreach attaches to a saved decision, so this saves it first (exactly what
  // Convene would do), then shows the outreach card above a Convene button.
  async function handleOutreach() {
    if (confirmInFlight.current) return
    if (!sessionIdRef.current && !canConfirm) { setLaunchError(LEAN_HINT); return }
    confirmInFlight.current = true
    const override = subPhase === 'editing' ? editedText : undefined
    setLaunchError(null)
    setLaunchMode('outreach')
    setSubPhase('creating')
    track('intake_summary_action', { chat_intake_id: chatIntakeId, flow_version: state.flowVersion ?? null, action: 'outreach' })
    try {
      const sid = await ensureSession(override)
      setSubPhase(sid ? 'outreach' : 'reflect')
    } catch (err) {
      console.error('[DecisionCheckpoint] outreach save failed:', err)
      track('intake_checkpoint_error', { chat_intake_id: chatIntakeId, flow_version: state.flowVersion ?? INTAKE_FLOW_VERSION })
      setLaunchError('That didn\u2019t save. Tap again \u2014 nothing you entered is lost.')
      setSubPhase('reflect')
    } finally {
      confirmInFlight.current = false
    }
  }

  async function handleImDone() {
    if (confirmInFlight.current) return
    if (!sessionIdRef.current && !canConfirm) { setLaunchError(LEAN_HINT); return }
    confirmInFlight.current = true
    const override = subPhase === 'editing' ? editedText : undefined
    setLaunchError(null)
    setLaunchMode('done')
    setSubPhase('submitting')
    try {
      const sid = await ensureSession(override)
      if (!sid) { setSubPhase('reflect'); return }
      const qs   = questions.length > 0 ? questions : await loadQuestions(sid)
      const conf = { ...autoConfirmed(qs), ...confirmed }
      setQuestions(qs)
      setConfirmed(conf)
      // Skip saving blank rows while a critical question is open: if the person changes their mind on the next
      // screen, the session page can still ask it, instead of finding it already recorded as skipped.
      if (blockingQuestions(qs, conf, answers).length === 0) await saveExaminerRows(sid, buildExaminerRows(qs, conf, answers))
      await fetch('/api/chat-intake/done', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          sessionId: sid,
          nextAction: nextAction.trim() || undefined,
        }),
      })
      // Phase 0 fix: an "I'm done" session never visits /session/[id], which is where SessionView adds the id to
      // local history -- so these decisions were missing from the on-device count, the hero cards and the
      // prediction tally. (Consent-gated, same as pushSessionId's other callers.)
      pushSessionId(sid)
      track('decision_completed', { path: 'done' }, { sessionId: sid })
      // The person chose not to convene: Quorum's prediction is the payoff on the "saved" screen (it fills in when ready).
      if (unified && leanSavedRef.current) loadPrediction(sid)
      else setPredictionStatus('unavailable')
      setSubPhase('done')
    } catch (err) {
      console.error('[DecisionCheckpoint] done failed:', err)
      track('intake_checkpoint_error', { chat_intake_id: chatIntakeId, flow_version: state.flowVersion ?? INTAKE_FLOW_VERSION })
      setLaunchError('That didn\u2019t save. Tap again \u2014 nothing you entered is lost.')
      setSubPhase('reflect')
    } finally {
      confirmInFlight.current = false
    }
  }

  // "Actually, convene the Council" on the saved screen. The session and every answer already exist, so this is
  // navigation — but a prediction still running must land first, or the session page would start a second one.
  async function handleConveneFromDone() {
    if (!sessionId) return
    setLaunchMode('convene')
    setSubPhase('submitting')
    if (predictionInFlight.current) {
      await Promise.race([predictionInFlight.current, new Promise(r => setTimeout(r, 15000))])
    }
    onSessionCreated(sessionId)
  }

  if (subPhase === 'loading' || subPhase === 'creating' || subPhase === 'submitting') {
    const label =
      subPhase === 'loading'    ? 'One moment…'
      : launchMode === 'done'   ? 'Saving…'
      : launchMode === 'outreach' ? 'One moment…'
      : 'Convening the Council…'
    return (
      <div role="status" aria-live="polite" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)' }}>
        {label}
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
        {/* Second chance, now the primary action: the session and every answer already exist, so this is pure
            navigation — nothing to re-submit (handleImDone already did, unless a critical question was still
            open, in which case the session page asks it). */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 300 }}>
          <button style={primaryBtn} onClick={handleConveneFromDone}>
            Actually, convene the Council
          </button>
          <div style={{ fontSize: 12.5, color: 'var(--text-4)', marginTop: -4 }}>About a minute</div>
        </div>

        {/* Phase 1: replaces the faint "Start a new decision" reload link. Council stays the primary action above
            (deliberate); this block is the continuity layer: tally, why another decision helps, park/bring-it-now,
            and the soft "keep my record" card. */}
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

  const people = realStakeholders(state.stakeholders)

  if (subPhase === 'reflect' || subPhase === 'editing') {
    // v8: a short, honest list of what the person actually told us (their own words / taps) — never Quorum's inference.
    const prov      = summaryProvenance(state)
    const readiness = councilReadiness(state)
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
    const hasDetails = prov.youTold.length > 0 || prov.youChose.length > 0 || prov.myReading.length > 0 || people.length > 0
    const stillOpen = prov.notKnown.length > 0 && block('Still open', (
      <ul style={ul}>{prov.notKnown.map((r, i) => (
        <li key={`n${i}`}>{r.label}{r.why === 'not_asked' ? ' \u2014 not asked; I\u2019ll flag it to the Council' : r.why === 'skipped' ? ' \u2014 you skipped this' : r.why === 'gap' ? ' \u2014 you weren\u2019t sure; I\u2019ll flag it to the Council' : ''}</li>
      ))}</ul>
    ))
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
            {/* v10: what is still unknown stays visible (it is what the Council will be told); the rest is one tap away. */}
            {stillOpen}
            {hasDetails && (
              <button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(o => !o)}
                style={{ ...linkBtn, color: 'var(--text-3)', padding: '2px 0' }}>
                {detailsOpen ? 'Hide what I understood' : 'See what I understood'}
              </button>
            )}
            {hasDetails && detailsOpen && (
              <div style={{ marginTop: 12 }}>
                {prov.youTold.length > 0 && block('What you told me', (
                  <ul style={ul}>{prov.youTold.map((r, i) => <li key={`t${i}`}>{r.label}: <ExpandableText text={r.value} full={fullAnswerFor(r.value, userMessages)} /></li>)}</ul>
                ))}
                {prov.youChose.length > 0 && block('What you chose', (
                  <ul style={ul}>{prov.youChose.map((r, i) => <li key={`c${i}`}>{r.label}: {r.values.join('; ')}{r.addedWords ? ' (plus your own words)' : ''}</li>)}</ul>
                ))}
                {prov.myReading.length > 0 && block('My reading \u2014 provisional, correct anything that\u2019s off', (
                  <ul style={ul}>{prov.myReading.map((r, i) => <li key={`m${i}`}>{r}</li>)}</ul>
                ))}
                {people.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-4)', marginBottom: 4 }}>Who's involved</div>
                    <div style={{ fontSize: 14.5, color: 'var(--text-2)' }}>{people.map(s => s.name).join(', ')}</div>
                  </div>
                )}
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
                      onClick={() => { priorityTouched.current = true; setPriorityPick(pr.value) }} style={chip(priorityPick === pr.value)}>{pr.label}</button>
                  ))}
                </div>
                {prioritySuggested && priorityPick === prioritySuggested && !priorityTouched.current && (
                  <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 6 }}>Suggested from what you told me {'\u2014'} tap another to change it.</div>
                )}
              </div>
            </div>
          )}
          {launchError && <div role="alert" style={{ fontSize: 13.5, color: 'var(--text-1)' }}>{launchError}</div>}
          {/* v10: Convene is the one primary action on this screen. Where you lean and what matters most stay
              required: the session page will not start without them, so asking here avoids a second, blocking screen. */}
          <button
            style={{ ...primaryBtn, ...(canConfirm ? {} : { background: 'var(--border-dim)', color: 'var(--text-4)', cursor: 'default' }) }}
            aria-disabled={!canConfirm}
            onClick={() => {
              if (!canConfirm) { setLaunchError(LEAN_HINT); return }
              const edited = subPhase === 'editing' && editedText.trim() !== (state.decisionStatement ?? '').trim()
              track('intake_summary_action', { chat_intake_id: chatIntakeId, flow_version: state.flowVersion ?? null, action: 'confirm', edited })
              if (subPhase === 'editing') handleConvene(editedText)
              else handleConvene()
            }}
          >
            Convene the Council
          </button>
          {saveFailed && sessionId && (
            <button type="button" onClick={() => { track('intake_checkpoint_error', { chat_intake_id: chatIntakeId, flow_version: state.flowVersion ?? INTAKE_FLOW_VERSION, stage: 'examiner_save_continue' }); onSessionCreated(sessionId) }}
              style={secondaryBtn}>
              Continue anyway
            </button>
          )}
          <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5, textAlign: 'center' }}>
            See how six different perspectives read this against what you're leaning toward. About a minute.
          </div>
          {subPhase === 'reflect' && (
            <button style={secondaryBtn} onClick={() => { track('intake_summary_action', { chat_intake_id: chatIntakeId, action: 'edit' }); setSubPhase('editing') }}>Not quite — let me fix it</button>
          )}
          <button style={{ ...secondaryBtn, border: 'none', color: 'var(--text-4)' }} onClick={() => { track('intake_summary_action', { chat_intake_id: chatIntakeId, action: 'add_more' }); onBackToChat() }}>
            Let me add more first
          </button>

          {/* Phase 2/3, v2 — only when the chat actually named someone (never a standing "Integrations" menu, plan
              section 22), and only as a small line: it saves the decision first, then opens the outreach card. */}
          {subPhase === 'reflect' && people.length > 0 && (
            <button type="button" onClick={handleOutreach} style={{ ...linkBtn, textAlign: 'center' }}>
              Want to hear from {people.length === 1 ? people[0].name : `${people[0].name} or the others`} first?
            </button>
          )}

          {!showNextAction ? (
            <button type="button" onClick={() => setShowNextAction(true)} style={linkBtn}>
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
      </div>
    )
  }

  const labelStyle: CSSProperties = {
    fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em',
    textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 12,
  }

  // ── subPhase === 'examine' — the one-question check ─────────────────────────
  // v10: reached ONLY when a critical question is still open (the Council cannot run without it). Everything else
  // was recorded without a screen (lib/checkpoint-launch.ts). A chat-covered critical answer is shown for a one-tap
  // confirmation; a genuine gap gets a text box.
  if (subPhase === 'examine') {
    const critical = questions.filter(isCouncilCritical)
    const derivedQs = critical.filter(q => q.derived)
    const openQs    = critical.filter(q => !q.derived)
    const buttonLabel =
      derivedQs.length > 0 && openQs.length === 0 ? 'These look right'
      : derivedQs.length > 0                      ? 'These look right — continue'
      : 'Continue'

    return (
      <div style={container}>
        <div style={{ color: 'var(--text-3)', fontSize: 13.5, letterSpacing: 0.3 }}>
          {derivedQs.length > 0 && openQs.length === 0 ? 'Did I get this right?' : 'One thing before the Council runs'}
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
            <div style={{ ...labelStyle, color: 'var(--gold)', marginBottom: 8 }}>Needed for the Council to run</div>
            <div style={{ fontSize: 15, color: 'var(--text-1)', marginBottom: 10 }}>{q.text}</div>
            <textarea
              value={answers[q.order] ?? ''}
              onChange={e => setAnswers(prev => ({ ...prev, [q.order]: e.target.value }))}
              rows={2}
              placeholder="Your answer"
              style={{
                width: '100%', padding: 12, borderRadius: 12, border: '1px solid var(--border-mid)',
                background: 'var(--bg-inset)', color: 'var(--text-1)', fontSize: 15,
                fontFamily: 'var(--font-body)', resize: 'vertical',
              }}
            />
          </div>
        ))}

        {examineError && <div role="alert" style={{ fontSize: 13.5, color: 'var(--text-1)' }}>{examineError}</div>}
        <button style={primaryBtn} onClick={handleExamineContinue}>{buttonLabel}</button>
        <button type="button" onClick={handleImDone} style={{ ...linkBtn, textAlign: 'center' }}>
          Not now — I'm done
        </button>
      </div>
    )
  }

  // ── subPhase === 'outreach' — ask someone first, then convene ───────────────
  return (
    <div style={container}>
      <div style={{ color: 'var(--text-3)', fontSize: 13.5, letterSpacing: 0.3 }}>
        Your decision is saved. Ask them first if you like — then convene the Council.
      </div>
      {!!people.length && sessionId && (
        <StakeholderOutreach sessionId={sessionId} stakeholders={people} authToken={authToken} />
      )}
      {launchError && <div role="alert" style={{ fontSize: 13.5, color: 'var(--text-1)' }}>{launchError}</div>}
      <button style={primaryBtn} onClick={() => handleConvene()}>Convene the Council</button>
      <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5, textAlign: 'center' }}>
        See how six different perspectives read this against what you're leaning toward. About a minute.
      </div>
    </div>
  )
}
