'use client'

import { useEffect, useState, useRef } from 'react'

interface ExaminerQuestion {
  order: number
  text: string
  gap: string
}

interface Props {
  sessionId: string
  visible: boolean                           // true once all 6 personas are done
  onComplete: () => void                    // tells SessionView synthesis can fire
}

type FetchStatus = 'idle' | 'loading' | 'ready' | 'no_gaps' | 'retry' | 'error'
type SubmitStatus = 'idle' | 'submitting' | 'done'

const MAX_RETRIES    = 6   // ontology tagger may still be running
const RETRY_DELAY_MS = 3000

export default function ExaminerPanel({ sessionId, visible, onComplete }: Props) {
  const [questions,    setQuestions]    = useState<ExaminerQuestion[]>([])
  const [answers,      setAnswers]      = useState<Record<number, string>>({})
  const [fetchStatus,  setFetchStatus]  = useState<FetchStatus>('idle')
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>('idle')
  const retryCountRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fetch questions once panel becomes visible
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

      if (data.status === 'ready' && Array.isArray(data.questions) && data.questions.length > 0) {
        setQuestions(data.questions)
        setFetchStatus('ready')
        retryCountRef.current = 0
        return
      }

      if (data.status === 'no_gaps' || data.questions?.length === 0) {
        // No gaps — skip examiner automatically
        setFetchStatus('no_gaps')
        handleSkip(true)
        return
      }

      // Ontology not ready yet — retry
      if (retryCountRef.current < MAX_RETRIES) {
        retryCountRef.current += 1
        setFetchStatus('retry')
        retryTimerRef.current = setTimeout(fetchQuestions, RETRY_DELAY_MS)
      } else {
        // Give up — skip gracefully
        setFetchStatus('error')
        handleSkip(true)
      }
    } catch {
      if (retryCountRef.current < MAX_RETRIES) {
        retryCountRef.current += 1
        setFetchStatus('retry')
        retryTimerRef.current = setTimeout(fetchQuestions, RETRY_DELAY_MS)
      } else {
        setFetchStatus('error')
        handleSkip(true)
      }
    }
  }

  const handleSkip = async (silent = false) => {
    try {
      await fetch('/api/examiner', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sessionId, skipped: true }),
      })
    } catch { /* non-blocking */ }
    if (!silent) onComplete()
    else onComplete()  // always unblock synthesis
  }

  const handleSubmit = async () => {
    setSubmitStatus('submitting')
    const responses = questions.map(q => ({
      question_text:       q.text,
      response_text:       answers[q.order]?.trim() || null,
      question_order:      q.order,
      unknown_unknown_gap: q.gap,
    }))
    try {
      await fetch('/api/examiner', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sessionId, responses }),
      })
    } catch { /* non-blocking */ }
    setSubmitStatus('done')
    onComplete()
  }

  // Don't render while hidden or already resolved without UI
  if (!visible) return null
  if (fetchStatus === 'idle' || fetchStatus === 'no_gaps' || fetchStatus === 'error') return null
  if (submitStatus === 'done') return null

  const isLoading = fetchStatus === 'loading' || fetchStatus === 'retry'

  return (
    <div style={{
      gridColumn: '1 / -1',
      background: 'var(--bg-card)',
      border: '1px solid rgba(201,168,76,0.3)',
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
        background: 'rgba(201,168,76,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: 'rgba(201,168,76,0.12)',
            border: '1px solid rgba(201,168,76,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--gold)', flexShrink: 0,
          }}>
            {/* Magnifying glass / examiner icon */}
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
                : 'Three questions the council couldn\'t answer without you'}
            </p>
          </div>
        </div>

        {fetchStatus === 'ready' && submitStatus === 'idle' && (
          <button
            onClick={() => handleSkip()}
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

        {fetchStatus === 'ready' && submitStatus === 'idle' && (
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
                disabled={submitStatus === 'submitting'}
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
                {submitStatus === 'submitting' ? 'Sending to council…' : 'Submit to Council →'}
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
