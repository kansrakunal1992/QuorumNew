'use client'

// components/DecisionCheckpoint.tsx
// ── Natural Intake (v1) — the checkpoint screen ───────────────────────────────
//
// Two moments, per the plan (section 4E):
//   1. "Here's the decision I think you're actually making" — pure reflection
//      of the chat, no session created yet. Confirm / Edit / Let me add more.
//   2. Once confirmed, a real session is created through the EXISTING
//      POST /api/session (via /api/chat-intake/checkpoint), and this screen
//      shows whatever the Examiner still needs to ask — with any
//      chat-already-answered items shown as a one-tap confirm instead of a
//      blank box (see lib/examiner-derive.ts) — then the three exits:
//      Convene the Council / I'm done. ("Keep thinking" at this second
//      moment is a scoped v1 deferral — see docs/CHANGELOG_v1.md.)
//
// Deliberately does NOT render the Structural Read visualization or the
// six-persona grid — those stay exactly as SessionView.tsx already renders
// them, reached only via "Convene the Council". This screen's job ends the
// moment the person picks a path.
//
// No internal terms ("Examiner", "rule_id", "structural read") ever reach
// this component's copy — see docs/COPY_AND_STRUCTURE_LOCK_v1.md.

import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ChatDecisionState } from '@/lib/types'
import { isUnifiedSessionEnabled } from '@/lib/feature-flags'
import { createClient } from '@/lib/supabase'
import InitialInstinctCapture from '@/components/InitialInstinctCapture'

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

const REVERSIBILITY_LABEL: Record<string, string> = {
  reversible:          'Easy to reverse',
  somewhat_reversible: 'Somewhat reversible',
  irreversible:        'Hard to reverse',
}

interface Props {
  chatIntakeId:      string
  onBackToChat:      () => void
  onSessionCreated:  (sessionId: string) => void
}

type SubPhase = 'loading' | 'reflect' | 'editing' | 'creating' | 'lean' | 'examine' | 'submitting' | 'done'

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

