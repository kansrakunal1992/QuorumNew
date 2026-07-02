'use client'

import { useEffect, useState, useRef } from 'react'

interface ExaminerQuestion {
  order:   number
  text:    string
  gap:     string
  rule_id: string | null   // Sprint 11a: R1–R12 for rule-engine questions, null for v1.0 gap questions
}

type RuleMode = 'REDIRECT' | 'GATE' | 'OPEN' | null

// Sprint 16c Fix 6: human-readable hints per rule — shown as subtext under examiner questions
// so users understand why this specific question matters for their analysis
const RULE_HINTS: Record<string, string> = {
  R1:  'There may be a prior decision that needs resolving before this one can be analysed cleanly.',
  R7:  'Specific information exists that would change the right answer — your response helps identify what to gather first.',
  R2:  'This decision may be more about who you are than what the data says — your answer helps separate the two.',
  R3:  'The Council needs more context before it can give you a useful answer.',
  R4:  'The cost of reversing one path may be much higher than the other — your answer helps calibrate that asymmetry.',
  R5:  'Urgency may be driving the frame rather than the facts. Your answer helps test whether the timeline is real.',
  R6:  'Other people will be affected and may need to be involved. Your answer helps map who and how.',
  R8:  'Competing values are in play that no amount of data resolves. Your answer clarifies which matters more to you.',
  R9:  'One path may be genuinely irreversible. Your answer helps the Council assess whether that changes the calculus.',
  R10: 'There are several moving parts here — your answer helps the Council focus.',
  R12: 'Misalignment between decision-makers is often the real risk. Your answer surfaces where that tension sits.',
  // S0 — Subject Orientation: fires when decision brief is thin (< 25 words, no context)
  S0:  'Grounds the Council in what this actually is — context the decision alone couldn\'t supply.',
  // E0 — Emotional/Gut question: SB-2. Always fires. Surfaces the dimension not named in the brief.
  E0:  'The Council reads what you wrote. This question asks about what you didn\'t write — what\'s underneath the framing.',
  // C0 — JTBD context question: not a diagnostic flag, a framing input
  C0:  'This isn\'t about predicting the outcome — it captures what you\'re actually trying to achieve, so the Council reasons from your real intent, not assumed goals.',
}

interface Props {
  sessionId: string
  visible:   boolean    // true once all 6 personas are done
  onComplete: (
    responses:       Array<{ question_text: string; response_text: string | null; gap: string }>,
    ruleMode:        RuleMode,  // Sprint 11b: passed upstream so SessionView can gate synthesis
    redirectQuestion?: string   // Sprint 16b: R1 question text — shown in SynthesisCard REDIRECT banner
  ) => void
  forceDismissed?: boolean  // set true by SessionView when user clicks "This doesn't apply — continue to Council"
}

type FetchStatus  = 'idle' | 'loading' | 'ready' | 'no_gaps' | 'retry' | 'error'
type SubmitStatus = 'idle' | 'submitting' | 'done'

// Bug fix (EXAMINER-1): the ontology tagger is fired fire-and-forget at
// session creation and runs a full Claude completion (~2000 max_tokens,
// scoring 14 dimensions) before tagger_status flips to 'complete' — realistically
// 5-20s+. The previous 6 x 3s = 18s budget was tight enough that a normal-speed
// tagger call could still be mid-flight when the Examiner gave up and silently
// skipped (no card, no indication anything happened). Widened to 10 x 3s = 30s
// to give genuine in-flight cases realistic room. This only affects sessions
// where tagger_status is still 'pending' — see the 'failed' short-circuit below
// for the case where retrying is pointless.
const MAX_RETRIES    = 10
const RETRY_DELAY_MS = 3000

