'use client'

import { useEffect, useState, useRef } from 'react'

interface ExaminerQuestion {
  order:   number
  text:    string
  gap:     string
  rule_id: string | null   // Sprint 11a: R1–R12 for rule-engine questions, null for v1.0 gap questions
}

type RuleMode = 'REDIRECT' | 'GATE' | 'OPEN' | null

interface Props {
  sessionId: string
  visible:   boolean    // true once all 6 personas are done
  onComplete: (
    responses: Array<{ question_text: string; response_text: string | null; gap: string }>,
    ruleMode:  RuleMode  // Sprint 11b: passed upstream so SessionView can gate synthesis
  ) => void
}

type FetchStatus  = 'idle' | 'loading' | 'ready' | 'no_gaps' | 'retry' | 'error'
type SubmitStatus = 'idle' | 'submitting' | 'done'

const MAX_RETRIES    = 6
const RETRY_DELAY_MS = 3000

export default function ExaminerPanel({ sessionId, visible, onComplete }: Props) {
  const [questions,         setQuestions]         = useState<ExaminerQuestion[]>([])
  const [answers,           setAnswers]            = useState<Record<number, string>>({})
  const [fetchStatus,       setFetchStatus]        = useState<FetchStatus>('idle')
  const [submitStatus,      setSubmitStatus]       = useState<SubmitStatus>('idle')
  const [ruleMode,          setRuleMode]           = useState<RuleMode>(null)
  const [upstreamRationale, setUpstreamRationale] = useState<string | null>(null)   // specific reason R1 fired
  const [dismissed,         setDismissed]          = useState(false)                // local dismiss state for REDIRECT banner

  const retryCountRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!visible) return
    fetchQuestions()
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
  }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchQuestions = async () => {
    setFetchStatus('loading')
    try {
      const res  = await fetch(`/api/examiner?sessionId=${sessionId}`)
      const data = await res.json()

      const mode: RuleMode = data.rule_mode ?? null
      setRuleMode(mode)

      if (data.upstream_rationale) {
        setUpstreamRationale(data.upstream_rationale)
      }

      if (data.status === 'ready' && Array.isArray(data.questions) && data.questions.length > 0) {
        setQuestions(data.questions)
        setFetchStatus('ready')
        retryCountRef.current = 0

        // REDIRECT: fire onComplete IMMEDIATELY so SessionView dims personas right away.
        // "Understood — dismiss" only collapses this panel locally (setDismissed).
        if (mode === 'REDIRECT') {
          onComplete([], 'REDIRECT')   // dims personas + blocks synthesis instantly
        }
        return
      }

      if (data.status === 'no_gaps' || data.status === 'no_rules' || data.questions?.length === 0) {
        setFetchStatus('no_gaps')
        handleSkipInternal(mode)
        return
      }

      if (retryCountRef.current < MAX_RETRIES) {
        retryCountRef.current += 1
        setFetchStatus('retry')
        retryTimerRef.current = setTimeout(fetchQuestions, RETRY_DELAY_MS)
      } else {
        setFetchStatus('error')
        handleSkipInternal(mode)
      }
    } catch {
      if (retryCountRef.current < MAX_RETRIES) {
        retryCountRef.current += 1
        setFetchStatus('retry')
        retryTimerRef.current = setTimeout(fetchQuestions, RETRY_DELAY_MS)
      } else {
        setFetchStatus('error')
        handleSkipInternal(null)
      }
    }
  }

  // Internal skip — used by fetch fallbacks (passes ruleMode from closure)
  const handleSkipInternal = async (mode: RuleMode) => {
    try {
      await fetch('/api/examiner', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sessionId, skipped: true }),
      })
    } catch { /* non-blocking */ }
    setSubmitStatus('done')
    onComplete([], mode)
  }

  // User-triggered skip
  const handleSkip = async () => {
    try {
      await fetch('/api/examiner', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sessionId, skipped: true }),
      })
    } catch { /* non-blocking */ }
    setSubmitStatus('done')
    onComplete([], ruleMode)
  }

  const handleSubmit = async () => {
    setSubmitStatus('submitting')
    const responses = questions.map(q => ({
      question_text:       q.text,
      response_text:       answers[q.order]?.trim() || null,
      question_order:      q.order,
      unknown_unknown_gap: q.gap,
      rule_id:             q.rule_id ?? null,   // Sprint 11a: persist rule_id
    }))
    try {
      await fetch('/api/examiner', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sessionId, responses }),
      })
    } catch { /* non-blocking */ }
    setSubmitStatus('done')
    onComplete(
      responses.map(r => ({ question_text: r.question_text, response_text: r.response_text, gap: r.unknown_unknown_gap })),
      ruleMode   // Sprint 11b: pass rule_mode to SessionView
    )
  }

  // Don't render while hidden or already resolved without UI
  if (!visible) return null
  if (fetchStatus === 'idle' || fetchStatus === 'no_gaps' || fetchStatus === 'error') return null
  if (submitStatus === 'done') return null
  if (dismissed) return null   // user clicked "Understood — dismiss" on REDIRECT banner

  const isLoading    = fetchStatus === 'loading' || fetchStatus === 'retry'
  const isSubmitting = submitStatus === 'submitting'
  const isRedirect   = ruleMode === 'REDIRECT'

  return (
    <div style={{
      gridColumn: '1 / -1',
      background: 'var(--bg-card)',
      border: `1px solid ${isRedirect ? 'rgba(201,168,76,0.45)' : 'rgba(201,168,76,0.3)'}`,
      borderRadius: 14,
      overflow: 'hidden',
      marginBottom: 4,
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px 12px',
        borderBottom: '1px solid var(--border-dim)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: isRedirect ? 'rgba(201,168,76,0.09)' : 'rgba(201,168,76,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: 'rgba(201,168,76,0.12)',
            border: '1px solid rgba(201,168,76,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--gold)', flexShrink: 0,
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </div>
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--gold)', lineHeight: 1.2, letterSpacing: '0.04em' }}>
              The Examiner
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>
              {isLoading
                ? 'Identifying the gaps the council didn\'t have data on…'
                : isRedirect
                ? 'Upstream decision unresolved — synthesis blocked'
                : 'Three questions the council couldn\'t answer without you'}
            </p>
          </div>
        </div>

        {/* Skip — hide on REDIRECT (must acknowledge) */}
        {fetchStatus === 'ready' && submitStatus === 'idle' && !isRedirect && (
          <button
            onClick={handleSkip}
            style={{
              fontSize: 11, color: 'var(--text-4)', background: 'none',
              border: 'none', cursor: 'pointer', padding: '4px 8px',
              fontFamily: 'inherit', textDecoration: 'underline',
            }}
          >
            Skip →
          </button>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: '20px 20px 24px' }}>

        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: 'var(--gold)',
              display: 'inline-block',
              animation: 'blink 1s step-end infinite',
            }} />
            <p style={{ fontSize: 13, color: 'var(--text-4)', fontStyle: 'italic' }}>
              Calibrating questions to your decision…
            </p>
          </div>
        )}

        {/* ── REDIRECT banner ──────────────────────────────────────────────── */}
        {fetchStatus === 'ready' && isRedirect && (
          <div style={{ marginBottom: 0 }}>
            <div style={{
              padding: '18px 20px',
              borderRadius: 10,
              border: '1px solid rgba(201,168,76,0.3)',
              background: 'rgba(201,168,76,0.05)',
              marginBottom: 16,
            }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--gold)', marginBottom: 10, lineHeight: 1.3 }}>
                This decision has an unresolved upstream dependency
              </p>
              {/* Specific rationale from ontology scorer — what exactly is blocking */}
              {upstreamRationale && (
                <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.75, margin: '0 0 12px', fontStyle: 'italic' }}>
                  {upstreamRationale}
                </p>
              )}
              {/* R1 question as the call to action */}
              {questions[0] && (
                <p style={{ fontSize: 13.5, color: 'var(--text-1)', lineHeight: 1.8, margin: '0 0 14px', fontWeight: 500 }}>
                  {questions[0].text}
                </p>
              )}
              <p style={{ fontSize: 12, color: 'var(--text-4)', lineHeight: 1.7, margin: 0 }}>
                The Council has run — their perspectives are visible below, marked as provisional.
                Synthesis is blocked until the upstream question is resolved.
                Use <strong style={{ color: 'var(--text-3)' }}>Reanalyze</strong> once it is.
              </p>
            </div>
            {/* Dismiss — only collapses panel locally. onComplete already fired on detection. */}
            <button
              onClick={() => setDismissed(true)}
              style={{
                padding: '9px 22px',
                borderRadius: 8,
                border: '1px solid var(--gold-dim)',
                background: 'rgba(201,168,76,0.10)',
                color: 'var(--gold)',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                letterSpacing: '0.02em',
              }}
            >
              Understood — dismiss
            </button>
          </div>
        )}

        {/* ── Normal question flow (GATE / OPEN) ──────────────────────────── */}
        {fetchStatus === 'ready' && submitStatus === 'idle' && !isRedirect && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {questions.map((q) => (
                <div key={q.order}>
                  <label style={{
                    display: 'block',
                    fontSize: 13.5, fontWeight: 600,
                    color: 'var(--text-1)',
                    lineHeight: 1.5,
                    marginBottom: 8,
                  }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700,
                      color: 'var(--gold)',
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      marginRight: 8,
                    }}>
                      Q{q.order}
                    </span>
                    {q.text}
                  </label>
                  <textarea
                    rows={3}
                    value={answers[q.order] ?? ''}
                    onChange={e => setAnswers(prev => ({ ...prev, [q.order]: e.target.value }))}
                    placeholder="Your answer (or leave blank to skip this question)…"
                    style={{
                      fontSize: 13,
                      background: 'var(--bg-inset)',
                      border: answers[q.order]?.trim()
                        ? '1px solid rgba(201,168,76,0.4)'
                        : '1px solid var(--border-dim)',
                      transition: 'border-color 0.15s',
                    }}
                  />
                </div>
              ))}
            </div>

            <div style={{ marginTop: 20, display: 'flex', gap: 10, alignItems: 'center' }}>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                style={{
                  padding: '11px 28px',
                  borderRadius: 9,
                  border: '1px solid var(--gold-dim)',
                  background: 'rgba(201,168,76,0.12)',
                  color: 'var(--gold)',
                  fontSize: 13.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  letterSpacing: '0.02em',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(201,168,76,0.22)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(201,168,76,0.12)' }}
              >
                {isSubmitting ? 'Sending to council…' : 'Submit to Council →'}
              </button>
              <p style={{ fontSize: 11, color: 'var(--text-4)' }}>
                Answers are optional — blank fields are skipped
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
