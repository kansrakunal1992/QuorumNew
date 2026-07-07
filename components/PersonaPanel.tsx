'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import RateLimitBanner, { parseRateLimit, type RateLimitInfo } from '@/components/RateLimitBanner'
import { useTTSContext } from '@/context/TTSContext'
import type { PersonaMeta, Message } from '@/lib/types'

const ICONS: Record<string, React.ReactNode> = {
  contrarian: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
    </svg>
  ),
  risk_architect: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  ),
  pattern_analyst: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  ),
  stakeholder_mirror: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  elder: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>
    </svg>
  ),
  competitor: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/>
      <line x1="13" y1="19" x2="19" y2="13"/>
      <line x1="16" y1="16" x2="20" y2="20"/>
      <line x1="19" y1="21" x2="21" y2="19"/>
    </svg>
  ),
}

const ACCENT_COLORS: Record<string, string> = {
  contrarian:        '#b03535',
  risk_architect:    '#3268b0',
  pattern_analyst:   '#2e8a58',
  stakeholder_mirror:'#7230a8',
  elder:             '#a86a20',
  competitor:        '#5e6830',
}

interface Props {
  persona: PersonaMeta
  sessionId: string
  decisionText: string
  contextText?: string
  registerMode?: 'analytical' | 'clarification'
  onComplete?: (personaKey: string, content: string) => void
  /** When set, triggers a supplemental stream showing updated analysis with examiner answers */
  examinerContext?: string
  /** Sprint 5: structural context from past sessions — injected for Pattern Analyst, Risk Architect, Elder */
  structuralContext?: string
  /** Sprint 16b Fix 4: called after pushback completes — fans the pushback text out to all other advisors */
  onShareContext?: (text: string) => void
  /** Sprint 16b Fix 4b: called when an examiner/share-context update stream finishes — used to trigger synthesis re-run */
  onExaminerUpdateComplete?: (personaKey: string, content: string) => void
  /** Pre-loaded content from DB — skips the AI call entirely (used on Back to Council navigation) */
  initialContent?: string
  /** Gate: personas don't stream until examiner has been submitted or skipped (new flow) */
  canStream?: boolean
  /** C0 + rule answers baked into the initial persona call — set by SessionView after examiner submit */
  initialExaminerContext?: string
  /** S1-02: fires when this persona transitions to 'done' — used by SessionView for sequential streaming */
  onPersonaComplete?: () => void
  /** R6: ISO date string of the best structural match — session-wide, reused across every
      eligible persona. The citation badge itself is gated on this persona's own
      structuralCitationText (parsed from its <structural> tag), not on this flag. */
  structuralMatchDate?: string | null
  /** (d): matched past session's id — lets the echo badge link to that decision's record page */
  structuralMatchSessionId?: string | null
}

type PanelState = 'idle' | 'streaming' | 'done' | 'error'

