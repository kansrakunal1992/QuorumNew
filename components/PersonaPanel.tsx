'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import RateLimitBanner, { parseRateLimit, type RateLimitInfo } from '@/components/RateLimitBanner'
import { useTTSContext } from '@/context/TTSContext'
import type { PersonaMeta, Message } from '@/lib/types'
import type { Lean } from './TensionInterstitial'

// Vet-fix (b): labels for the "shifted" badge below — same wording as
// WhatChangedDrawer's LEAN_LABELS, so a lean shift reads the same way
// wherever it's shown (this card, the What Changed drawer, the Tension
// interstitial).
const LEAN_LABELS: Record<Lean, string> = {
  proceed: 'Proceed',
  wait:    'Wait',
  mixed:   'Mixed',
}

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
  /** Automatic percolation: fires the moment a challenge is submitted (not
   *  after the reply completes) — fans the raw challenge text out to all
   *  other advisors as new evidence for independent reassessment. */
  onShareContext?: (text: string) => void
  /** Called both when a broadcast-received update finishes AND when this
   *  advisor's own pushback reply finishes (if it's part of an active
   *  broadcast batch) — used to fold everyone's completion into exactly one
   *  downstream synthesis re-run instead of one per advisor. */
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
  /** P1 fix: fires when a pushback reply carries a fresh <lean> classification
   *  that differs from the persona's original one — previously this was always
   *  discarded (stripHeaderTags stripped <lean> from every non-initial reply,
   *  by design, so "what did this advisor originally lean" stayed stable). Now
   *  surfaced separately so SessionView can track it as a genuine *change*
   *  (see Gap #3 — advisor position evolution) without touching the original
   *  lens/position/realcost header, which still intentionally stays frozen. */
  onLeanUpdate?: (personaKey: string, lean: 'proceed' | 'wait' | 'mixed') => void
  /** Vet-fix (b): SessionView's live personaLeans[key] for this persona, passed
   *  back down so the card can compare "what it leaned initially" against
   *  "what it leans now" and show a small shift badge — without touching the
   *  frozen lens/position/realcost header above. This is the same value this
   *  card feeds SessionView via onLeanUpdate; it just comes back down once
   *  SessionView has committed it, so the card and the rest of the session
   *  (synthesis weighting, What Changed drawer, Tension interstitial) are
   *  reading the same number instead of the card silently lagging behind. */
  currentLean?: Lean
  /** Challenge-discoverability pass: true once ANY card in this session has had
   *  a completed pushback exchange — drives the ambient "You can challenge this
   *  one too." hint on cards that haven't been challenged yet. */
  anyCardChallenged?: boolean
  /** Fires the first time THIS card's pushback completes — SessionView uses this
   *  to flip anyCardChallenged to true for the rest of the session. */
  onFirstChallengeUsed?: () => void
}

type PanelState = 'idle' | 'streaming' | 'done' | 'error'