export default function ExaminerPanel({ sessionId, visible, onComplete, forceDismissed }: Props) {
  const [questions,         setQuestions]         = useState<ExaminerQuestion[]>([])
  const [answers,           setAnswers]            = useState<Record<number, string>>({})
  const [fetchStatus,       setFetchStatus]        = useState<FetchStatus>('idle')
  const [submitStatus,      setSubmitStatus]       = useState<SubmitStatus>('idle')
  const [ruleMode,          setRuleMode]           = useState<RuleMode>(null)
  const [redirectRule,      setRedirectRule]       = useState<string | null>(null)   // 'R1' | 'R7' | null
  const [upstreamRationale, setUpstreamRationale] = useState<string | null>(null)   // populated for R1 only
  const [dismissed,         setDismissed]          = useState(false)                // local dismiss state for REDIRECT banner
  const [glowing,           setGlowing]            = useState(false)               // one-time entry glow

  // S2-03: stepper — one question at a time. 'intro' is a brief auto-advancing beat
  // (1.5s, no interaction) shown once questions are ready; 'stepping' shows exactly
  // one question per screen, advancing only on Continue/Submit click — never on a timer.
  const [flowStage, setFlowStage] = useState<'intro' | 'stepping'>('intro')
  const [stepIndex, setStepIndex] = useState(0)
  const introTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fire one-time glow on mount — component only mounts when visible becomes true
  useEffect(() => {
    const t1 = setTimeout(() => setGlowing(true),  100)
    const t2 = setTimeout(() => setGlowing(false), 1900)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  const retryCountRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!visible) return
    fetchQuestions()
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
  }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps

  // S2-03: intro auto-advances to the first question after 2s — no click required.
  // Every question after that advances only via the Continue/Submit button (constraint e).
  useEffect(() => {
    if (fetchStatus !== 'ready' || ruleMode === 'REDIRECT') return
    if (flowStage !== 'intro') return
    introTimerRef.current = setTimeout(() => {
      setFlowStage('stepping')
      setStepIndex(0)
    }, 2000)
    return () => {
      if (introTimerRef.current) clearTimeout(introTimerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchStatus, ruleMode])

  const fetchQuestions = async () => {
    setFetchStatus('loading')
    try {
      const res  = await fetch(`/api/examiner?sessionId=${sessionId}`)
      const data = await res.json()

      const mode: RuleMode = data.rule_mode ?? null
      setRuleMode(mode)

      if (data.redirect_rule) {
        setRedirectRule(data.redirect_rule)
      }
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
          // Pass the R1 question text — available in data.questions here (state hasn't settled yet)
          const redirectQ = data.questions[0]?.text ?? undefined
          onComplete([], 'REDIRECT', redirectQ)   // dims personas + blocks synthesis instantly
        }
        return
      }

      if (data.status === 'no_gaps' || data.status === 'no_rules' || data.questions?.length === 0) {
        setFetchStatus('no_gaps')
        handleSkipInternal(mode)
        return
      }

      // Bug fix (EXAMINER-1): 'failed' means the ontology tagger errored out
      // for this session and will never reach 'complete' — see TAGGER-1 fix
      // in app/api/ontology/route.ts, which now sets this explicitly instead
      // of leaving the row stuck at 'pending'. Retrying a known dead end just
      // makes the user stare at "Calibrating questions…" for up to 30s for
      // nothing — skip immediately instead. Only 'pending' (tagger genuinely
      // still running) falls through to the retry loop below.
      if (data.status === 'failed') {
        setFetchStatus('error')
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

  // S2-03: advances one step. On the last question, submits everything collected so far.
  const handleStepAdvance = () => {
    const isLastStep = stepIndex >= questions.length - 1
    if (isLastStep) {
      handleSubmit()
    } else {
      setStepIndex(i => i + 1)
    }
  }

  // Don't render while hidden or already resolved without UI
  if (!visible) return null
  if (fetchStatus === 'idle' || fetchStatus === 'no_gaps' || fetchStatus === 'error') return null
  if (submitStatus === 'done') return null
  if (dismissed || forceDismissed) return null   // user clicked "Understood — dismiss" OR override fired from SynthesisCard

  const isLoading    = fetchStatus === 'loading' || fetchStatus === 'retry'
  const isSubmitting = submitStatus === 'submitting'
  const isRedirect   = ruleMode === 'REDIRECT'

  return (
    <div style={{
      gridColumn: '1 / -1',
      background: 'var(--bg-card)',
      border: `1px solid ${isRedirect ? 'rgba(201,168,76,0.45)' : glowing ? 'rgba(201,168,76,0.55)' : 'rgba(201,168,76,0.3)'}`,
      borderRadius: 14,
      overflow: 'hidden',
      marginBottom: 4,
      transition: 'box-shadow 0.5s ease, border-color 0.5s ease',
      boxShadow: glowing
        ? '0 0 0 2px rgba(201,168,76,0.18), 0 0 22px 6px rgba(201,168,76,0.12)'
        : 'none',
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
              A Few Quick Questions
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>
              {isLoading
                ? 'Identifying the gaps the council didn\'t have data on…'
                : isRedirect && redirectRule === 'R7'
                ? 'Synthesis held — specific information needed first'
                : isRedirect
                ? 'Upstream decision unresolved — synthesis blocked'
                : fetchStatus === 'ready' && flowStage === 'stepping' && questions.length > 0
                ? `Question ${stepIndex + 1} of ${questions.length}`
                : 'Key questions the council couldn\'t answer without you'}
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
                {redirectRule === 'R7'
                  ? "Specific information would change this decision — the Council\u2019s read is provisional until you have it"
                  : 'This decision has an unresolved upstream dependency'}
              </p>
              {/* upstreamRationale is only populated for R1 — never shown for R7 to avoid
                  contradictory copy ("no external blocking element" inside a blocking banner) */}
              {upstreamRationale && redirectRule === 'R1' && (
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
                {redirectRule === 'R7'
                  ? <>The Council has run — their perspectives are visible below as provisional context. Once you have the information, return and use <strong style={{ color: 'var(--text-3)' }}>Reanalyze</strong> for a clean read.</>
                  : <>The Council has run — their perspectives are visible below, marked as provisional. Synthesis is blocked until the upstream question is resolved. Use <strong style={{ color: 'var(--text-3)' }}>Reanalyze</strong> once it is.</>}
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

        {/* ── S2-03: Intro screen — brief, auto-advances after 1.5s, no interaction ── */}
        {fetchStatus === 'ready' && submitStatus === 'idle' && !isRedirect && flowStage === 'intro' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: 'var(--gold)',
              display: 'inline-block',
              animation: 'blink 1s step-end infinite',
            }} />
            <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5 }}>
              The Council has {questions.length === 1 ? 'one follow-up question' : `${questions.length} follow-up questions`} based on what it read.
            </p>
          </div>
        )}

        {/* ── S2-03: Stepper — one question at a time, advances only on click (constraint e) ── */}
        {fetchStatus === 'ready' && submitStatus === 'idle' && !isRedirect && flowStage === 'stepping' && questions[stepIndex] && (
          <>
            {/* (a) Stepper dots — sized exactly to questions.length, hidden entirely for a single question */}
            {questions.length >= 2 && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
                {questions.map((q, i) => (
                  <div
                    key={q.order}
                    style={{
                      flex:         1,
                      height:       3,
                      borderRadius: 2,
                      background:   i <= stepIndex ? 'var(--gold)' : 'var(--border-dim)',
                      opacity:      i <= stepIndex ? 0.85 : 1,
                      transition:   'background 0.2s ease',
                    }}
                  />
                ))}
              </div>
            )}

            {(() => {
              const q = questions[stepIndex]
              return (
                <div key={q.order}>
                  <label style={{
                    display: 'block',
                    fontSize: 13.5, fontWeight: 600,
                    color: 'var(--text-1)',
                    lineHeight: 1.5,
                    marginBottom: 4,
                  }}>
                  {q.rule_id === 'C0' ? (
                    <span style={{
                      fontSize: 9.5, fontWeight: 700,
                      color: 'var(--success-text)',
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      marginRight: 8,
                      padding: '2px 6px',
                      borderRadius: 4,
                      border: '1px solid var(--success-border)',
                      background: 'var(--success-bg)',
                    }}>
                      CONTEXT
                    </span>
                  ) : q.rule_id === 'S0' ? (
                    // S0 — Subject Orientation: domain-context question, not a diagnostic flag.
                    // Same visual register as C0 (framing input, not a red-flag rule) —
                    // signals to the user "this is grounding, not a warning".
                    <span style={{
                      fontSize: 9.5, fontWeight: 700,
                      color: 'var(--success-text)',
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      marginRight: 8,
                      padding: '2px 6px',
                      borderRadius: 4,
                      border: '1px solid var(--success-border)',
                      background: 'var(--success-bg)',
                    }}>
                      BRIEF
                    </span>
                  ) : q.rule_id === 'E0' ? (
                    // SB-2 + S2-04: E0 — Emotional/inward question. Distinct label in gold-dim
                    // so it reads as reflective framing, not a structural warning flag. The
                    // stepper's one-question-per-screen layout already isolates E0 as its own
                    // step rather than mixing it into a page of structural questions.
                    <span style={{
                      fontSize: 9.5, fontWeight: 700,
                      color: 'var(--gold)',
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      marginRight: 8,
                      padding: '2px 6px',
                      borderRadius: 4,
                      border: '1px solid var(--gold-dim)',
                      background: 'rgba(201,168,76,0.08)',
                    }}>
                      REFLECTION
                    </span>
                  ) : (
                    <span style={{
                      fontSize: 10, fontWeight: 700,
                      color: 'var(--gold)',
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      marginRight: 8,
                    }}>
                      Q{q.order}
                    </span>
                  )}
                  {q.text}
                </label>
                  {/* Sprint 16c Fix 6: subtext — shows why this question helps */}
                  <p style={{ fontSize: 11, color: 'var(--text-4)', fontStyle: 'italic', margin: '0 0 8px', lineHeight: 1.5 }}>
                    {q.rule_id
                      ? RULE_HINTS[q.rule_id] ?? 'Your answer helps the Council refine its assessment.'
                      : q.gap
                        ? `Helps surface: ${q.gap.toLowerCase()}`
                        : 'Your answer helps the Council refine its assessment.'}
                  </p>
                  <textarea
                    rows={3}
                    autoFocus
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
              )
            })()}

            <div style={{ marginTop: 20, display: 'flex', gap: 10, alignItems: 'center' }}>
              <button
                onClick={handleStepAdvance}
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
                {isSubmitting
                  ? 'Sending to council…'
                  : stepIndex >= questions.length - 1
                  ? 'Submit to Council →'
                  : 'Continue →'}
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
