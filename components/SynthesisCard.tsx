'use client'

import { useEffect, useState, useRef } from 'react'
import { useTTSContext } from '@/context/TTSContext'

// ── Brief access gate helpers ─────────────────────────────────
const BRIEF_KEY = 'brief_token'

function getStoredBriefCode(): string | null {
  if (typeof window === 'undefined') return null
  try { return localStorage.getItem(BRIEF_KEY) } catch { return null }
}
function storeBriefCode(code: string) {
  try { localStorage.setItem(BRIEF_KEY, code) } catch {}
}

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
}: Props) {
  const [synthesis,    setSynthesis]   = useState('')
  const [state,        setState]       = useState<State>('waiting')
  const [briefText,    setBriefText]   = useState('')
  const [briefState,   setBriefState]  = useState<'idle'|'streaming'|'done'|'error'>('idle')
  const [showBrief,    setShowBrief]   = useState(false)

  // Paid access gate
  const [briefAccess,  setBriefAccess] = useState<'unknown'|'open'|'gated'>('unknown')
  const [tokenInput,   setTokenInput]  = useState('')
  const [tokenError,   setTokenError]  = useState('')
  const [checkingToken,setCheckingToken] = useState(false)

  const [briefGate,    setBriefGate]   = useState<'locked'|'prompt'|'checking'|'unlocked'|'invalid'>('locked')
  const [accessCode,   setAccessCode]  = useState('')

  // ── TTS ───────────────────────────────────────────────────────────────────
  const { speak, stop, isSpeaking, isLoading, activeSpeakerId, rate, setRate } = useTTSContext()
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

  useEffect(() => { responsesRef.current  = personaResponses }, [personaResponses])

  useEffect(() => {
    const stored = getStoredBriefCode()
    if (stored) setBriefGate('unlocked')
  }, [])
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

    const run = async () => {
      const latest = responsesRef.current
      const personaBlock = Object.entries(latest)
        .map(([k, v]) => `[${k.toUpperCase().replace(/_/g, ' ')}]\n${v.slice(0, 800)}`)
        .join('\n\n---\n\n')
      const ctx = contextRef.current ? `\nCONTEXT:\n${contextRef.current}\n` : ''
      const msg = `DECISION: ${decisionRef.current}${ctx}\n\nADVISOR RESPONSES:\n\n${personaBlock}\n\nNow produce the council synthesis.`

      try {
        const res = await fetch('/api/persona', {
          method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionIdRef.current, personaKey: 'synthesis', messages: [{ role: 'user', content: msg }], decisionText: decisionRef.current, contextText: contextRef.current, rawMessages: true, token: getStoredBriefCode() || accessCode || tokenInput }),
        })
        if (!res.ok || !res.body) { setState('error'); return }
        const reader = res.body.getReader()
        const dec    = new TextDecoder()
        let acc = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (ctrl.signal.aborted) return
          acc += dec.decode(value, { stream: true })
          setSynthesis(acc)
        }
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

  const handleValidateCode = async () => {
    if (!accessCode.trim()) return
    setBriefGate('checking')
    try {
      const res = await fetch('/api/brief-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: accessCode.trim() }),
      })
      const { valid } = await res.json()
      if (valid) {
        storeBriefCode(accessCode.trim())
        setBriefGate('unlocked')
      } else {
        setBriefGate('invalid')
      }
    } catch {
      setBriefGate('invalid')
    }
  }

  const checkBriefAccess = async () => {
    setCheckingToken(true)
    setTokenError('')
    try {
      const res = await fetch('/api/brief-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenInput.trim() }),
      })
      const { valid } = await res.json()
      if (valid) {
        setBriefAccess('open')
        handleGenerateBrief()
      } else {
        setTokenError('Invalid access code. Contact Kunal to get access.')
      }
    } catch {
      setTokenError('Could not verify. Please try again.')
    } finally {
      setCheckingToken(false)
    }
  }

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
                  background: 'rgba(255,255,255,0.04)',
                  color: 'var(--text-3)', fontSize: 12, fontWeight: 500,
                  cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.01em',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)'
                  ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-2)'
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'
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
      <div style={{ padding: '14px 20px 12px', borderBottom: '1px solid var(--synthesis-border-sub)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: state === 'done' ? 'var(--synthesis-done)' : state === 'streaming' ? 'var(--synthesis-streaming)' : 'var(--synthesis-waiting)', borderRadius: '13px 13px 0 0' }}>
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
                  border: `1px solid ${registerMode === 'clarification' ? 'rgba(74,222,128,0.4)' : 'var(--gold-dim)'}`,
                  background: registerMode === 'clarification' ? 'rgba(74,222,128,0.08)' : 'rgba(201,168,76,0.08)',
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
                : state === 'streaming' ? 'Synthesising across all perspectives…'
                : 'What the council collectively surfaced'}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* ── Read aloud — Sprint 23b ── */}
          {state === 'done' && synthesis && (
            <button
              onClick={() => {
                if (isThisSpeaking) {
                  stop()
                } else {
                  speak(synthesis, 'synthesis')
                }
              }}
              title={isThisSpeaking ? 'Stop' : 'Read aloud'}
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
              ) : isThisSpeaking ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="4" y="4" width="16" height="16" rx="2"/>
                </svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
              )}
              <span>
                {isThisSpeaking && isLoading ? '' : isThisSpeaking ? 'Stop' : 'Read aloud'}
              </span>
            </button>
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

          {/* Decision Brief — gated */}
          {state === 'done' && briefState === 'idle' && briefGate === 'locked' && (
            <button
              onClick={() => setBriefGate('prompt')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 7, border: '1px solid var(--synthesis-btn-border)', background: 'transparent', color: 'var(--synthesis-btn-text)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              Decision Brief (paid)
            </button>
          )}
          {state === 'done' && briefState === 'idle' && briefGate === 'prompt' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="text"
                placeholder="Enter access code"
                value={accessCode}
                onChange={e => { setAccessCode(e.target.value); setBriefGate('prompt') }}
                onKeyDown={e => e.key === 'Enter' && handleValidateCode()}
                style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border-mid)', background: 'var(--bg-inset)', color: 'var(--text-1)', outline: 'none', width: 140, fontFamily: 'inherit' }}
                autoFocus
              />
              <button
                onClick={handleValidateCode}
                style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--gold-dim)', background: 'rgba(201,168,76,0.1)', color: 'var(--gold)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Unlock
              </button>
              <button onClick={() => setBriefGate('locked')} style={{ fontSize: 11, color: 'var(--text-4)', background: 'none', border: 'none', cursor: 'pointer', padding: '5px' }}>✕</button>
            </div>
          )}
          {state === 'done' && briefGate === 'checking' && (
            <span style={{ fontSize: 11, color: 'var(--text-4)' }}>Checking…</span>
          )}
          {state === 'done' && briefGate === 'invalid' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: '#e05050' }}>Invalid code</span>
              <button onClick={() => { setBriefGate('prompt'); setAccessCode('') }} style={{ fontSize: 11, color: 'var(--gold)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }}>Try again</button>
            </div>
          )}
          {state === 'done' && briefState === 'idle' && briefGate === 'unlocked' && (
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
          {state === 'done'  && !briefState.match(/streaming|done/) && <span style={{ fontSize: 11, color: 'rgba(74,222,128,0.9)' }}>✓ Complete</span>}
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
        {(state === 'streaming' || state === 'done') && synthesis && (
          <p style={{ fontSize: 14, lineHeight: 1.85, color: 'var(--text-1)', whiteSpace: 'pre-wrap', letterSpacing: '0.01em' }}
            className={state === 'streaming' ? 'cursor' : ''}>
            {synthesis}
          </p>
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

      {/* Token gate */}
      {briefAccess === 'gated' && briefState === 'idle' && (
        <div style={{ borderTop: '1px solid var(--gold-dim)', padding: '18px 20px' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--gold)', marginBottom: 4 }}>
            Decision Brief — Paid Feature
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 14 }}>
            The Decision Brief is a formatted, shareable document for boards and co-founders.
            It requires an access code. To get access, message Kunal directly.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              placeholder="Enter access code…"
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') checkBriefAccess() }}
              style={{ flex: 1, background: 'var(--bg-inset)', border: '1px solid var(--border-mid)', color: 'var(--text-1)', borderRadius: 7, padding: '8px 12px', fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
            />
            <button
              onClick={checkBriefAccess}
              disabled={checkingToken || !tokenInput.trim()}
              style={{ padding: '8px 16px', borderRadius: 7, border: '1px solid var(--gold-dim)', background: 'rgba(201,168,76,0.1)', color: 'var(--gold)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {checkingToken ? '…' : 'Unlock'}
            </button>
          </div>
          {tokenError && <p style={{ fontSize: 11, color: '#e05050', marginTop: 8 }}>{tokenError}</p>}
        </div>
      )}

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
    </div>
  )
}