export default function DecisionCheckpoint({ chatIntakeId, onBackToChat, onSessionCreated }: Props) {
  const [subPhase, setSubPhase]     = useState<SubPhase>('loading')
  const [state, setState]           = useState<ChatDecisionState>({})
  const [editedText, setEditedText] = useState('')
  const [sessionId, setSessionId]   = useState<string | null>(null)
  const [questions, setQuestions]   = useState<ExaminerQuestion[]>([])
  const [answers, setAnswers]       = useState<Record<number, string>>({})
  const [confirmed, setConfirmed]   = useState<Record<number, boolean>>({})
  const [nextAction, setNextAction] = useState('')
  const [showNextAction, setShowNextAction] = useState(false)
  const [showCouncilExamples, setShowCouncilExamples] = useState(false)
  const [authToken, setAuthToken]   = useState<string | null>(null)
  const [insight, setInsight]       = useState<CheckpointInsight | null>(null)
  const [insightLoading, setInsightLoading] = useState(false)

  // Same "does this person have a live session" check ChatIntake.tsx and
  // PlanBadge.tsx already do — needed here so InitialInstinctCapture (the
  // lean-capture step, below) can attribute the instinct to a signed-in
  // user the same way Council's own copy of that screen does.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!cancelled) setAuthToken(session?.access_token ?? null)
      } catch { /* fine — InitialInstinctCapture accepts a null token */ }
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

  async function confirmAndCreateSession(overrideText?: string) {
    setSubPhase('creating')
    try {
      const res = await fetch('/api/chat-intake/checkpoint', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ chatIntakeId, editedDecisionText: overrideText }),
      })
      const data = await res.json()
      if (!res.ok || !data.sessionId) throw new Error(data?.error || 'Failed to create session')
      setSessionId(data.sessionId)

      // Fired in parallel, not awaited — the examine card shows a brief
      // placeholder if this is still in flight when it first renders
      // rather than blocking the whole screen on one more model call.
      setInsightLoading(true)
      fetch('/api/chat-intake/insight', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ chatIntakeId }),
      })
        .then(r => r.json())
        .then(d => { if (d?.stakesLevel) setInsight(d as CheckpointInsight) })
        .catch(() => { /* card just shows nothing in that slot */ })
        .finally(() => setInsightLoading(false))

      const examRes  = await fetch(`/api/examiner?sessionId=${data.sessionId}`)
      const examData = await examRes.json()
      setQuestions(examData.questions ?? [])

      // Item 1 (product feedback): lean was only ever captured right as
      // Council loaded, disconnected from the chat + checkpoint journey
      // that just established it. Moved here — right after the session
      // exists, before the Examiner questions — so it happens once, early,
      // for everyone Unified Session covers. instinctLocked's own check in
      // SessionView.tsx (session.initial_instinct already set) means
      // Council won't ask again once this has run.
      setSubPhase(isUnifiedSessionEnabled() ? 'lean' : 'examine')
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

  async function handleConveneCouncil() {
    setSubPhase('submitting')
    await submitExaminer()
    onSessionCreated(sessionId!)
  }

  async function handleImDone() {
    setSubPhase('submitting')
    await submitExaminer()
    await fetch('/api/chat-intake/done', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        sessionId,
        nextAction: nextAction.trim() || undefined,
      }),
    })
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
        {/* Item 4 (product feedback): picking "I'm done" used to be a dead
            end — no way back to Council if the person changed their mind
            after seeing the reward screen. The session and every Examiner
            answer already exist at this point, so this is pure navigation —
            no re-submission needed (submitExaminer() already ran, inside
            handleImDone, before this screen ever rendered). */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 280 }}>
          <button style={secondaryBtn} onClick={() => sessionId && onSessionCreated(sessionId)}>
            Actually, convene the Council
          </button>
          <button style={{ ...secondaryBtn, border: 'none', color: 'var(--text-4)' }} onClick={() => window.location.reload()}>
            Start a new decision
          </button>
        </div>
      </div>
    )
  }

  const container: CSSProperties = {
    flex: 1, maxWidth: 560, margin: '0 auto', width: '100%',
    padding: '28px 20px calc(20px + env(safe-area-inset-bottom, 0px))',
    display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto',
  }

  // ── subPhase === 'lean' ──────────────────────────────────────────────────
  // Item 1 (product feedback): reuses the exact same component + API route
  // Council's own pre-deliberation lean screen uses (InitialInstinctCapture,
  // POST /api/session/[id]/instinct) — just triggered here, right after the
  // session exists, instead of only later inside SessionView.tsx. Gated the
  // same way that screen already is (isUnifiedSessionEnabled), so this is a
  // no-op when that flag is off, not a second, divergent implementation.
  if (subPhase === 'lean') {
    return (
      <div style={container}>
        <InitialInstinctCapture
          sessionId={sessionId!}
          authToken={authToken}
          decisionText={state.decisionStatement}
          optionLabels={state.options?.map(o => o.label) ?? []}
          onComplete={() => setSubPhase('examine')}
        />
      </div>
    )
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

  // ── subPhase === 'examine' ──────────────────────────────────────────────────
  return (
    <div style={container}>
      <div style={{ color: 'var(--text-3)', fontSize: 13.5, letterSpacing: 0.3 }}>A couple of things to make this sharper</div>

      {questions.map(q => (
        <div key={q.order} style={cardStyle}>
          <div style={{ fontSize: 15, color: 'var(--text-1)', marginBottom: 10 }}>{q.text}</div>
          {q.derived ? (
            confirmed[q.order] ? (
              <div style={{ fontSize: 14, color: 'var(--gold-bright)' }}>✓ Using what you told me: "{q.derivedAnswer}"</div>
            ) : (
              <div>
                <div style={{ fontSize: 14, color: 'var(--text-3)', marginBottom: 8, fontStyle: 'italic' }}>
                  You mentioned: "{q.derivedAnswer}" — is that right?
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={{ ...secondaryBtn, width: 'auto', padding: '8px 16px', fontSize: 13.5 }} onClick={() => setConfirmed(prev => ({ ...prev, [q.order]: true }))}>
                    That's right
                  </button>
                  <button style={{ ...secondaryBtn, width: 'auto', padding: '8px 16px', fontSize: 13.5, border: 'none' }} onClick={() => setQuestions(prev => prev.map(pq => pq.order === q.order ? { ...pq, derived: false } : pq))}>
                    Let me add to it
                  </button>
                </div>
              </div>
            )
          ) : (
            <textarea
              value={answers[q.order] ?? ''}
              onChange={e => setAnswers(prev => ({ ...prev, [q.order]: e.target.value }))}
              rows={2}
              placeholder="Your answer (optional)"
              style={{
                width: '100%', padding: 12, borderRadius: 12, border: '1px solid var(--border-mid)',
                background: 'var(--bg-inset)', color: 'var(--text-1)', fontSize: 15,
                fontFamily: 'var(--font-body)', resize: 'vertical',
              }}
            />
          )}
        </div>
      ))}

      {/* Item 2/3 (product feedback): this used to be two bare buttons with
          no substance — no reward for finishing the chat, and no real
          incentive to click Convene. Now: a structural read (built
          straight from the chat's own decision_state — no waiting on
          anything) plus one adaptive AI read (see
          lib/chat-intake-insight.ts) that either gives a genuine verdict
          for a low-stakes call, or names the specific reason THIS decision
          would benefit from multiple perspectives — never a generic
          feature pitch either way. */}
      <div style={cardStyle}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 14,
        }}>
          The shape of your decision
        </div>
        {!!state.reversibility && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12.5, color: 'var(--text-4)', marginBottom: 4 }}>Reversibility</div>
            <div style={{ fontSize: 14.5, color: 'var(--text-2)' }}>{REVERSIBILITY_LABEL[state.reversibility] ?? state.reversibility}</div>
          </div>
        )}
        {!!state.stakeholders?.length && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12.5, color: 'var(--text-4)', marginBottom: 4 }}>Who's involved</div>
            <div style={{ fontSize: 14.5, color: 'var(--text-2)' }}>{state.stakeholders.map(s => s.name).join(', ')}</div>
          </div>
        )}
        {!!state.deadline && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12.5, color: 'var(--text-4)', marginBottom: 4 }}>Timeline</div>
            <div style={{ fontSize: 14.5, color: 'var(--text-2)' }}>{state.deadline}</div>
          </div>
        )}
        {!!state.unknowns?.length && (
          <div>
            <div style={{ fontSize: 12.5, color: 'var(--text-4)', marginBottom: 4 }}>Biggest uncertainty</div>
            <div style={{ fontSize: 14.5, color: 'var(--text-2)' }}>{state.unknowns[0]}</div>
          </div>
        )}

        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-dim)' }}>
          {insight ? (
            <>
              <div style={{ fontSize: 12.5, color: 'var(--text-4)', marginBottom: 6 }}>
                {insight.stakesLevel === 'low' ? "Quorum's early read" : 'Worth a closer look, because'}
              </div>
              <div style={{ fontSize: 14.5, color: 'var(--text-1)', lineHeight: 1.55 }}>{insight.message}</div>
            </>
          ) : insightLoading ? (
            <div style={{ fontSize: 13.5, color: 'var(--text-4)', fontStyle: 'italic' }}>Reading this a little closer…</div>
          ) : null}
        </div>
      </div>

      <div style={{ ...cardStyle, marginTop: 4 }}>
        <div style={{ fontSize: 15, color: 'var(--text-1)', marginBottom: 8 }}>You don't need the full Council for every decision.</div>
        {/* Item 6 (product feedback): the transition into Council was
            abrupt for first-time users — two buttons with no explanation of
            what Council actually is or when it's worth running. This short,
            always-visible line explains the mechanism itself; the "when is
            it worth it" contrast examples stay behind a toggle so people
            who already get it aren't forced to read past them. */}
        <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.55, marginBottom: 10 }}>
          The Council puts six different perspectives against what you're leaning toward — a challenger, a risk-focused read, a pattern-reader among them — then reconciles what they say into one clear synthesis. Takes about a minute.
        </div>
        <button
          type="button"
          onClick={() => setShowCouncilExamples(s => !s)}
          style={{
            display: 'block', background: 'none', border: 'none', padding: 0, marginBottom: 12,
            fontSize: 12.5, color: 'var(--gold)', cursor: 'pointer', textDecoration: 'underline',
          }}
        >
          {showCouncilExamples ? 'Hide examples' : 'When is it actually worth it?'}
        </button>
        {showCouncilExamples && (
          <div style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 12 }}>
            <div style={{ marginBottom: 6 }}>
              <strong style={{ color: 'var(--text-2)' }}>Usually worth it:</strong> raising money now vs. waiting, a job that means relocating your family, bringing on a co-founder, a decision you keep going back and forth on.
            </div>
            <div>
              <strong style={{ color: 'var(--text-2)' }}>Usually not:</strong> picking between two similar vendors, a decision you're already confident about, anything small enough that being wrong costs you very little.
            </div>
          </div>
        )}
        {!showNextAction ? (
          // Button emphasis follows the same read: while it's still loading
          // or came back "high," Council stays the default recommended
          // path (matches today's behavior). Only once it's confidently
          // "low" does "I'm done" become the natural next click — the
          // verdict above already gave them something real, so pushing
          // them toward Council anyway would undercut it.
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button style={insight?.stakesLevel === 'low' ? secondaryBtn : primaryBtn} onClick={handleConveneCouncil}>Convene the Council</button>
            <button style={insight?.stakesLevel === 'low' ? primaryBtn : secondaryBtn} onClick={() => setShowNextAction(true)}>I'm done</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
            <button style={primaryBtn} onClick={handleImDone}>Done</button>
          </div>
        )}
      </div>
    </div>
  )
}
