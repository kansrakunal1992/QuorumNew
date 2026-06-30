'use client'

import { useEffect, useState, useRef } from 'react'
import { useTTSContext } from '@/context/TTSContext'

interface Props {
  sessionId:         string
  decisionText:      string
  contextText?:      string
  personaResponses:  Record<string, string>
  totalPersonas:     number
  version:           number
  registerMode?:     'analytical' | 'clarification'
  examinerReady?:    boolean   // Sprint 3: synthesis only fires after Examiner Phase 1 completes
  redirectBlocked?:  boolean   // Sprint 11b: R1 upstream block — shows redirect card, synthesis never fires
  /** Sprint 16b: the exact R1 question the user must resolve before Reanalyzing */
  redirectQuestion?: string
  /** Sprint 16b Fix 1: callback fired when user overrides the R1 REDIRECT and chooses to proceed to Council */
  onOverrideRedirect?: () => void
  /** Council status bar: fires when synthesis stream begins */
  onSynthesisStart?: () => void
  /** Council status bar: fires when synthesis stream completes */
  onSynthesisComplete?: () => void
  /** C0 + all examiner answers — injected into synthesis as USER STATED INTENT framing block */
  examinerContext?: string
}

type State = 'waiting' | 'streaming' | 'done' | 'error'

export default function SynthesisCard({
  sessionId, decisionText, contextText,
  personaResponses, totalPersonas, version,
  registerMode, examinerReady,
  redirectBlocked,    // Sprint 11b
  redirectQuestion,   // Sprint 16b
  onOverrideRedirect, // Sprint 16b Fix 1
  onSynthesisStart,   // Council status bar
  onSynthesisComplete,// Council status bar
  examinerContext,    // C0 + rule answers → framing block in synthesis
}: Props) {
  const [synthesis,    setSynthesis]   = useState('')
  const [state,        setState]       = useState<State>('waiting')
  const [briefText,    setBriefText]   = useState('')
  const [briefState,   setBriefState]  = useState<'idle'|'streaming'|'done'|'error'>('idle')
  const [showBrief,    setShowBrief]   = useState(false)

  // S1-03: verdict + tension — extracted from synthesis stream via tag parser
  const [verdictText,  setVerdictText]  = useState('')
  const [tensionText,  setTensionText]  = useState('')
  const parseModeRef   = useRef<'prose' | 'verdict' | 'tension'>('prose')
  const verdictAccRef  = useRef('')
  const tensionAccRef  = useRef('')
  // Raw accumulated stream text — used by renderProse to locate tension tags
  // without relying on trimmed state strings (avoids whitespace indexOf mismatches).
  const rawAccRef = useRef('')

  // Truncates to the first complete sentence — guards against the model putting
  // multiple sentences inside <verdict>. Applied only at render time.
  const firstSentence = (text: string): string => {
    const m = text.match(/^[^.!?]*[.!?]/)
    return m ? m[0].trim() : text.trim()
  }

  // Renders synthesis prose with the tension sentence highlighted inline.
  // During streaming: plain text. After done: splits rawAccRef on <tension> tags
  // directly — avoids the indexOf whitespace-mismatch problem entirely.
  const renderProse = (prose: string, isDone: boolean): React.ReactNode => {
    if (!isDone) return <>{prose}</>
    const raw = rawAccRef.current
    // Strip the verdict block first, then look for tension tags
    const rawNoVerdict = raw
      .replace(/<verdict>[\s\S]*?<\/verdict>\n*/g, '')
      .replace(/<verdict>[\s\S]*/g, '')
    const tStart = rawNoVerdict.indexOf('<tension>')
    const tEnd   = rawNoVerdict.indexOf('</tension>')
    if (tStart === -1 || tEnd === -1 || tEnd <= tStart) return <>{prose}</>
    const before  = rawNoVerdict.slice(0, tStart)
    const content = rawNoVerdict.slice(tStart + '<tension>'.length, tEnd)
    const after   = rawNoVerdict.slice(tEnd + '</tension>'.length).trimStart()
    return (
      <>
        {before}
        <span style={{
          background:    'var(--tension-highlight-bg)',
          borderBottom:  '1px solid var(--tension-highlight-border)',
          paddingBottom: 1,
          borderRadius:  2,
        }}>{content}</span>
        {after}
      </>
    )
  }

  // ── TTS ───────────────────────────────────────────────────────────────────
  const { speak, stop, pause, resume, isSpeaking, isPaused, isLoading, activeSpeakerId, rate, setRate, countdown } = useTTSContext()
  const isThisSpeaking = activeSpeakerId === 'synthesis'

  const completedCount = Object.keys(personaResponses).length
  const allDone        = completedCount >= totalPersonas
  const abortRef       = useRef<AbortController | null>(null)
  const briefAbortRef  = useRef<AbortController | null>(null)
  const responsesRef   = useRef(personaResponses)
  const decisionRef    = useRef(decisionText)
  const contextRef     = useRef(contextText)
  const sessionIdRef   = useRef(sessionId)
  const registerRef    = useRef(registerMode)
  const examinerContextRef = useRef(examinerContext)

  useEffect(() => { responsesRef.current       = personaResponses }, [personaResponses])
  useEffect(() => { examinerContextRef.current = examinerContext  }, [examinerContext])

  useEffect(() => { decisionRef.current  = decisionText  }, [decisionText])
  useEffect(() => { contextRef.current   = contextText   }, [contextText])
  useEffect(() => { sessionIdRef.current = sessionId     }, [sessionId])
  useEffect(() => { registerRef.current  = registerMode  }, [registerMode])

  // Fire synthesis — gated on examinerReady AND not redirectBlocked (Sprint 11b)
  useEffect(() => {
    if (!allDone || !examinerReady || redirectBlocked) return   // Sprint 11b: redirectBlocked blocks synthesis permanently
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setSynthesis('')
    setState('streaming')
    onSynthesisStart?.()
    setBriefText('')
    setBriefState('idle')
    setShowBrief(false)
    // Reset verdict/tension accumulators on each new synthesis run
    setVerdictText('')
    setTensionText('')
    parseModeRef.current  = 'prose'
    verdictAccRef.current = ''
    tensionAccRef.current = ''
    rawAccRef.current     = ''

    const run = async () => {
      const latest = responsesRef.current
      const personaBlock = Object.entries(latest)
        .map(([k, v]) => `[${k.toUpperCase().replace(/_/g, ' ')}]\n${v.slice(0, 800)}`)
        .join('\n\n---\n\n')
      const ctx = contextRef.current ? `\nCONTEXT:\n${contextRef.current}\n` : ''
      // C0 (JTBD intent) + rule answers from Examiner — lifted out as framing block
      // so synthesis reasons from the user's stated intent, not assumed goals
      const examinerBlock = examinerContextRef.current
        ? `\n\nUSER STATED INTENT & EXAMINER CONTEXT (captured before the Council ran):\n${examinerContextRef.current}\n`
        : ''
      const msg = `DECISION: ${decisionRef.current}${ctx}${examinerBlock}\n\nADVISOR RESPONSES:\n\n${personaBlock}\n\nNow produce the council synthesis.`

      try {
        const res = await fetch('/api/persona', {
          method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId:      sessionIdRef.current,
            personaKey:     'synthesis',
            messages:       [{ role: 'user', content: msg }],
            decisionText:   decisionRef.current,
            contextText:    contextRef.current,
            rawMessages:    true,
            // Sprint D3: pass resubmitAlertId if user came via "Bring it back →" in Mirror.
            // localStorage is the bridge — AvoidanceAlertCard sets it before navigating.
            // Read + clear here so it only fires once per resubmission.
            resubmitAlertId: (() => {
              try {
                const id = localStorage.getItem('quorum_resubmit_alert')
                if (id) localStorage.removeItem('quorum_resubmit_alert')
                return id ?? undefined
              } catch { return undefined }
            })(),
          }),
        })
        if (!res.ok || !res.body) { setState('error'); return }
        const reader = res.body.getReader()
        const dec    = new TextDecoder()
        let acc = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (ctrl.signal.aborted) return
          const chunk = dec.decode(value, { stream: true })
          acc += chunk
          rawAccRef.current = acc   // keep ref in sync for renderProse
          // S1-03: tag parser — processes NEW chunk only, accumulates via refs.
          // Verdict → extracted OUT of prose, shown in gold box above.
          // Tension → content STAYS in prose (tags stripped); highlighted inline after done.
          {
            let remaining = chunk
            let mode    = parseModeRef.current
            let verdict = verdictAccRef.current
            let tension = tensionAccRef.current

            while (remaining.length > 0) {
              if (mode === 'prose') {
                const vIdx = remaining.indexOf('<verdict>')
                const tIdx = remaining.indexOf('<tension>')
                if (vIdx !== -1 && (tIdx === -1 || vIdx < tIdx)) {
                  remaining = remaining.slice(vIdx + '<verdict>'.length)
                  mode      = 'verdict'
                } else if (tIdx !== -1) {
                  remaining = remaining.slice(tIdx + '<tension>'.length)
                  mode      = 'tension'
                } else {
                  remaining = ''
                }
              } else if (mode === 'verdict') {
                const end = remaining.indexOf('</verdict>')
                if (end !== -1) {
                  verdict  += remaining.slice(0, end)
                  remaining = remaining.slice(end + '</verdict>'.length)
                  mode      = 'prose'
                } else {
                  verdict  += remaining
                  remaining = ''
                }
              } else {
                const end = remaining.indexOf('</tension>')
                if (end !== -1) {
                  tension  += remaining.slice(0, end)
                  remaining = remaining.slice(end + '</tension>'.length)
                  mode      = 'prose'
                } else {
                  tension  += remaining
                  remaining = ''
                }
              }
            }

            parseModeRef.current  = mode
            verdictAccRef.current = verdict
            tensionAccRef.current = tension
            if (verdict) setVerdictText(verdict)
            if (tension) setTensionText(tension.trim())
          }
          // Display prose:
          // • Complete verdict block → stripped (shown in gold box above prose)
          // • Partial open verdict at stream edge → stripped (closes on next chunk)
          // • Tension tags → stripped; tension TEXT stays inline for highlight after done
          setSynthesis(
            acc
              .replace(/<verdict>[\s\S]*?<\/verdict>\n*/g, '')
              .replace(/<verdict>[\s\S]*/g, '')
              .replace(/<\/?tension>/g, '')
          )
        }
        // Final extraction pass — guarantees verdict and tension are captured even
        // if a chunk boundary left the per-chunk parser in an open state (e.g. stream
        // ended with parseModeRef === 'verdict' and no closing tag arrived).
        const finalAcc = acc
        const fv = finalAcc.match(/<verdict>([\s\S]*?)<\/verdict>/)
        const ft = finalAcc.match(/<tension>([\s\S]*?)<\/tension>/)
        if (fv?.[1]?.trim()) setVerdictText(fv[1].trim())
        if (ft?.[1]?.trim()) setTensionText(ft[1].trim())
        // One final setSynthesis so the prose is fully clean regardless of
        // whether the last setSynthesis inside the loop was on a partial chunk.
        setSynthesis(
          finalAcc
            .replace(/<verdict>[\s\S]*?<\/verdict>\n*/g, '')
            .replace(/<verdict>[\s\S]*/g, '')
            .replace(/<\/?tension>/g, '')
            .trimStart()
        )
        setState('done')
        onSynthesisComplete?.()
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') return
        setState('error')
      }
    }
    run()
    return () => { ctrl.abort() }
  }, [allDone, examinerReady, redirectBlocked, version]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleGenerateBrief = async () => {
    briefAbortRef.current?.abort()
    const ctrl = new AbortController()
    briefAbortRef.current = ctrl
    setBriefText('')
    setBriefState('streaming')
    setShowBrief(true)

    const latest = responsesRef.current
    const personaBlock = Object.entries(latest)
      .map(([k, v]) => `[${k.toUpperCase().replace(/_/g, ' ')}]\n${v.slice(0, 800)}`)
      .join('\n\n---\n\n')
    const ctx = contextRef.current ? `\nCONTEXT:\n${contextRef.current}\n` : ''
    const msg = `DECISION: ${decisionRef.current}${ctx}\n\nADVISOR RESPONSES:\n\n${personaBlock}\n\nNow produce the Decision Brief.`

    try {
      const res = await fetch('/api/persona', {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionIdRef.current, personaKey: 'decision_brief', messages: [{ role: 'user', content: msg }], decisionText: decisionRef.current, contextText: contextRef.current, rawMessages: true }),
      })
      if (!res.ok || !res.body) { setBriefState('error'); return }
      const reader = res.body.getReader()
      const dec    = new TextDecoder()
      let acc = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (ctrl.signal.aborted) return
        acc += dec.decode(value, { stream: true })
        setBriefText(acc)
      }
      setBriefState('done')
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setBriefState('error')
    }
  }

  // ── Sprint 11b: REDIRECT blocked card — early return ─────────────────────
  if (redirectBlocked) {
    return (
      <div style={{
        gridColumn: '1 / -1',
        background: 'var(--bg-card)',
        border: '1px solid rgba(201,168,76,0.35)',
        borderRadius: 14,
        marginBottom: 4,
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 20px 12px',
          borderBottom: '1px solid var(--border-dim)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: 'rgba(201,168,76,0.07)',
          borderRadius: '13px 13px 0 0',
        }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gold)', flexShrink: 0 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--gold)', lineHeight: 1.2, letterSpacing: '0.04em', margin: 0 }}>
              Council Synthesis
            </p>
            <p style={{ fontSize: 11, color: 'var(--synthesis-text-sub)', marginTop: 1 }}>
              Blocked — upstream decision unresolved
            </p>
          </div>
        </div>
        {/* Body */}
        <div style={{ padding: '22px 24px 26px' }}>

          {/* The specific question to resolve — shown prominently when available */}
          {redirectQuestion ? (
            <>
              <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-4)', letterSpacing: '0.07em', textTransform: 'uppercase', margin: '0 0 10px' }}>
                Resolve this before returning
              </p>
              {/* Question callout box */}
              <div style={{
                padding: '16px 20px',
                borderRadius: 10,
                border: '1px solid rgba(201,168,76,0.35)',
                background: 'rgba(201,168,76,0.07)',
                margin: '0 0 18px',
              }}>
                <p style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--text-1)', lineHeight: 1.75, margin: 0 }}>
                  {redirectQuestion}
                </p>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.75, margin: '0 0 16px' }}>
                Any synthesis produced now would shift once this is resolved. The Council's individual
                perspectives are visible below — treat them as provisional context, not a final read.
              </p>
            </>
          ) : (
            <>
              <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-2)', lineHeight: 1.8, margin: '0 0 14px' }}>
                Synthesis cannot run on this decision yet.
              </p>
              <p style={{ fontSize: 13.5, color: 'var(--text-3)', lineHeight: 1.8, margin: '0 0 16px' }}>
                There is a prior question that must be resolved first — any synthesis produced now
                would shift once that upstream decision becomes clear. The Council's individual
                perspectives are visible below and remain useful as context.
              </p>
            </>
          )}

          <p style={{ fontSize: 12.5, color: 'var(--text-4)', lineHeight: 1.7, margin: '0 0 18px' }}>
            When the upstream question is resolved, return to Quorum and use{' '}
            <strong style={{ color: 'var(--text-3)' }}>Reanalyze</strong> to run a fresh session.
            Synthesis will run at that point.
          </p>

          {/* Override option — escape hatch when R1 misfired */}
          {onOverrideRedirect && (
            <div style={{ borderTop: '1px solid var(--border-dim)', paddingTop: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button
                onClick={onOverrideRedirect}
                style={{
                  padding: '8px 18px', borderRadius: 8,
                  border: '1px solid var(--border-mid)',
                  background: 'var(--overlay-bg)',
                  color: 'var(--text-3)', fontSize: 12, fontWeight: 500,
                  cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.01em',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'var(--overlay-bg-hover)'
                  ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-2)'
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'var(--overlay-bg)'
                  ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)'
                }}
              >
                This doesn't apply — continue to Council
              </button>
              <p style={{ fontSize: 11, color: 'var(--text-4)', margin: 0 }}>
                If the block doesn't fit your situation, proceed and synthesis will run.
              </p>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Normal synthesis card ─────────────────────────────────────────────────
  const isRecalibrating = state === 'streaming' && version > 0

  return (
    <div style={{
      gridColumn: '1 / -1',
      background: 'var(--bg-card)',
      border: `1px solid ${state === 'done' ? 'var(--green-border)' : state === 'streaming' ? 'var(--gold-dim)' : 'var(--border-dim)'}`,
      borderRadius: 14, marginBottom: 4, overflow: 'hidden', transition: 'border-color 0.3s',
    }}>
      {/* Header */}
      <div className="synth-header" style={{ padding: '14px 20px 12px', borderBottom: '1px solid var(--synthesis-border-sub)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 10, background: state === 'done' ? 'var(--synthesis-done)' : state === 'streaming' ? 'var(--synthesis-streaming)' : 'var(--synthesis-waiting)', borderRadius: '13px 13px 0 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gold)', flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v18M3 9l9-6 9 6M5 12l-2 5h4L5 12zM19 12l-2 5h4l-2-5zM3 21h18"/>
            </svg>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--gold)', lineHeight: 1.2, letterSpacing: '0.04em', margin: 0 }}>Council Synthesis</p>
              {registerMode && (
                <span style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 10,
                  border: `1px solid ${registerMode === 'clarification' ? 'var(--success-border)' : 'var(--gold-dim)'}`,
                  background: registerMode === 'clarification' ? 'var(--success-bg)' : 'rgba(201,168,76,0.08)',
                  color: registerMode === 'clarification' ? 'var(--green-text)' : 'var(--gold)',
                  fontWeight: 600, letterSpacing: '0.04em',
                }}>
                  {registerMode === 'clarification' ? '🪞 Values & Clarity' : '⚔ Challenge'}
                </span>
              )}
            </div>
            <p style={{ fontSize: 11, color: 'var(--synthesis-text-sub)', marginTop: 0 }}>
              {state === 'waiting' && !allDone ? `Waiting for advisors — ${completedCount} of ${totalPersonas} complete`
                : state === 'waiting' && allDone && !examinerReady ? 'Answer the Examiner questions to unlock synthesis'
                : state === 'streaming' && isRecalibrating ? 'Recalibrating after pushback…'
                : state === 'streaming' ? 'Writing the Council\'s conclusion…'
                : 'What the council collectively surfaced'}
            </p>
          </div>
        </div>

        <div className="synth-header-actions" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* ── Read aloud / Pause / Resume — Sprint 25 ── */}
          {state === 'done' && synthesis && (
            <>
              <button
                onClick={() => {
                  if (isThisSpeaking && isPaused) { resume(); return }
                  if (isThisSpeaking) { pause(); return }
                  speak(synthesis, 'synthesis')
                }}
                title={isThisSpeaking && isPaused ? 'Resume' : isThisSpeaking ? 'Pause' : 'Read aloud'}
                style={{
                  display:       'flex',
                  alignItems:    'center',
                  gap:           5,
                  padding:       '5px 11px',
                  borderRadius:  6,
                  border:        isThisSpeaking
                                   ? '1px solid var(--gold-dim)'
                                   : '1px solid var(--synthesis-btn-border)',
                  background:    isThisSpeaking
                                   ? 'rgba(201,168,76,0.12)'
                                   : 'transparent',
                  color:         isThisSpeaking
                                   ? 'var(--gold)'
                                   : 'var(--synthesis-btn-text)',
                  fontSize:      11.5,
                  fontWeight:    500,
                  cursor:        'pointer',
                  fontFamily:    'inherit',
                  transition:    'all 0.18s',
                  letterSpacing: '0.01em',
                }}
              >
                {isThisSpeaking && isLoading ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                    style={{ animation: 'spin 0.9s linear infinite' }}>
                    <path d="M21 12a9 9 0 1 1-6.22-8.56"/>
                  </svg>
                ) : isThisSpeaking && isPaused ? (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                ) : isThisSpeaking ? (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="5" y="4" width="4" height="16" rx="1"/><rect x="15" y="4" width="4" height="16" rx="1"/>
                  </svg>
                ) : (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                )}
                <span>
                  {isThisSpeaking && isLoading
                    ? (countdown !== null && countdown > 0 ? `~${countdown}s` : 'Starting…')
                    : isThisSpeaking && isPaused
                    ? 'Resume'
                    : isThisSpeaking
                    ? 'Pause'
                    : 'Read aloud'}
                </span>
              </button>

              {isThisSpeaking && (
                <button
                  onClick={() => stop()}
                  title="Stop"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '5px 9px', borderRadius: 6,
                    border: '1px solid var(--synthesis-btn-border)',
                    background: 'transparent',
                    color: 'var(--synthesis-btn-text)',
                    fontSize: 11.5, fontWeight: 500, cursor: 'pointer',
                    fontFamily: 'inherit', transition: 'all 0.18s',
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="4" y="4" width="16" height="16" rx="2"/>
                  </svg>
                  Stop
                </button>
              )}
            </>
          )}


          {/* ── Pace — Sprint 23b ── */}
          {state === 'done' && (
            <button
              onClick={() => {
                const rates = [1, 1.5, 2]
                const next = rates[(rates.indexOf(rate) + 1) % rates.length]
                setRate(next)
              }}
              title="Playback speed"
              style={{
                display:       'flex',
                alignItems:    'center',
                padding:       '5px 9px',
                borderRadius:  6,
                border:        rate !== 1
                                 ? '1px solid var(--gold-dim)'
                                 : '1px solid var(--synthesis-btn-border)',
                background:    rate !== 1
                                 ? 'rgba(201,168,76,0.10)'
                                 : 'transparent',
                color:         rate !== 1
                                 ? 'var(--gold)'
                                 : 'var(--synthesis-btn-text)',
                fontSize:      11,
                fontWeight:    600,
                cursor:        'pointer',
                fontFamily:    'inherit',
                transition:    'all 0.18s',
                letterSpacing: '0.02em',
                whiteSpace:    'nowrap',
              }}
            >
              {rate === 1 ? '1×' : rate === 1.5 ? '1.5×' : '2×'}
            </button>
          )}

          {/* Decision Brief — free, no gate */}
          {state === 'done' && briefState === 'idle' && (
            <button
              onClick={handleGenerateBrief}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 7, border: '1px solid var(--gold-dim)', background: 'rgba(201,168,76,0.1)', color: 'var(--gold)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.03em', transition: 'all 0.2s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(201,168,76,0.2)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(201,168,76,0.1)' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
              Generate Decision Brief
            </button>
          )}
          {briefState === 'streaming' && (
            <span style={{ fontSize: 11, color: 'var(--gold)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--gold)', display: 'inline-block', animation: 'blink 1s step-end infinite' }} />
              Writing Brief…
            </span>
          )}
          {briefState === 'done' && (
            <button onClick={() => setShowBrief(b => !b)} style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid var(--synthesis-btn-border)', background: 'transparent', color: 'var(--synthesis-btn-text)', cursor: 'pointer', fontFamily: 'inherit' }}>
              {showBrief ? 'Hide Brief' : 'Show Brief'}
            </button>
          )}

          {state === 'waiting' && (
            <div style={{ display: 'flex', gap: 4 }}>
              {Array.from({ length: totalPersonas }).map((_, i) => (
                <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: i < completedCount ? 'var(--gold)' : 'var(--border-mid)', transition: 'background 0.3s' }} />
              ))}
            </div>
          )}
          {state === 'streaming' && (
            <span style={{ fontSize: 11, color: 'var(--gold)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)', display: 'inline-block', animation: 'blink 1s step-end infinite' }} />
              {isRecalibrating ? 'Recalibrating' : 'Synthesising'}
            </span>
          )}
          {state === 'done'  && !briefState.match(/streaming|done/) && <span style={{ fontSize: 11, color: 'var(--success-text)' }}>✓ Complete</span>}
          {state === 'error' && <span style={{ fontSize: 11, color: '#e05050' }}>✗ Error</span>}
        </div>
      </div>

      {/* Synthesis body */}
      <div style={{ padding: '18px 20px' }}>
        {state === 'waiting' && (
          <p style={{ fontSize: 13, color: 'var(--text-4)', fontStyle: 'italic' }}>
            Synthesis will appear once all six advisors complete their assessment.
          </p>
        )}
        {(state === 'streaming' || state === 'done') && synthesis !== undefined && (
          <>
            {/* S1-03: Verdict block — one sentence, display font, prominent */}
            {verdictText && (
              <div style={{
                borderLeft:   '5px solid var(--verdict-accent)',
                background:   'var(--verdict-bg)',
                borderRadius: '0 10px 10px 0',
                padding:      '14px 20px',
                marginBottom: 22,
                boxShadow:    'var(--verdict-shadow)',
              }}>
                <p style={{
                  fontFamily:    'var(--font-mono)',
                  fontSize:      9,
                  fontWeight:    700,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color:         'var(--verdict-accent)',
                  margin:        '0 0 8px',
                }}>
                  Council verdict
                </p>
                <p style={{
                  fontFamily:    'var(--font-display)',
                  fontSize:      17,
                  fontWeight:    500,
                  color:         'var(--text-1)',
                  lineHeight:    1.65,
                  letterSpacing: '-0.01em',
                  margin:        0,
                }}>
                  {firstSentence(verdictText)}
                  {parseModeRef.current === 'verdict' && (
                    <span style={{ opacity: 0.35, marginLeft: 2 }}>▊</span>
                  )}
                </p>
              </div>
            )}
            {/* Main prose — tension highlighted inline once streaming completes */}
            {synthesis && (
              <p style={{
                fontSize:    14,
                lineHeight:  1.85,
                color:       'var(--text-1)',
                whiteSpace:  'pre-wrap',
                letterSpacing: '0.01em',
              }}
                className={state === 'streaming' ? 'cursor' : ''}
              >
                {renderProse(synthesis, state === 'done')}
              </p>
            )}
          </>
        )}

        {/* Mirror nudge — shown once synthesis completes (Sprint 19) */}
        {state === 'done' && synthesis && (
          <div style={{
            marginTop:    16,
            paddingTop:   14,
            borderTop:    '1px solid var(--border-dim)',
            display:      'flex',
            alignItems:   'center',
            justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 12, color: 'var(--text-4)', lineHeight: 1.5 }}>
              This decision has been added to your Mirror profile.
            </span>
            <a
              href="/mirror"
              style={{
                fontSize:       12,
                color:          'var(--gold)',
                textDecoration: 'none',
                fontWeight:     600,
                whiteSpace:     'nowrap',
                marginLeft:     16,
                flexShrink:     0,
              }}
            >
              View Mirror →
            </a>
          </div>
        )}
        {state === 'streaming' && !synthesis && (
          <p style={{ fontSize: 13, color: 'var(--text-4)', fontStyle: 'italic' }}>Reading all perspectives…</p>
        )}
        {state === 'error' && (
          <p style={{ fontSize: 13, color: '#e05050' }}>Synthesis failed. Advisor responses are still available below.</p>
        )}
      </div>

      {/* Decision Brief section */}
      {showBrief && (briefState === 'streaming' || briefState === 'done' || briefState === 'error') && (
        <div style={{ borderTop: '1px solid var(--gold-dim)', margin: '0 20px', paddingTop: 0 }}>
          <div style={{ padding: '14px 0 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold)', margin: 0, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Decision Brief
              </p>
              <span style={{ fontSize: 10, color: 'var(--text-4)', padding: '2px 8px', borderRadius: 10, border: '1px solid var(--border-dim)', background: 'var(--bg-inset)' }}>
                Printable · Shareable
              </span>
            </div>
            {briefState === 'done' && (
              <span style={{ fontSize: 11, color: 'var(--green-text)' }}>✓</span>
            )}
          </div>

          <div style={{
            background: 'rgba(201,168,76,0.04)',
            border: '1px solid rgba(201,168,76,0.15)',
            borderRadius: 10,
            padding: '20px 22px',
            marginBottom: 20,
          }}>
            {briefText && (
              <div style={{ fontSize: 13, lineHeight: 1.9, color: 'var(--text-1)', whiteSpace: 'pre-wrap', fontFamily: 'Georgia, var(--font-serif), serif' }}
                className={briefState === 'streaming' ? 'cursor' : ''}>
                {briefText.split('\n').map((line, i) => {
                  const isLabel = /^[A-Z][A-Z\s]+$/.test(line.trim()) && line.trim().length > 2 && line.trim().length < 40
                  return (
                    <p key={i} style={{
                      margin: isLabel ? '16px 0 4px' : '0 0 2px',
                      fontSize: isLabel ? 10.5 : 13,
                      fontWeight: isLabel ? 700 : 400,
                      color: isLabel ? 'var(--gold)' : 'var(--text-1)',
                      fontFamily: isLabel ? 'var(--font-sans)' : 'Georgia, serif',
                      letterSpacing: isLabel ? '0.12em' : '0.01em',
                      textTransform: isLabel ? 'uppercase' : 'none',
                    }}>
                      {line || '\u00A0'}
                    </p>
                  )
                })}
              </div>
            )}
            {!briefText && briefState === 'streaming' && (
              <p style={{ fontSize: 13, color: 'var(--text-4)', fontStyle: 'italic' }}>Drafting brief…</p>
            )}
            {briefState === 'error' && (
              <p style={{ fontSize: 13, color: '#e05050' }}>Brief generation failed. Please try again.</p>
            )}
          </div>
        </div>
      )}

      <style>{`
        @media (max-width: 640px) {
          .synth-header {
            padding: 12px 14px 10px;
          }
          .synth-header-actions {
            width: 100%;
            justify-content: flex-start;
            gap: 6px;
          }
        }
        @media (max-width: 380px) {
          .synth-header-actions > button,
          .synth-header-actions > div > button {
            font-size: 10.5px;
            padding: 5px 8px;
          }
        }
      `}</style>
    </div>
  )
}