export default function PersonaPanel({ persona, sessionId, decisionText, contextText, registerMode, onComplete, examinerContext, structuralContext, onShareContext, onExaminerUpdateComplete, initialContent, canStream, initialExaminerContext, onPersonaComplete, structuralMatchDate, structuralMatchSessionId, onLeanUpdate, currentLean, anyCardChallenged, onFirstChallengeUsed }: Props) {
  const [response, setResponse]           = useState(initialContent ?? '')
  const [panelState, setPanelState]       = useState<PanelState>(initialContent ? 'done' : 'idle')
  const [messages, setMessages]           = useState<Message[]>([])
  const [pushback, setPushback]           = useState('')
  const [showPushback, setShowPushback]   = useState(false)
  const [isPushingBack, setIsPushingBack] = useState(false)
  const [exchanges, setExchanges]         = useState<{ user: string; reply: string }[]>([])

  // Header block — parsed from <lens>, <position>, <realcost>, <lean> tags in streamed output
  const [lensText,     setLensText]     = useState('')
  const [positionText, setPositionText] = useState('')
  const [realCostText, setRealCostText] = useState('')
  // S3-01: machine-readable lean classification — never rendered directly (no
  // proceed/wait/mixed pill on the card), used by SessionView to build the
  // pre-synthesis tension interstitial. Surfaced via onComplete's raw content.
  // Vet-fix (b): also captured here, once, from the persona's ORIGINAL
  // response — purely so this card can compare it against `currentLean`
  // (SessionView's live value, which onLeanUpdate keeps current through
  // pushback) and show a small "shifted" badge. Never overwritten after the
  // initial response settles, same convergence behavior as lensText/
  // positionText/realCostText above.
  const [initialLean, setInitialLean] = useState<Lean | ''>('')

  // R6: per-persona structural citation — parsed from <structural> tag. Empty means
  // this specific persona did not find the structural record relevant to its angle;
  // the citation badge only ever renders when this is non-empty.
  const [structuralCitationText, setStructuralCitationText] = useState('')

  // Item #9 (revised) — mobile-only collapse for this persona card, default
  // OPEN/expanded. Unlike the Judgment Record or FAQ (secondary/reference
  // content, collapsed by default), this card's analysis IS the core product
  // value — collapsing it by default would hide the main thing someone opened
  // the session to read. This only ever gates visibility under the 600px
  // breakpoint (see .persona-body-mobile in globals.css); desktop is
  // unaffected regardless of this state. The toggle itself only appears once
  // panelState === 'done' — collapsing mid-stream would be disorienting.
  const [mobileCollapsed, setMobileCollapsed] = useState(false)

  // Item #14 — synthesized one-line rationale, tucked behind a small "why"
  // toggle, hidden by default so it never competes with the analysis itself.
  // Reuses the existing structural-citation text (already computed,
  // already safe to show — no raw scores/rule IDs) rather than a new signal.
  const [showWhy, setShowWhy] = useState(true)

  // Examiner update — supplemental stream, does not overwrite original
  const [examinerUpdate,    setExaminerUpdate]    = useState('')
  const [examinerUpdateState, setExaminerUpdateState] = useState<'idle' | 'streaming' | 'done'>('idle')
  const [rateLimitInfo, setRateLimitInfo] = useState<RateLimitInfo | null>(null)
  const clearRateLimit = useCallback(() => setRateLimitInfo(null), [])

  const responseRef   = useRef(initialContent ?? '')
  // Bug fix: rebuilding `fullContent` for persistence after any pushback or
  // examiner-update previously reused `responseRef.current` — which by that
  // point already holds the STRIPPED prose (see the `isFirst` streaming loop
  // below, which overwrites responseRef.current with tag-stripped text on
  // every chunk, for display purposes). That stripped text is what got saved
  // as the new "original response" segment going forward, permanently
  // erasing <lens>/<position>/<realcost>/<lean> from what's persisted after
  // the FIRST save. On a later reload, extractHeaderTags(initialContent)
  // then found no <lean> tag anywhere in that persona's stored content, so
  // initialLean never got set — which silently breaks the "Shifted after
  // pushback" badge (initialLean && currentLean && currentLean !== initialLean
  // requires initialLean to be truthy) for exactly the personas that had
  // already been challenged before the page was reloaded, and only becomes
  // visible on that reload — matching the "vanishes sometimes, only for some
  // personas" symptom. This ref tracks the RAW (tag-intact) original response
  // separately, so it — not the display-cleaned responseRef — is what gets
  // reused when reconstructing fullContent for every subsequent save.
  const rawInitialRef = useRef(
    initialContent ? initialContent.split(/\n\n\[(?:Pushback|Updated after Examiner)/)[0] : '',
  )
  const exchangesRef  = useRef(exchanges)
  const onCompleteRef = useRef(onComplete)
  const onLeanUpdateRef = useRef(onLeanUpdate)
  const onPersonaCompleteRef = useRef(onPersonaComplete)
  // QC fix: onExaminerUpdateComplete was previously called directly (not via ref),
  // unlike its sibling onComplete/onPersonaComplete above — same stale-closure risk
  // those refs exist to prevent, just missed on this one. Same pattern applied here.
  const onExaminerUpdateCompleteRef = useRef(onExaminerUpdateComplete)

  useEffect(() => { exchangesRef.current        = exchanges       }, [exchanges])
  useEffect(() => { onCompleteRef.current       = onComplete      }, [onComplete])
  useEffect(() => { onLeanUpdateRef.current     = onLeanUpdate    }, [onLeanUpdate])
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
    const lean     = get('lean').toLowerCase()
    const structural = get('structural')
    if (lens)     setLensText(lens)
    if (position) setPositionText(position)
    if (realcost) setRealCostText(realcost)
    if (structural) setStructuralCitationText(structural)
    if (lean === 'proceed' || lean === 'wait' || lean === 'mixed') {
      setInitialLean(prev => prev || lean)
    }
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
      // Bug fix (hydration leak, July 2026): this function rebuilds initialContent
      // on reload by concatenating every raw assistant row for a persona — initial
      // response + every pushback reply. Pushback replies carry <pushback_classification>,
      // which this function never stripped (unlike stripHeaderTags on the live path),
      // so the raw tag rendered on every reload of a session with pushback history.
      // Tolerant close: model sometimes closes with </pushback> instead of the full
      // </pushback_classification> — same drift pattern as <lean>/<structural> above.
      .replace(/<pushback_classification>[\s\S]*?<\/(?:pushback_classification|pushback)>/g, '')
      .replace(/<(?:lens|position|realcost|lean|structural|pushback_classification)>[\s\S]*$/, '') // guard: open tag without close
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
      // Same treatment as <lean> — machine-only value, never shown, full removal.
      // Tolerant close: model sometimes closes with </pushback> instead of the
      // full </pushback_classification> (same drift pattern as verdict_lean/
      // </verdict> below) — without this, the tag leaks straight into the UI.
      .replace(/<pushback_classification>[\s\S]*?<\/(?:pushback_classification|pushback)>/g, '')
      .replace(/<(?:lens|position|realcost|lean|structural|pushback_classification)>[\s\S]*$/, '') // guard: open tag without close
      // Sprint 2 follow-on: <assumption> is content-preserving here, unlike the
      // tags above — it wraps substantive prose (the actual "hidden assumption"
      // sentences), not a machine-only value or a citation meant to live
      // elsewhere. Pushback exchanges aren't covered by renderAssumption's
      // highlight (deliberately scoped to the first response only), so this
      // just strips the tag markers and keeps the sentences in place, same as
      // stray-tag guards elsewhere in this file.
      .replace(/<\/?assumption>/g, '')
      .replace(/<\/?(?:proceed|wait|mixed)>\s*/gi, '')          // guard: stray malformed lean-value tag
      .replace(/^\s+/, '')
  }, [])

  // Sprint 2 (Feature #2, "Evidence Confidence Weighting" — cheap version).
  // Contrarian and Risk Architect already write a "hidden assumption" /
  // "assumption risk" beat in every response (lib/personas.ts) — this makes
  // it visually distinct from the surrounding prose instead of leaving it
  // unmarked. Deliberately NOT extracted into a separate panel/ledger: the
  // design intent is a subtle highlight inside the text the person is
  // already reading, not a new list to parse. <assumption> is intentionally
  // NOT added to extractHeaderTags/stripHeaderTags above — unlike
  // lens/position/realcost/lean, it isn't a header tag that moves
  // elsewhere; it stays exactly where it falls in the paragraph, so
  // `response` naturally still contains it start to finish.
  //
  // Same two-track approach SynthesisCard's renderProse uses for
  // <tension>: while streaming, any assumption markup (including a
  // still-open tag mid-stream) is stripped from what's shown, so raw tag
  // text never flashes on screen; once done, the now-guaranteed-closed tag
  // is used to slice out that exact span and wrap it in a highlight.
  const renderAssumption = (text: string, isDone: boolean): React.ReactNode => {
    if (!isDone) {
      return <>{text.replace(/<\/?assumption>/g, '').replace(/<assumption>[\s\S]*$/, '')}</>
    }
    const start = text.indexOf('<assumption>')
    const end   = text.indexOf('</assumption>')
    if (start === -1 || end === -1 || end <= start) {
      // No tag found (the other four personas, or a rare miss) — render as-is,
      // still guarding against any stray/unclosed tag rather than assuming none exists.
      return <>{text.replace(/<\/?assumption>/g, '').replace(/<assumption>[\s\S]*$/, '')}</>
    }
    const before  = text.slice(0, start)
    const content = text.slice(start + '<assumption>'.length, end)
    const after   = text.slice(end + '</assumption>'.length)
    return (
      <>
        {before}
        <span style={{
          background:    'var(--assumption-highlight-bg)',
          borderBottom:  '1px solid var(--assumption-highlight-border)',
          paddingBottom: 1,
          borderRadius:  2,
        }}>{content}</span>
        {after}
      </>
    )
  }

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
        rawInitialRef.current = acc   // preserve tag-intact original response for future saves
        onCompleteRef.current?.(persona.key, acc)
      } else {
        const userText = msgs[msgs.length - 1]?.content ?? ''
        // P1 fix: capture the pushback reply's <lean> BEFORE stripping it —
        // the model re-emits this on every call (it's baked into the base
        // persona prompt), but it was previously discarded unconditionally.
        // Surfaced via a separate callback rather than folded into onComplete
        // so the original lens/position/realcost header — deliberately frozen
        // at the initial response — is untouched by this.
        const leanMatch = acc.match(/<lean>([\s\S]*?)<\/lean>/)
        if (leanMatch) {
          const lean = leanMatch[1].trim().toLowerCase()
          if (lean === 'proceed' || lean === 'wait' || lean === 'mixed') {
            onLeanUpdateRef.current?.(persona.key, lean)
          }
        }
        // Persistence layer for cross-session "what changes your mind" tracking.
        // The model already computes this classification internally every
        // pushback (Step 1, lib/personas.ts) — it was previously discarded the
        // instant this reply finished streaming. Same extract-before-strip
        // pattern as leanMatch above, fire-and-forget POST (non-blocking —
        // a failure here should never affect the pushback reply itself).
        // Tolerant close here too — same drift as the strip regex above. If this
        // stays strict while the strip regex is tolerant, a drifted response
        // would have its tag correctly hidden from the user but silently never
        // recorded for mind-change tracking (data loss with no visible symptom).
        const classificationMatch = acc.match(/<pushback_classification>([\s\S]*?)<\/(?:pushback_classification|pushback)>/)
        if (classificationMatch) {
          const classification = classificationMatch[1].trim().toLowerCase()
          const validClassifications = ['weak', 'partially_valid', 'materially_valid', 'recommendation_changing']
          if (validClassifications.includes(classification) && sessionId) {
            fetch(`/api/session/${sessionId}/pushback-classification`, {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ personaKey: persona.key, classification }),
            }).catch(() => { /* non-blocking, silent */ })
          }
        }
        // Strip lens/position/realcost tags from pushback reply (keep original header state)
        const cleanReply = stripHeaderTags(acc)
        const newExchanges = [...exchangesRef.current, { user: userText, reply: cleanReply }]
        setExchanges(newExchanges)
        setIsPushingBack(false)
        const fullContent = [rawInitialRef.current || responseRef.current, ...newExchanges.map(e => `[Pushback: "${e.user}"]\n${e.reply}`)].join('\n\n')
        onCompleteRef.current?.(persona.key, fullContent)
        // Automatic percolation: this advisor's own completion is now part of
        // the same "whole council reassessing this new information" batch as
        // the other 5 (see handleShareContext / handleExaminerUpdateComplete
        // in SessionView) — notify so the batch can close and fire exactly
        // one synthesis re-run once everyone (including this advisor) has
        // landed, instead of one bump here plus a second one after the other
        // five finish. No-ops harmlessly if this key isn't part of an active
        // batch (e.g. onShareContext wasn't wired for this card).
        onExaminerUpdateCompleteRef.current?.(persona.key, fullContent)
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
    // Keep the raw (tag-intact) original-response segment current too — see
    // rawInitialRef's definition above for why this must stay separate from
    // responseRef.current.
    rawInitialRef.current = initialContent.split(/\n\n\[(?:Pushback|Updated after Examiner)/)[0]
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
          // P1 fix: this stream loop never parsed <lean> before stripping it —
          // only the individual-pushback branch in streamResponse() did. Share
          // to All Advisors goes through THIS function, not that one, so a
          // lean shift triggered by this path was silently discarded, which
          // meant leanShifts computed in SynthesisCard was always empty for
          // anyone using Share to All Advisors instead of per-persona Challenge
          // — i.e. the weight-delta boost (Gap #2) never actually fired.
          const leanMatch = acc.match(/<lean>([\s\S]*?)<\/lean>/)
          if (leanMatch) {
            const lean = leanMatch[1].trim().toLowerCase()
            if (lean === 'proceed' || lean === 'wait' || lean === 'mixed') {
              onLeanUpdateRef.current?.(persona.key, lean)
            }
          }
          const fullContent = [rawInitialRef.current || responseRef.current, `[Updated after Examiner answers]\n${cleanAcc}`,
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
    const challengeText = pushback
    const updated: Message[] = [
      ...messages,
      { id: Date.now().toString(), session_id: sessionId, persona: persona.key, role: 'user', content: challengeText, created_at: new Date().toISOString() },
    ]
    setMessages(updated)
    setPushback('')
    setShowPushback(false)
    setIsPushingBack(true)
    onFirstChallengeUsed?.()
    // Automatic percolation: a challenge is new evidence, not reasoning
    // specific to this one advisor — broadcast it to the rest of the council
    // immediately, in parallel with this advisor's own detailed reply below,
    // rather than waiting for a manual "Share to all advisors" click. Each of
    // the other advisors reassesses independently through its own lens (see
    // the examinerMsg wording in handleShareContext, SessionView.tsx) — this
    // call shares the raw new information only, never this advisor's take on
    // it. See handleShareContext / handleExaminerUpdateComplete in
    // SessionView for how this advisor's own completion below and the other
    // five's are folded into exactly one downstream synthesis re-run.
    onShareContext?.(challengeText)
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
          <StatusBadge />
          {/* Item #9 (revised) — mobile-only card collapse toggle; hidden
              entirely on desktop, and only shown once the response is done */}
          {panelState === 'done' && (
            <button
              className="persona-mobile-toggle"
              onClick={() => setMobileCollapsed(c => !c)}
              aria-expanded={!mobileCollapsed}
              aria-label={mobileCollapsed ? 'Expand analysis' : 'Collapse analysis'}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--text-4)', padding: 2, display: 'none', alignItems: 'center',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: mobileCollapsed ? 'none' : 'rotate(180deg)', transition: 'transform 0.2s' }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          )}
          </div>  {/* close buttons row */}
        </div>  {/* close justify-between */}
      </div>

      {/* Body — Item #33/#34 §2.2: split into an always-visible summary
          (position + a compact real-cost preview while collapsed) and a
          collapsible detail block. Previously `.persona-body-mobile` wrapped
          the entire body, so collapsing on mobile hid the stance too — a
          glance at a collapsed card told you nothing. The summary below sits
          outside that class so it survives collapse; the detail block below
          it keeps the exact same className/is-collapsed behavior as before. */}
      <div style={{ padding: '14px 16px 0' }}>
        {positionText && (
          <div style={{ marginBottom: mobileCollapsed && realCostText && panelState === 'done' ? 10 : 14 }}>
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
            {/* Vet-fix (b): positionText/realCostText above are deliberately
                frozen at the original response — kept that way so "what did
                this advisor originally think" stays a stable reference point
                while the pushback thread below shows the prose evolution.
                But this persona's <lean> classification does keep updating
                on pushback (onLeanUpdate → SessionView's personaLeans →
                fed back in as currentLean), and that updated value already
                drives synthesis weighting and the What Changed drawer
                elsewhere in the session — so leaving this card with no
                visible sign of it meant the card could visibly say
                "Proceed" while the system had already moved this advisor to
                "Wait". This badge doesn't rewrite the header; it just makes
                the shift the system already knows about visible here too. */}
            {initialLean && currentLean && currentLean !== initialLean && (
              <p style={{
                margin:     '6px 0 0',
                fontSize:   11.5,
                fontWeight: 500,
                color:      'var(--gold)',
              }}>
                Shifted after pushback → now leaning {LEAN_LABELS[currentLean]}
              </p>
            )}
            <div style={{ marginTop: 12, borderTop: '1px solid var(--border-dim)' }} />
          </div>
        )}

        {/* Compact real-cost preview — collapsed-mobile only. Item #33/#34
            bugfix: this used to be gated only on the mobileCollapsed JS
            boolean, which can stay true on a desktop-width viewport (e.g.
            the card was collapsed at a narrow width, then the window was
            widened without a reload) — the state doesn't know the CSS
            media query no longer hides the detail block below, so both
            copies of "The real cost" showed at once. Now always rendered
            in the tree; visibility is entirely CSS-driven via
            .persona-collapsed-realcost, which only resolves to visible
            inside the same @media(max-width:600px) block that hides the
            detail block — the two can no longer disagree. */}
        {realCostText && panelState === 'done' && (
          <p
            className={`persona-collapsed-realcost${mobileCollapsed ? ' is-collapsed' : ''}`}
            style={{
              fontSize:   12,
              fontStyle:  'italic',
              color:      'var(--text-4)',
              lineHeight: 1.6,
              margin:     '0 0 14px',
            }}
          >
            {realCostText}
          </p>
        )}
      </div>

      <div
        className={`persona-body-mobile${mobileCollapsed ? ' is-collapsed' : ''}`}
        style={{ flex: 1, padding: '0 16px 14px', overflowY: 'auto', maxHeight: 380 }}
      >

        {/* Original response — never mutated */}
        {response && (
          <p className={`persona-response ${panelState === 'streaming' && !isPushingBack ? 'cursor' : ''}`}>
            {renderAssumption(response, panelState === 'done')}
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

        {/* Item #14 — synthesized rationale, hidden by default behind a
            small toggle so it never competes with the analysis itself.
            Only shown at all when there's something to show. */}
        {structuralCitationText && panelState === 'done' && (
          <div style={{ marginTop: 16 }}>
            <button
              onClick={() => setShowWhy(w => !w)}
              aria-expanded={showWhy}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                background: 'transparent', border: 'none', cursor: 'pointer',
                padding: 0, fontFamily: 'inherit',
                fontSize: 11, fontWeight: 600, color: 'var(--text-4)', letterSpacing: '0.03em',
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: showWhy ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
              Why
            </button>
            {showWhy && structuralCitationBlock}
          </div>
        )}

        {isPushingBack && (
          <p style={{ fontSize: 12, color: 'var(--gold)', marginTop: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--gold)', display: 'inline-block', animation: 'blink 1s step-end infinite' }} />
            Responding…
          </p>
        )}

        {/* Automatic percolation: challenging this advisor now shares that new
            information with the rest of the council automatically, fired the
            moment the challenge was submitted (see handlePushback) — well
            before this reply even finished streaming. Purely informational;
            there's nothing left to click. Each advisor reassesses
            independently through its own lens (they may keep, strengthen,
            weaken, or reverse their stance) — this note doesn't imply they
            reached the same conclusion, only that they saw the same new
            information. */}
        {panelState === 'done' && !isPushingBack && exchanges.length > 0 && onShareContext && (
          <div style={{
            marginTop: 16, display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 11.5, fontWeight: 600, color: 'var(--gold)', letterSpacing: '0.02em',
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
            Shared with the full council — each advisor is reassessing independently
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

        {/* Challenge discoverability pass: the disagree control now lives at the
            end of the card's content — where a disagreement actually forms —
            instead of a small pill in the header before the analysis is even
            read. Full-width, primary visual weight, impossible to miss on a
            finished card. Same showPushback/handlePushback state as before,
            just relocated + relabeled + restyled. */}
        {panelState === 'done' && !isPushingBack && examinerUpdateState !== 'streaming' && !showPushback && (
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border-dim)' }}>
            {/* Ambient hint — only on cards that haven't themselves been
                challenged yet, once at least one other card has been. */}
            {anyCardChallenged && exchanges.length === 0 && (
              <p style={{ fontSize: 11, color: 'var(--gold)', opacity: 0.85, margin: '0 0 8px', fontStyle: 'italic' }}>
                You can challenge this one too.
              </p>
            )}
            <button
              data-tour-id="council-challenge"
              title="Disagree with this analysis, add new information, or ask a follow-up"
              onClick={() => setShowPushback(true)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                width: '100%',
                background: 'rgba(201,168,76,0.12)', border: '1px solid var(--gold-dim)',
                borderRadius: 8, padding: '11px 14px', fontSize: 13, fontWeight: 600,
                color: 'var(--gold)', cursor: 'pointer', transition: 'all 0.2s',
                fontFamily: 'inherit', letterSpacing: '0.02em',
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
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>
              </svg>
              Disagree or ask a follow-up
            </button>
          </div>
        )}

        {panelState === 'idle' && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 50 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--border-mid)', animation: 'blink 1.2s ease-in-out infinite' }} />
          </div>
        )}
      </div>

      {/* Pushback input — shown below content when triggered from the
          bottom-of-card "Disagree or ask a follow-up" control */}
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