export default function PersonaPanel({ persona, sessionId, decisionText, contextText, registerMode, onComplete, examinerContext, structuralContext, onShareContext, onExaminerUpdateComplete, initialContent, canStream, initialExaminerContext, onPersonaComplete, structuralMatchDate, structuralMatchSessionId }: Props) {
  const [response, setResponse]           = useState(initialContent ?? '')
  const [panelState, setPanelState]       = useState<PanelState>(initialContent ? 'done' : 'idle')
  const [messages, setMessages]           = useState<Message[]>([])
  const [pushback, setPushback]           = useState('')
  const [showPushback, setShowPushback]   = useState(false)
  const [isPushingBack, setIsPushingBack] = useState(false)
  const [exchanges, setExchanges]         = useState<{ user: string; reply: string }[]>([])
  const [contextShared, setContextShared] = useState(false)

  // Header block — parsed from <lens>, <position>, <realcost>, <lean> tags in streamed output
  const [lensText,     setLensText]     = useState('')
  const [positionText, setPositionText] = useState('')
  const [realCostText, setRealCostText] = useState('')
  // S3-01: machine-readable lean classification — never rendered, used only by SessionView
  // to build the pre-synthesis tension interstitial. Surfaced via onComplete's raw content.

  // R6: per-persona structural citation — parsed from <structural> tag. Empty means
  // this specific persona did not find the structural record relevant to its angle;
  // the citation badge only ever renders when this is non-empty.
  const [structuralCitationText, setStructuralCitationText] = useState('')

  // Examiner update — supplemental stream, does not overwrite original
  const [examinerUpdate,    setExaminerUpdate]    = useState('')
  const [examinerUpdateState, setExaminerUpdateState] = useState<'idle' | 'streaming' | 'done'>('idle')
  const [rateLimitInfo, setRateLimitInfo] = useState<RateLimitInfo | null>(null)
  const clearRateLimit = useCallback(() => setRateLimitInfo(null), [])

  const responseRef   = useRef(initialContent ?? '')
  const exchangesRef  = useRef(exchanges)
  const onCompleteRef = useRef(onComplete)
  const onPersonaCompleteRef = useRef(onPersonaComplete)
  // QC fix: onExaminerUpdateComplete was previously called directly (not via ref),
  // unlike its sibling onComplete/onPersonaComplete above — same stale-closure risk
  // those refs exist to prevent, just missed on this one. Same pattern applied here.
  const onExaminerUpdateCompleteRef = useRef(onExaminerUpdateComplete)

  useEffect(() => { exchangesRef.current        = exchanges       }, [exchanges])
  useEffect(() => { onCompleteRef.current       = onComplete      }, [onComplete])
  useEffect(() => { onPersonaCompleteRef.current = onPersonaComplete }, [onPersonaComplete])
  useEffect(() => { onExaminerUpdateCompleteRef.current = onExaminerUpdateComplete }, [onExaminerUpdateComplete])

  // S1-02: Sequential streaming — fire when this persona transitions to done
  useEffect(() => {
    if (panelState === 'done') onPersonaCompleteRef.current?.()
  }, [panelState])

  const accentColor = ACCENT_COLORS[persona.key] ?? '#1c2b4a'
  const icon = ICONS[persona.key]

  // ── Header tag extractor ───────────────────────────────────────────────────
  // Strips <lens>, <position>, <realcost>, <lean>, <structural> tags from streamed output and returns clean prose
  const extractHeaderTags = useCallback((raw: string): string => {
    const get = (tag: string) => {
      const m = raw.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))
      return m ? m[1].trim() : ''
    }
    const lens     = get('lens')
    const position = get('position')
    const realcost = get('realcost')
    const structural = get('structural')
    if (lens)     setLensText(lens)
    if (position) setPositionText(position)
    if (realcost) setRealCostText(realcost)
    if (structural) setStructuralCitationText(structural)
    // Strip all four tag blocks + any leading blank line from prose.
    // <lean> is a machine-readable classification only — never state, never displayed.
    //
    // Bug fix: this runs on every streamed chunk (accumulated so far), not just on
    // the final response. The four regexes below only match a FULLY CLOSED tag —
    // while a chunk boundary lands between an opening tag (e.g. "<lean>") and its
    // closing tag, the dangling open tag + partial content (e.g. "<lean>proc")
    // doesn't match any of them and briefly renders raw on screen. <lean> is the
    // last of the four header tags, so it's the one most exposed to this window.
    // The trailing guard below strips any still-open header tag (and everything
    // after it) the same way the <verdict> "guard: open tag without close" pattern
    // already does elsewhere in the codebase (SynthesisCard, RecordExport, etc).
    //
    // Second bug fix (observed live, July 2026): the model has been seen emitting a
    // bare, malformed tag using the <lean> ENUM VALUE as the tag name itself — e.g.
    // literal "<wait>" sitting in the prose — instead of correctly closing
    // <lean>wait</lean>. This isn't a tag our schema defines, so none of the regexes
    // above (which only know the tag NAMES lens/position/realcost/lean) ever match
    // it, and it leaked straight into the visible card. Since <lean>'s only valid
    // values are proceed/wait/mixed, strip any bare occurrence of those three as a
    // targeted defense — this is not a generic "strip all tags" rule, only the exact
    // vocabulary this one field draws from.
    return raw
      .replace(/<lens>[\s\S]*?<\/lens>/g, '')
      .replace(/<position>[\s\S]*?<\/position>/g, '')
      .replace(/<realcost>[\s\S]*?<\/realcost>/g, '')
      .replace(/<lean>[\s\S]*?<\/lean>/g, '')
      .replace(/<structural>[\s\S]*?<\/structural>/g, '')
      .replace(/<(?:lens|position|realcost|lean|structural)>[\s\S]*$/, '') // guard: open tag without close
      .replace(/<\/?(?:proceed|wait|mixed)>\s*/gi, '')          // guard: stray malformed lean-value tag
      .replace(/^\s+/, '')
  }, [])

  // Strips header tags from pushback replies WITHOUT updating header state
  // (we keep the original lens/position/realcost from the first analysis)
  const stripHeaderTags = useCallback((raw: string): string => {
    return raw
      .replace(/<lens>[\s\S]*?<\/lens>/g, '')
      .replace(/<position>[\s\S]*?<\/position>/g, '')
      .replace(/<realcost>[\s\S]*?<\/realcost>/g, '')
      .replace(/<lean>[\s\S]*?<\/lean>/g, '')
      .replace(/<structural>[\s\S]*?<\/structural>/g, '')
      .replace(/<(?:lens|position|realcost|lean|structural)>[\s\S]*$/, '') // guard: open tag without close
      .replace(/<\/?(?:proceed|wait|mixed)>\s*/gi, '')          // guard: stray malformed lean-value tag
      .replace(/^\s+/, '')
  }, [])

  // ── TTS ────────────────────────────────────────────────────────────────────────────────
  const { speak, stop, pause, resume, isSpeaking, isPaused, isLoading, activeSpeakerId, rate, setRate, countdown } = useTTSContext()
  const isThisSpeaking = activeSpeakerId === persona.key

  const streamResponse = useCallback(async (msgs: Message[], isFirst: boolean, examinerCtx?: string) => {
    setPanelState('streaming')
    if (isFirst) setResponse('')

    try {
      const res = await fetch('/api/persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, personaKey: persona.key, messages: msgs, decisionText, contextText, registerMode: registerMode ?? 'analytical', structuralContext, examinerContext: isFirst ? examinerCtx : undefined }),
      })
      if (!res.ok || !res.body) {
        const rl = await parseRateLimit(res)
        if (rl) { setRateLimitInfo(rl); setPanelState('idle'); return }
        setPanelState('error')
        setResponse('Failed to load. Check API key.')
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let acc = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })

        if (isFirst) {
          const prose = extractHeaderTags(acc)
          setResponse(prose)
          responseRef.current = prose
        }
      }

      setPanelState('done')

      if (isFirst) {
        onCompleteRef.current?.(persona.key, acc)
      } else {
        const userText = msgs[msgs.length - 1]?.content ?? ''
        // Strip lens/position/realcost tags from pushback reply (keep original header state)
        const cleanReply = stripHeaderTags(acc)
        const newExchanges = [...exchangesRef.current, { user: userText, reply: cleanReply }]
        setExchanges(newExchanges)
        setIsPushingBack(false)
        const fullContent = [responseRef.current, ...newExchanges.map(e => `[Pushback: "${e.user}"]\n${e.reply}`)].join('\n\n')
        onCompleteRef.current?.(persona.key, fullContent)
      }
    } catch {
      setPanelState('error')
      setResponse('Connection error.')
    }
  }, [sessionId, persona.key, decisionText, contextText, registerMode, structuralContext, extractHeaderTags, stripHeaderTags])

  // Parse header tags from initialContent so Lens/Position/Trade-off render on Back to Council
  useEffect(() => {
    if (!initialContent) return
    const prose = extractHeaderTags(initialContent)
    setResponse(prose)
    responseRef.current = prose
  }, [initialContent, extractHeaderTags])

  useEffect(() => {
    if (initialContent) return   // already hydrated from DB — no re-fetch
    if (canStream === false) return  // wait for examiner to submit/skip
    if (panelState !== 'idle') return // guard: only fire once (canStream or initialExaminerContext re-rendering)
    streamResponse([], true, initialExaminerContext)
  }, [streamResponse, initialContent, canStream, initialExaminerContext]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Examiner supplemental update ────────────────────────────────────────
  // Fires when examinerContext is set (non-empty) after the initial analysis is done
  const examinerContextRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!examinerContext || examinerContext === examinerContextRef.current) return
    examinerContextRef.current = examinerContext
    // Only fire if we have the original response to build on
    if (!responseRef.current) return

    const runExaminerUpdate = async () => {
      setExaminerUpdateState('streaming')
      setExaminerUpdate('')
      try {
        const examinerMessages = [
          { role: 'assistant' as const, content: responseRef.current },
          { role: 'user' as const, content: examinerContext },
        ]
        const res = await fetch('/api/persona', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            personaKey: persona.key,
            messages: examinerMessages,
            decisionText,
            contextText,
            registerMode: registerMode ?? 'analytical',
            isExaminerContextCall: true,  // suppresses pushbackProtocol injection + DB saves
          }),
        })
        if (!res.ok || !res.body) { setExaminerUpdateState('done'); return }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let acc = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          acc += decoder.decode(value, { stream: true })
          setExaminerUpdate(stripHeaderTags(acc))
        }
        setExaminerUpdateState('done')
        // Update completedResponses in SessionView with the full combined content
        if (acc) {
          const cleanAcc = stripHeaderTags(acc)
          const fullContent = [responseRef.current, `[Updated after Examiner answers]\n${cleanAcc}`,
            ...exchangesRef.current.map(e => `[Pushback: "${e.user}"]\n${e.reply}`)
          ].join('\n\n')
          onCompleteRef.current?.(persona.key, fullContent)
          // Sprint 16b Fix 4b: notify SessionView this update is done — used to count share-context completions
          onExaminerUpdateCompleteRef.current?.(persona.key, fullContent)
        }
      } catch {
        setExaminerUpdateState('done')
      }
    }

    runExaminerUpdate()
  }, [examinerContext, sessionId, persona.key, decisionText, contextText, registerMode, stripHeaderTags])

  const handlePushback = async () => {
    if (!pushback.trim()) return
    const updated: Message[] = [
      ...messages,
      { id: Date.now().toString(), session_id: sessionId, persona: persona.key, role: 'user', content: pushback, created_at: new Date().toISOString() },
    ]
    setMessages(updated)
    setPushback('')
    setShowPushback(false)
    setIsPushingBack(true)
    await streamResponse(updated, false)
  }

  const StatusBadge = () => {
    if (isPushingBack) return (
      <span style={{ fontSize: 11, color: 'var(--gold)', display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)', display: 'inline-block', animation: 'blink 1s step-end infinite' }} />
        Reading your challenge…
      </span>
    )
    if (panelState === 'streaming' && !isPushingBack) return (
      <span style={{ fontSize: 11, color: 'var(--gold)', display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)', display: 'inline-block', animation: 'blink 1s step-end infinite' }} />
        Reading
      </span>
    )
    if (examinerUpdateState === 'streaming') return (
      <span style={{ fontSize: 11, color: 'var(--info-text)', display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--info-text)', display: 'inline-block', animation: 'blink 1s step-end infinite' }} />
        Updating
      </span>
    )
    // Sprint 16b Fix 3: show "Responded" once a pushback exchange has completed
    if (panelState === 'done' && exchanges.length > 0) return (
      <span style={{ fontSize: 11, color: 'var(--success-text)', display: 'flex', alignItems: 'center', gap: 4 }}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>
        Responded
      </span>
    )
    if (panelState === 'done') return <span style={{ fontSize: 11, color: 'var(--success-text)' }}>✓</span>
    if (panelState === 'error') return <span style={{ fontSize: 11, color: '#e05050' }}>✗ error</span>
    return null
  }

  // R6: structural citation badge — renders ONLY when THIS persona's own output
  // contained a <structural> tag. structuralMatchDate/structuralMatchSessionId
  // are session-wide (which past decision matched), reused across every eligible
  // persona; structuralCitationText is persona-specific (what THIS advisor
  // actually observed) and is the true gate — precise instead of a stand-in flag.
  const structuralCitationBlock = (structuralCitationText && panelState === 'done') ? (
    <div style={{
      marginTop:    16,
      padding:      '10px 12px',
      borderRadius: 8,
      background:   'var(--success-bg)',
      border:       '1px solid var(--success-border)',
    }}>
      <p style={{
        fontSize:      10,
        fontWeight:    700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color:         'var(--success-text)',
        margin:        '0 0 5px',
        display:       'flex',
        alignItems:    'center',
        gap:           5,
      }}>
        <span aria-hidden="true">↺</span> Structural echo
      </p>
      <p style={{
        fontSize:   12,
        color:      'var(--success-text)',
        lineHeight: 1.6,
        margin:     structuralMatchDate ? '0 0 6px' : 0,
      }}>
        {structuralCitationText}
      </p>
      {structuralMatchDate && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ fontSize: 11, color: 'var(--success-text)', opacity: 0.85 }}>
            From a decision you brought in{' '}
            {new Date(structuralMatchDate).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
          </span>
          {structuralMatchSessionId && (
            <a
              href={`/record/${structuralMatchSessionId}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize:       11,
                fontWeight:     600,
                color:          'var(--success-text)',
                textDecoration: 'underline',
                whiteSpace:     'nowrap',
                flexShrink:     0,
              }}
            >
              View that decision →
            </a>
          )}
        </div>
      )}
    </div>
  ) : null

  return (
    <div className={`persona-card ${panelState === 'streaming' ? 'streaming' : panelState === 'done' ? 'done' : ''}`} style={{ minHeight: 280, borderLeft: `3px solid ${accentColor}` }}>
      {/* S5-01: Rate limit banner — shown when 429 is returned from /api/persona */}
      {rateLimitInfo && (
        <div style={{ padding: '8px 12px 4px' }}>
          <RateLimitBanner
            message={rateLimitInfo.message}
            resetAt={rateLimitInfo.resetAt}
            onExpired={clearRateLimit}
          />
        </div>
      )}

      {/* R6: the old top-of-card banner here was gated on a session-wide flag AND
          hardcoded to pattern_analyst, with copy that named the persona directly —
          it could show even when this persona's own output never referenced the
          past decision, and never showed on the other 4 eligible personas at all.
          Replaced by a citation badge anchored at the end of the analysis (see
          "Structural echo" block below), driven entirely by whether THIS persona's
          own <structural> tag is present — no hardcoded persona list, no
          disconnect between what's claimed and what was actually said. */}

      {/* Header */}
      <div style={{ padding: '12px 16px 10px', borderBottom: '1px solid var(--border-dim)', background: 'var(--bg-card-alt)', borderRadius: '14px 14px 0 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: `${accentColor}22`, border: `1px solid ${accentColor}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: accentColor, flexShrink: 0 }}>
              {icon}
            </div>
            <div>
              <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-1)', lineHeight: 1.2 }}>{persona.label}</p>
              {/* Show lens caption when available (replaces static tagline) — keeps header compact */}
              <p style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.35, marginTop: 2, maxWidth: 220 }}>
                {lensText || persona.tagline}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {panelState === 'done' && !isPushingBack && examinerUpdateState !== 'streaming' && !showPushback && (
            <button
              title="Disagree with this analysis, add new information, or ask a follow-up"
              onClick={() => setShowPushback(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                background: 'rgba(201,168,76,0.12)', border: '1px solid var(--gold-dim)',
                borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600,
                color: 'var(--gold)', cursor: 'pointer', transition: 'all 0.2s',
                fontFamily: 'inherit', letterSpacing: '0.02em', whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(201,168,76,0.22)'
                ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--gold)'
                ;(e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 8px rgba(201,168,76,0.35)'
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(201,168,76,0.12)'
                ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--gold-dim)'
                ;(e.currentTarget as HTMLButtonElement).style.boxShadow = 'none'
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>
              </svg>
              Challenge · add context
            </button>
          )}
          <StatusBadge />
          </div>  {/* close buttons row */}
        </div>  {/* close justify-between */}
      </div>

      {/* Body */}
      <div style={{ flex: 1, padding: '14px 16px', overflowY: 'auto', maxHeight: 380 }}>

        {/* Position — unlabeled opening verdict, no prefix chrome.
            Lens moves to header caption; real cost moves to card close.
            S3-05: elevated to display font / 600 weight — this is the advisor's lean,
            the single most load-bearing sentence on the card, previously the same
            visual weight as body prose. */}
        {positionText && (
          <div style={{ marginBottom: 14 }}>
            <p style={{
              fontSize:   15,
              fontWeight: 600,
              fontFamily: 'var(--font-display)',
              color:      'var(--text-1)',
              lineHeight: 1.5,
              margin:     '0',
            }}>
              {positionText}
            </p>
            <div style={{ marginTop: 12, borderTop: '1px solid var(--border-dim)' }} />
          </div>
        )}

        {/* Original response — never mutated */}
        {response && (
          <p className={`persona-response ${panelState === 'streaming' && !isPushingBack ? 'cursor' : ''}`}>
            {response}
          </p>
        )}

        {/* Real cost — closing beat, shown once prose is complete.
            Sits below exchanges (or below analysis if no pushback) as a persistent conclusion.
            S3-05: labelled — this is the advisor's closing statement, previously
            unmarked italic text indistinguishable from a stray aside. */}
        {realCostText && panelState === 'done' && exchanges.length === 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ borderTop: '1px solid var(--border-dim)', marginBottom: 10 }} />
            <p style={{
              fontSize:      10,
              fontWeight:    700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color:         'var(--text-4)',
              margin:        '0 0 4px',
            }}>
              The real cost
            </p>
            <p style={{
              fontSize: 12,
              fontStyle: 'italic',
              color: 'var(--text-4)',
              lineHeight: 1.7,
              margin: 0,
            }}>
              {realCostText}
            </p>
          </div>
        )}

        {structuralCitationBlock}

        {/* Pushback exchanges */}
        {exchanges.map((ex, i) => (
          <div key={i} style={{ marginTop: 18 }}>
            <div style={{ borderRadius: 8, padding: '8px 12px', background: 'var(--bg-inset)', border: '1px solid var(--border-dim)', marginBottom: 10, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 11, color: 'var(--gold)', flexShrink: 0, marginTop: 1 }}>↩</span>
              <div>
                <p style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 2 }}>Your pushback</p>
                <p style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.5 }}>{ex.user}</p>
              </div>
            </div>
            <p className="persona-response">{ex.reply}</p>
          </div>
        ))}

        {/* Real cost — persists below pushback exchanges too */}
        {realCostText && panelState === 'done' && exchanges.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ borderTop: '1px solid var(--border-dim)', marginBottom: 10 }} />
            <p style={{
              fontSize:      10,
              fontWeight:    700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color:         'var(--text-4)',
              margin:        '0 0 4px',
            }}>
              The real cost
            </p>
            <p style={{
              fontSize: 12,
              fontStyle: 'italic',
              color: 'var(--text-4)',
              lineHeight: 1.7,
              margin: 0,
            }}>
              {realCostText}
            </p>
          </div>
        )}

        {structuralCitationBlock}

        {isPushingBack && (
          <p style={{ fontSize: 12, color: 'var(--gold)', marginTop: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--gold)', display: 'inline-block', animation: 'blink 1s step-end infinite' }} />
            Responding…
          </p>
        )}

        {/* Sprint 16b Fix 4: Share context button — shown once after pushback completes, gone after click */}
        {panelState === 'done' && !isPushingBack && exchanges.length > 0 && !contextShared && onShareContext && (
          <div style={{ marginTop: 16 }}>
            <button
              onClick={() => {
                const lastExchange = exchanges[exchanges.length - 1]
                onShareContext(lastExchange.user)
                setContextShared(true)
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', borderRadius: 8,
                border: '1px solid var(--info-border)',
                background: 'var(--info-bg)',
                color: 'var(--info-text)', fontSize: 11.5, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.02em',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'var(--info-bg)'
                ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--info-border)'
                ;(e.currentTarget as HTMLButtonElement).style.opacity = '0.8'
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'var(--info-bg)'
                ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--info-border)'
                ;(e.currentTarget as HTMLButtonElement).style.opacity = '1'
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
              </svg>
              Share this context with all advisors
            </button>
          </div>
        )}

        {/* Examiner update — shown below original, never overwrites */}
        {(examinerUpdate || examinerUpdateState === 'streaming') && (
          <div style={{ marginTop: 16, borderRadius: 8, border: '1px solid var(--info-border)', background: 'var(--info-bg)', padding: '10px 14px', animation: 'examinerFadeIn 0.35s ease-out both' }}>
            <p style={{ fontSize: 10.5, color: 'var(--info-text)', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="1 4 1 10 7 10"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10"/>
              </svg>
              Updated with your answers
            </p>
            <p className={`persona-response ${examinerUpdateState === 'streaming' ? 'cursor' : ''}`} style={{ fontSize: 13 }}>
              {examinerUpdate}
            </p>
          </div>
        )}

        {panelState === 'idle' && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 50 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--border-mid)', animation: 'blink 1.2s ease-in-out infinite' }} />
          </div>
        )}
      </div>

      {/* Pushback input — shown below content when triggered from header button */}
      {panelState === 'done' && !isPushingBack && examinerUpdateState !== 'streaming' && showPushback && (
        <div style={{ padding: '10px 16px 14px', borderTop: '1px solid var(--border-dim)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ fontSize: 11, color: 'var(--text-4)', margin: 0 }}>
              Disagree, add new information, or ask a follow-up
            </p>
            <textarea
              rows={2}
              style={{ fontSize: 13, padding: '8px 12px' }}
              placeholder="e.g. But I already have diversified exposure… / What if the timeline is shorter?"
              value={pushback}
              onChange={(e) => setPushback(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handlePushback() }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" style={{ padding: '7px 18px', fontSize: 12 }} onClick={handlePushback}>
                Send ↵
              </button>
              <button className="btn-ghost" onClick={() => { setShowPushback(false); setPushback('') }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── TTS strip — Sprint 23c — bottom of card, accent bg matches header ── */}
      {panelState === 'done' && !showPushback && (
        <div style={{
          borderTop:    '1px solid var(--border-dim)',
          padding:      '7px 14px',
          display:      'flex',
          alignItems:   'center',
          justifyContent: 'space-between',
          background:   'var(--bg-card-alt)',
          borderRadius: '0 0 14px 14px',
        }}>
          {/* Read aloud / Stop */}
          <button
            onClick={() => {
              if (isThisSpeaking && isPaused) { resume(); return }
              if (isThisSpeaking) { pause(); return }
              speak(response, persona.key)
            }}
            title={isThisSpeaking && isPaused ? 'Resume' : isThisSpeaking ? 'Pause' : 'Read aloud'}
            style={{
              display:       'flex',
              alignItems:    'center',
              gap:           5,
              padding:       '4px 10px',
              borderRadius:  5,
              border:        isThisSpeaking
                               ? '1px solid rgba(201,168,76,0.5)'
                               : '1px solid var(--tts-btn-border)',
              background:    isThisSpeaking
                               ? 'rgba(201,168,76,0.15)'
                               : 'var(--tts-btn-bg)',
              color:         isThisSpeaking
                               ? 'var(--gold)'
                               : 'var(--tts-btn-color)',
              fontSize:      11,
              fontWeight:    500,
              cursor:        'pointer',
              fontFamily:    'inherit',
              transition:    'all 0.18s',
              letterSpacing: '0.01em',
            }}
          >
            {isThisSpeaking && isLoading ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                style={{ animation: 'spin 0.9s linear infinite' }}>
                <path d="M21 12a9 9 0 1 1-6.22-8.56"/>
              </svg>
            ) : isThisSpeaking && isPaused ? (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
            ) : isThisSpeaking ? (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <rect x="5" y="4" width="4" height="16" rx="1"/><rect x="15" y="4" width="4" height="16" rx="1"/>
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
            )}
            <span>{isThisSpeaking && isLoading ? (countdown !== null && countdown > 0 ? `~${countdown}s` : 'Starting…') : isThisSpeaking && isPaused ? 'Resume' : isThisSpeaking ? 'Pause' : 'Read aloud'}</span>
          </button>

          {/* Stop button — shown while speaking or paused */}
          {isThisSpeaking && (
            <button
              onClick={() => stop()}
              title="Stop"
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 8px', borderRadius: 5,
                border: '1px solid var(--tts-btn-border)',
                background: 'var(--tts-btn-bg)',
                color: 'var(--tts-stop-color)',
                fontSize: 11, fontWeight: 500, cursor: 'pointer',
                fontFamily: 'inherit', transition: 'all 0.18s',
              }}
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                <rect x="4" y="4" width="16" height="16" rx="2"/>
              </svg>
              <span>Stop</span>
            </button>
          )}

          {/* Pace cycle button — pre-set or change mid-play */}
          <button
            onClick={() => {
              const rates = [1, 1.5, 2]
              const next = rates[(rates.indexOf(rate) + 1) % rates.length]
              setRate(next)
            }}
            title="Playback speed"
            style={{
              padding:       '4px 9px',
              borderRadius:  5,
              border:        rate !== 1
                               ? '1px solid rgba(201,168,76,0.5)'
                               : '1px solid var(--tts-btn-border)',
              background:    rate !== 1
                               ? 'rgba(201,168,76,0.15)'
                               : 'var(--tts-btn-bg)',
              color:         rate !== 1
                               ? 'var(--gold)'
                               : 'var(--tts-btn-color)',
              fontSize:      11,
              fontWeight:    600,
              cursor:        'pointer',
              fontFamily:    'inherit',
              transition:    'all 0.18s',
              letterSpacing: '0.03em',
            }}
          >
            {rate === 1 ? '1×' : rate === 1.5 ? '1.5×' : '2×'}
          </button>
        </div>
      )}
    </div>
  )
}
