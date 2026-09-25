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

interface ExaminerQuestion {
  order:          number
  text:           string
  gap:            string
  rule_id:        string | null
  criticality:    'critical' | 'important' | 'optional'
  derived?:       boolean
  derivedAnswer?: string | null
}

interface Props {
  chatIntakeId:      string
  onBackToChat:      () => void
  onSessionCreated:  (sessionId: string) => void
}

type SubPhase = 'loading' | 'reflect' | 'editing' | 'creating' | 'examine' | 'submitting' | 'done'

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

      const examRes  = await fetch(`/api/examiner?sessionId=${data.sessionId}`)
      const examData = await examRes.json()
      setQuestions(examData.questions ?? [])
      setSubPhase('examine')
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
        <button style={{ ...secondaryBtn, width: 'auto', padding: '11px 22px' }} onClick={() => window.location.reload()}>
          Start a new decision
        </button>
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

      <div style={{ ...cardStyle, marginTop: 4 }}>
        <div style={{ fontSize: 15, color: 'var(--text-1)', marginBottom: 10 }}>You don't need the full Council for every decision.</div>
        {!showNextAction ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button style={primaryBtn} onClick={handleConveneCouncil}>Convene the Council</button>
            <button style={secondaryBtn} onClick={() => setShowNextAction(true)}>I'm done</button>
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
