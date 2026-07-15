'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'   // S3-07: Observatory mode overlay
import { useTTSContext } from '@/context/TTSContext'
import CouncilWeightingStrip from './CouncilWeightingStrip'   // S2-02
import WhatChangedDrawer from './WhatChangedDrawer'            // P1
import ResearchVideoCard from './ResearchVideoCard'           // Video 2 — research explainer
import type { PersonaRelevanceMap } from '@/lib/persona-relevance'  // S2-02
import type { SynthesisVersionSnapshot } from '@/lib/synthesis-diff'  // P1
import { getOrCreateDeviceId } from '@/lib/storage'                  // S2-01

interface Props {
  sessionId:         string
  decisionText:      string
  contextText?:      string
  personaResponses:  Record<string, string>
  totalPersonas:     number
  version:           number
  registerMode?:     'analytical' | 'clarification'
  examinerReady?:    boolean
  redirectBlocked?:  boolean
  redirectQuestion?: string
  onOverrideRedirect?: () => void
  onSynthesisStart?: () => void
  onSynthesisComplete?: () => void
  examinerContext?: string
  /** S2-02: persona relevance weights computed in SessionView — drives CouncilWeightingStrip */
  personaWeights?:   PersonaRelevanceMap | null
  /** S2-05: true when prior session's validation correction was carried into this council */
  hasValidationCorrection?: boolean
  /** S3-01: false while the pre-synthesis tension interstitial is showing — synthesis
   *  fetch waits until this flips true, same pattern as the other readiness gates. */
  interstitialGateOpen?: boolean
  /** O3: Mirror subscription state — gates the auto-surfaced Decision-Maker Observation line */
  mirrorActive?: boolean
  /** Bug fix: raw synthesis text already persisted in `messages` for this session
   *  (persona='synthesis'), loaded server-side in app/session/[id]/page.tsx the same
   *  way PersonaPanel's initialContent works. When present, the synthesis is rendered
   *  from this cached text instead of re-streaming a brand-new AI synthesis — previously
   *  navigating back to SessionView (e.g. from the record page) re-ran the full council
   *  synthesis every time, even though all six advisor panels correctly reused their
   *  cached output. Only consulted for the FIRST synthesis (version 0); explicit
   *  re-syntheses (validation correction, examiner update) still regenerate normally. */
  initialContent?: string
  /** P1: current lean-classification snapshot (SessionView's personaLeans),
   *  updated live as pushback replies come in. Used to (a) compute leanShifts
   *  sent to the synthesis API for the Gap #2 weight boost, and (b) capture
   *  into each version snapshot for the What Changed drawer's advisor-moves
   *  diff. Not the same thing as the persisted per-version snapshots below —
   *  this is always "right now". */
  personaLeans?: Record<string, string>
  /** P1: persisted synthesis-version history for this session (verdict/
   *  weights/leans per version) — reload resilience for the What Changed
   *  drawer, same pattern as SessionView's examinerSavedResponses. Only
   *  meaningful for version 0 (SessionView already scopes this to
   *  sessionKey === 0 before passing it down). */
  initialSynthesisVersions?: SynthesisVersionSnapshot[]
}

type State = 'waiting' | 'streaming' | 'done' | 'error'

