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
import type { CSSProperties } from 'react'
import type { ChatDecisionState } from '@/lib/types'
import { isUnifiedSessionEnabled } from '@/lib/feature-flags'
import { createClient } from '@/lib/supabase'
import { getAuthHeaders } from '@/lib/auth-headers'      // Phase 0: send the token on checkpoint
import { pushSessionId } from '@/lib/storage'            // Phase 0: "I'm done" sessions must reach local history
import { track } from '@/lib/track'                      // Phase 0: first-party events
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
        setSubPhase('reflect')
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
      const res = await fetch('/api/chat-intake/checkpoint', {
        method:  'POST',
        // Phase 0 fix: the checkpoint route forwards this header to
        // POST /api/session, which derives user_id from it. Without it the
        // session was created with user_id = null even for signed-in people.
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
        body:    JSON.stringify({ chatIntakeId, editedDecisionText: overrideText }),
      })
      const data = await res.json()
      if (!res.ok || !data.sessionId) throw new Error(data?.error || 'Failed to create session')
      setSessionId(data.sessionId)
      track('decision_checkpointed', { signed_in: !!authToken }, { sessionId: data.sessionId })

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

      // Nothing left to ask → skip the quick-check step entirely.
      setSubPhase(qs.length > 0 ? 'examine' : 'reveal')
    } catch (err) {
      console.error('[DecisionCheckpoint] session creation failed:', err)
      setSubPhase('reflect')
    }
  }

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

    try {
      await fetch('/api/examiner', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sessionId, responses }),
      })
      return true
    } catch (err) {
      console.error('[DecisionCheckpoint] examiner submit failed:', err)
      return false
    }
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
    setSubPhase('submitting')
    // Let a still-running prediction land first (capped, so a slow search
    // can never trap someone on this screen) — the session page then loads
    // the saved one instead of generating a second, different answer.
    if (predictionInFlight.current) {
      await Promise.race([predictionInFlight.current, new Promise(r => setTimeout(r, 15000))])
    }
    await submitExaminer()
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
    return (
      <div style={container}>
        <div style={{ color: 'var(--text-3)', fontSize: 13.5, letterSpacing: 0.3 }}>Here's the decision I think you're actually making</div>

        {subPhase === 'reflect' ? (
          <div style={cardStyle}>
            <div style={{ fontSize: 18, fontFamily: 'var(--font-display)', color: 'var(--text-1)', marginBottom: 14 }}>
              {editedText || 'The decision, once I have enough to name it'}
            </div>
            {!!state.options?.length && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12.5, color: 'var(--text-4)', marginBottom: 4 }}>Options on the table</div>
                <div style={{ fontSize: 14.5, color: 'var(--text-2)' }}>{state.options.map(o => o.label).join(' · ')}</div>
              </div>
            )}
            {!!state.unknowns?.length && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12.5, color: 'var(--text-4)', marginBottom: 4 }}>The main thing still unclear</div>
                <div style={{ fontSize: 14.5, color: 'var(--text-2)' }}>{state.unknowns[0]}</div>
              </div>
            )}
            {!!state.stakeholders?.length && (
              <div>
                <div style={{ fontSize: 12.5, color: 'var(--text-4)', marginBottom: 4 }}>Who's involved</div>
                <div style={{ fontSize: 14.5, color: 'var(--text-2)' }}>{state.stakeholders.map(s => s.name).join(', ')}</div>
              </div>
            )}
          </div>
        ) : (
          <textarea
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
          <button style={primaryBtn} onClick={() => subPhase === 'editing' ? confirmAndCreateSession(editedText) : confirmAndCreateSession()}>
            {subPhase === 'editing' ? 'That\'s right' : 'That\'s right'}
          </button>
          {subPhase === 'reflect' && (
            <button style={secondaryBtn} onClick={() => setSubPhase('editing')}>Not quite — let me fix it</button>
          )}
          <button style={{ ...secondaryBtn, border: 'none', color: 'var(--text-4)' }} onClick={onBackToChat}>
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
        <button style={primaryBtn} onClick={handleConveneCouncil}>
          {councilBlocked ? 'Answer one quick question first' : 'Convene the Council'}
        </button>
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