export default function SynthesisCard({
  sessionId, decisionText, contextText,
  personaResponses, totalPersonas, version,
  registerMode, examinerReady,
  redirectBlocked,
  redirectQuestion,
  onOverrideRedirect,
  onSynthesisStart,
  onSynthesisComplete,
  examinerContext,
  personaWeights,          // S2-02
  hasValidationCorrection, // S2-05
  interstitialGateOpen = true, // S3-01 — defaults true so it's never a silent regression if unset
  mirrorActive, // O3
  initialContent, // bug fix: cached synthesis text — skips regeneration when present
  personaLeans = {},              // P1
  initialSynthesisVersions = [],  // P1
}: Props) {
  // Bug fix: strip tags out of cached initialContent the same way the streaming
  // loop's final pass does, so a returning visit renders identically to a freshly
  // completed synthesis instead of showing raw <verdict>/<tension> markup.
  const stripSynthesisTags = (raw: string): string =>
    raw
      .replace(/<verdict>[\s\S]*?<\/verdict>\n*/g, '')
      .replace(/<verdict>[\s\S]*/g, '')
      .replace(/<\/?tension>/g, '')
      .trimStart()

  const [synthesis,    setSynthesis]   = useState(() => initialContent ? stripSynthesisTags(initialContent) : '')
  const [state,        setState]       = useState<State>(initialContent ? 'done' : 'waiting')
  const [briefText,    setBriefText]   = useState('')
  const [briefState,   setBriefState]  = useState<'idle'|'streaming'|'done'|'error'>('idle')
  const [showBrief,    setShowBrief]   = useState(false)

  // S2-01: post-synthesis confidence re-rate
  const [confidenceRated,     setConfidenceRated]     = useState(false)
  const [ratedValue,          setRatedValue]          = useState<number | null>(null)

  // S2-02: persona relevance weights — read from X-Persona-Relevance response header,
  // the exact map used in the synthesis directive (not a client-side recomputation).
  const [fetchedWeights, setFetchedWeights] = useState<PersonaRelevanceMap | null>(null)

  // S3-07: Observatory mode — opt-in focus overlay, triggered only by an explicit
  // "Focus mode" button (never automatic on TTS start). Dims everything but the
  // synthesis text and locks scroll, no word-level tracking.
  const [focusModeActive, setFocusModeActive] = useState(false)

  // O3: Decision-Maker Observation — auto-fetched once synthesis completes, for
  // Mirror subscribers only. Cached server-side after first generation.
  const [decisionObservation, setDecisionObservation] = useState<string | null>(null)
  const [observationFetched,  setObservationFetched]  = useState(false)

  // S1-03: verdict + tension
  const [verdictText,  setVerdictText]  = useState(() => {
    if (!initialContent) return ''
    const m = initialContent.match(/<verdict>([\s\S]*?)<\/verdict>/)
    return m?.[1]?.trim() ?? ''
  })
  const [tensionText,  setTensionText]  = useState(() => {
    if (!initialContent) return ''
    const m = initialContent.match(/<tension>([\s\S]*?)<\/tension>/)
    return m?.[1]?.trim() ?? ''
  })
  const parseModeRef   = useRef<'prose' | 'verdict' | 'tension'>('prose')
  const verdictAccRef  = useRef('')
  const tensionAccRef  = useRef('')
  // Raw accumulated stream text — used by renderProse to locate tension tags
  // without relying on trimmed state strings (avoids whitespace indexOf mismatches).
  // Bug fix: seed with initialContent so renderProse's tension-highlight logic works
  // identically for a cached synthesis as it does for a freshly streamed one.
  const rawAccRef = useRef(initialContent ?? '')

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

  // S2-01: post-synthesis confidence re-rate — fire-and-forget PATCH
  const handleRateConfidence = useCallback(async (value: number) => {
    setConfidenceRated(true)
    setRatedValue(value)
    try {
      await fetch(`/api/session/${sessionId}/confidence`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          post_decision_confidence: value,
          device_id: getOrCreateDeviceId(),
        }),
      })
    } catch { /* non-blocking — UI already updated */ }
  }, [sessionId])

  // Bug fix: a cached synthesis is already "complete" from SessionView's point of
  // view (badge, record receipt, contradiction/bias-note fetches, etc. all gate on
  // onSynthesisComplete having fired) — fire it once on mount instead of waiting on
  // a network call that will never arrive because we're not making one.
  const initialContentFiredRef = useRef(false)
  useEffect(() => {
    if (initialContent && !initialContentFiredRef.current) {
      initialContentFiredRef.current = true
      onSynthesisComplete?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const completedCount = Object.keys(personaResponses).length

  // O3: once synthesis completes, auto-fetch the Decision-Maker Observation for
  // Mirror subscribers. Fire-and-forget; failure just means the line doesn't show.
  useEffect(() => {
    if (state !== 'done' || !synthesis || !mirrorActive || observationFetched) return
    setObservationFetched(true)
    fetch(`/api/session/${sessionId}/observation`, { method: 'POST' })
      .then(r => r.json())
      .then(data => setDecisionObservation(data.observation ?? null))
      .catch(() => setDecisionObservation(null))
  }, [state, synthesis, mirrorActive, observationFetched, sessionId])

  // S3-07: lock page scroll while Observatory mode is open, and allow Escape to exit
  useEffect(() => {
    if (!focusModeActive) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFocusModeActive(false) }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [focusModeActive])
  const allDone        = completedCount >= totalPersonas
  const abortRef       = useRef<AbortController | null>(null)
  const briefAbortRef  = useRef<AbortController | null>(null)
  const responsesRef   = useRef(personaResponses)
  const decisionRef    = useRef(decisionText)
  const contextRef     = useRef(contextText)
  const sessionIdRef   = useRef(sessionId)
  const registerRef    = useRef(registerMode)
  const examinerContextRef = useRef(examinerContext)
  // P1: What Changed drawer state — one snapshot per completed synthesis version.
  const [versionHistory, setVersionHistory] = useState<SynthesisVersionSnapshot[]>(initialSynthesisVersions)
  const versionHistoryRef = useRef(versionHistory)
  const personaLeansRef = useRef(personaLeans)

  useEffect(() => { responsesRef.current       = personaResponses }, [personaResponses])
  useEffect(() => { examinerContextRef.current = examinerContext  }, [examinerContext])
  useEffect(() => { personaLeansRef.current     = personaLeans     }, [personaLeans])
  useEffect(() => { versionHistoryRef.current   = versionHistory   }, [versionHistory])

  useEffect(() => { decisionRef.current  = decisionText  }, [decisionText])
  useEffect(() => { contextRef.current   = contextText   }, [contextText])
  useEffect(() => { sessionIdRef.current = sessionId     }, [sessionId])
  useEffect(() => { registerRef.current  = registerMode  }, [registerMode])

  // Fire synthesis — gated on examinerReady AND not redirectBlocked (Sprint 11b)
  // S3-01: also gated on interstitialGateOpen — holds for the brief tension-interstitial
  // beat once all advisors finish, before the actual synthesis fetch begins.
  useEffect(() => {
    if (!allDone || !examinerReady || redirectBlocked || !interstitialGateOpen) return   // Sprint 11b: redirectBlocked blocks synthesis permanently
    // Bug fix: version 0 is the initial synthesis. If we already loaded a persisted
    // synthesis for this session (e.g. user navigated back to SessionView from the
    // record page), skip re-running it — the six persona panels already do this via
    // their own initialContent prop; synthesis was the one place still re-firing a
    // brand-new AI call (and inserting a duplicate row into `messages`) every time.
    // Explicit re-syntheses (validation correction, examiner follow-up) bump version
    // past 0 and are intentionally NOT skipped — those must regenerate for real.
    if (version === 0 && initialContent) return
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

      // P1 (Gap #2 fix): diff current leans against the PREVIOUS synthesis
      // version's lean snapshot (not the very first response ever) — this is
      // what makes "shifted position" mean "just now", not "at some point".
      // Empty on the very first synthesis (nothing to diff against yet).
      const previousVersionSnapshot = versionHistoryRef.current[versionHistoryRef.current.length - 1]
      const leanShifts: Record<string, { from: string; to: string }> = {}
      if (previousVersionSnapshot) {
        for (const [key, currentLean] of Object.entries(personaLeansRef.current)) {
          const previousLean = previousVersionSnapshot.leans[key]
          if (previousLean && currentLean && previousLean !== currentLean) {
            leanShifts[key] = { from: previousLean, to: currentLean }
          }
        }
      }

      let resolvedWeights: PersonaRelevanceMap | null = null

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
            // P1 (Gap #2 fix): only send when non-empty — keeps the request
            // body identical to today's for the very first synthesis.
            leanShifts: Object.keys(leanShifts).length > 0 ? leanShifts : undefined,
          }),
        })
        if (!res.ok || !res.body) { setState('error'); return }
        // S2-02: capture the exact relevance map used in this synthesis run
        const relevanceHeader = res.headers.get('X-Persona-Relevance')
        if (relevanceHeader) {
          try {
            resolvedWeights = JSON.parse(relevanceHeader)
            setFetchedWeights(resolvedWeights)
          } catch { /* non-blocking */ }
        }
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

        // P1: capture this version's snapshot for the What Changed drawer.
        // Uses the verdict just parsed above (falls back to whatever was
        // accumulated via the per-chunk parser, same as the state setters
        // right above) and the weights resolved from THIS response's header
        // (resolvedWeights, a local var — reading fetchedWeights state here
        // would be stale within this same closure).
        const snapshotVerdict = fv?.[1]?.trim() || verdictAccRef.current || ''
        const snapshot: SynthesisVersionSnapshot = {
          version,
          verdictText: snapshotVerdict,
          weights:     resolvedWeights ?? {},
          leans:       personaLeansRef.current,
        }
        setVersionHistory(prev => [...prev.filter(v => v.version !== version), snapshot])
        fetch(`/api/session/${sessionIdRef.current}/synthesis-version`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(snapshot),
        }).catch(() => { /* non-blocking — drawer still works for this live session */ })
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') return
        setState('error')
      }
    }
    run()
    return () => { ctrl.abort() }
  }, [allDone, examinerReady, redirectBlocked, interstitialGateOpen, version, initialContent]) // eslint-disable-line react-hooks/exhaustive-deps

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
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: 'var(--gold)', lineHeight: 1.2, letterSpacing: '0.01em', margin: 0 }}>
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
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: 'var(--gold)', lineHeight: 1.2, letterSpacing: '0.01em', margin: 0 }}>Council Synthesis</p>
              {registerMode && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontSize: 10,
                  color: registerMode === 'clarification' ? 'var(--green-text)' : 'var(--gold)',
                  fontWeight: 600, letterSpacing: '0.04em', opacity: 0.85,
                }}>
                  ·
                  {registerMode === 'clarification' ? (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>
                    </svg>
                  ) : (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="9"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                    </svg>
                  )}
                  {registerMode === 'clarification' ? 'Values & Clarity' : 'Challenge'}
                </span>
              )}
            </div>
            <p style={{ fontSize: 11, color: 'var(--synthesis-text-sub)', marginTop: 0 }}>
              {state === 'waiting' && !allDone ? `Waiting for advisors — ${completedCount} of ${totalPersonas} complete`
                : state === 'waiting' && allDone && !examinerReady ? 'Answer the questions to unlock synthesis'
                : state === 'waiting' && allDone && examinerReady && !interstitialGateOpen ? 'Weighing the Council\u2019s tension…'
                : state === 'streaming' && isRecalibrating ? 'Recalibrating after pushback…'
                : state === 'streaming' ? 'Writing the Council\'s conclusion…'
                : 'What the council collectively surfaced'}
            </p>
            {/* S2-05: passive signal — shown when prior correction was carried into this council */}
            {hasValidationCorrection && (
              <p style={{
                fontSize:   10.5,
                color:      'var(--gold)',
                marginTop:  3,
                display:    'flex',
                alignItems: 'center',
                gap:        5,
                lineHeight: 1.3,
              }}>
                <span style={{
                  width: 5, height: 5, borderRadius: '50%',
                  background: 'var(--gold)', display: 'inline-block', flexShrink: 0,
                }} />
                Your correction from your last session was shared with this Council.
              </p>
            )}
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

          {/* ── S3-07: Focus mode (Observatory) — opt-in, never automatic ── */}
          {state === 'done' && synthesis && (
            <button
              onClick={() => {
                setFocusModeActive(true)
                if (!isThisSpeaking) speak(synthesis, 'synthesis')
              }}
              title="Focus mode — dims the page and enlarges the synthesis"
              style={{
                display:       'flex',
                alignItems:    'center',
                gap:           5,
                padding:       '5px 11px',
                borderRadius:  6,
                border:        '1px solid var(--synthesis-btn-border)',
                background:    'transparent',
                color:         'var(--synthesis-btn-text)',
                fontSize:      11.5,
                fontWeight:    500,
                cursor:        'pointer',
                fontFamily:    'inherit',
                transition:    'all 0.18s',
                letterSpacing: '0.01em',
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
              </svg>
              Focus mode
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
      {/* Item #33/#34 (audit §2.1): the waiting state used to repeat the header
          subtitle ("Waiting for advisors...") as a second, italic sentence
          below a full 18/20px padding block — pure restatement, no new
          information, and it made this card the same visual weight while
          empty as it has once synthesis actually has something to say.
          Dropped for state === 'waiting'; header subtitle above already
          carries this across every waiting sub-phase. */}
      <div style={{ padding: state === 'waiting' ? 0 : '18px 20px' }}>
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
          <>
            {/* S2-02: Council Weighting Strip — shows advisor weighting for this decision.
                Same for all tiers (locked, teaser, unlocked) — explains the synthesis they
                already received. Only renders when at least one advisor is elevated above baseline. */}
            {(fetchedWeights ?? personaWeights) && (
              <CouncilWeightingStrip weights={(fetchedWeights ?? personaWeights)!} />
            )}

            {/* P1: What Changed drawer — renders nothing until there are at least
                2 synthesis versions, so a single-pass decision shows no extra UI. */}
            <WhatChangedDrawer versions={versionHistory} />

            {/* Video 2 (research explainer) — always rendered here, independent of
                whether CouncilWeightingStrip itself rendered above, so it reaches
                every completed session rather than only decisions with an elevated
                advisor. See ResearchVideoCard.tsx for the seen/session-count logic. */}
            <ResearchVideoCard />

            {/* S2-01: Post-synthesis confidence re-rate — 3-tap widget.
                Measures clarity delta vs pre_decision_confidence.
                Shows low-confidence action hint if user rates ≤5. */}
            {!confidenceRated ? (
              <div style={{
                marginTop:  16,
                paddingTop: 14,
                borderTop:  '1px solid var(--border-dim)',
              }}>
                <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 10px', lineHeight: 1.4 }}>
                  Where does your clarity sit now?
                </p>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                  {[
                    { label: '1–5 · Still unclear',      value: 3  },
                    { label: '6–8 · Somewhat clearer',   value: 7  },
                    { label: '9–10 · Clear now',          value: 9  },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => handleRateConfidence(opt.value)}
                      style={{
                        padding:      '7px 14px',
                        borderRadius:  8,
                        border:        '1px solid var(--border-mid)',
                        background:    'transparent',
                        color:         'var(--text-3)',
                        fontSize:      12,
                        cursor:        'pointer',
                        fontFamily:    'inherit',
                        transition:    'all 0.15s',
                        lineHeight:    1.3,
                      }}
                      onMouseEnter={e => {
                        const b = e.currentTarget as HTMLButtonElement
                        b.style.borderColor = 'var(--gold-dim)'
                        b.style.color = 'var(--text-1)'
                      }}
                      onMouseLeave={e => {
                        const b = e.currentTarget as HTMLButtonElement
                        b.style.borderColor = 'var(--border-mid)'
                        b.style.color = 'var(--text-3)'
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{
                marginTop:  16,
                paddingTop: 14,
                borderTop:  '1px solid var(--border-dim)',
                display:    'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <span style={{ fontSize: 12, color: 'var(--success-text)' }}>
                  Noted ✓
                </span>
                {ratedValue !== null && ratedValue <= 5 && (
                  <span style={{ fontSize: 12, color: 'var(--text-4)', marginLeft: 12 }}>
                    Still foggy — try reanalyzing once you have more clarity.
                  </span>
                )}
              </div>
            )}

            {/* Mirror nudge row */}
            <div style={{
              marginTop:    12,
              paddingTop:   12,
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

            {/* O3: Decision-Maker Observation — the most psychologically pointed output
                Quorum produces, previously buried behind Generate Brief → a separate page.
                Mirror subscribers only. Placed last — a quiet closing line, not a headline. */}
            {decisionObservation && (
              <p style={{
                marginTop:  14,
                fontSize:   12.5,
                fontStyle:  'italic',
                color:      'var(--text-3)',
                lineHeight: 1.6,
                textAlign:  'center',
              }}>
                — {decisionObservation}
              </p>
            )}
          </>
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

      {/* ── S3-07: Observatory mode overlay — opt-in focus view, no word-level tracking.
          Portalled to document.body so it sits above everything regardless of where
          SynthesisCard is mounted in the tree. */}
      {focusModeActive && synthesis && typeof document !== 'undefined' && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position:   'fixed',
            inset:      0,
            zIndex:     9999,
            background: 'var(--bg-void)',
            display:    'flex',
            flexDirection: 'column',
            alignItems: 'center',
            overflowY:  'auto',
            padding:    '48px 24px',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setFocusModeActive(false) }}
        >
          <button
            onClick={() => setFocusModeActive(false)}
            title="Exit focus mode (Esc)"
            style={{
              position:     'fixed',
              top:          20,
              right:        20,
              width:        38,
              height:       38,
              borderRadius: '50%',
              border:       '1px solid var(--border-mid)',
              background:   'var(--bg-card)',
              color:        'var(--text-3)',
              fontSize:     18,
              cursor:       'pointer',
              display:      'flex',
              alignItems:   'center',
              justifyContent: 'center',
            }}
          >
            ✕
          </button>

          <div style={{ maxWidth: 680, width: '100%', margin: 'auto 0' }}>
            <p style={{
              fontSize:      11,
              fontWeight:    700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color:         'var(--gold)',
              textAlign:     'center',
              margin:        '0 0 28px',
            }}>
              Council Synthesis
            </p>
            {verdictText && (
              <p style={{
                fontSize:   22,
                fontWeight: 600,
                fontFamily: 'var(--font-display)',
                color:      'var(--gold)',
                textAlign:  'center',
                lineHeight: 1.5,
                margin:     '0 0 28px',
              }}>
                {firstSentence(verdictText)}
              </p>
            )}
            <div style={{
              fontSize:   18,
              lineHeight: 1.85,
              color:      'var(--text-2)',
              fontFamily: 'var(--font-display)',
            }}>
              {renderProse(synthesis, true)}
            </div>
          </div>

          {/* Playback controls stay reachable inside focus mode */}
          <div style={{
            position:   'fixed',
            bottom:     20,
            display:    'flex',
            gap:        10,
            alignItems: 'center',
            background: 'var(--bg-card)',
            border:     '1px solid var(--border-mid)',
            borderRadius: 999,
            padding:    '8px 16px',
          }}>
            <button
              onClick={() => {
                if (isThisSpeaking && isPaused) { resume(); return }
                if (isThisSpeaking) { pause(); return }
                speak(synthesis, 'synthesis')
              }}
              style={{
                background: 'none', border: 'none', color: 'var(--gold)',
                fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
              }}
            >
              {isThisSpeaking && isLoading ? 'Starting…' : isThisSpeaking && isPaused ? '▶ Resume' : isThisSpeaking ? '⏸ Pause' : '▶ Read aloud'}
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
