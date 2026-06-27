'use client'

import { useRouter } from 'next/navigation'
import { pushSessionId, getOrCreateDeviceId, getStoredSessionIds } from '@/lib/storage'
import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import PersonaPanel from './PersonaPanel'
import ExaminerPanel from './ExaminerPanel'
import SynthesisCard from './SynthesisCard'
import CouncilStatusBar from './CouncilStatusBar'
import { TTSProvider } from '@/context/TTSContext'
import { PERSONAS, PERSONA_ORDER, computePersonaOrder } from '@/lib/personas'
import type { Session, RegisterMode } from '@/lib/types'
import type { PersonaKey } from '@/lib/types'
import { createClient } from '@/lib/supabase'
import RecordReceipt from './RecordReceipt'
import ContradictionBanner from './ContradictionBanner'
import DecisionStateCard from './DecisionStateCard'    // Sprint Chunk 1
import RuleRecallBanner from './RuleRecallBanner'       // Sprint Chunk 1
import OnboardingTour from './OnboardingTour'
import type { TourStep } from './OnboardingTour'
import ValidationCard from './ValidationCard'             // SB-1
import BiasNoteCard from './BiasNoteCard'                 // SB-3: shown above personas on live session

// ── Sprint TOUR-1: Council page tour steps ────────────────────────────────────
// Fires once, 800ms after synthesisDone flips to true for the first time.
const COUNCIL_STEPS: TourStep[] = [
  {
    id:             'council-synthesis',
    targetSelector: '[data-tour-id="council-synthesis"]',
    heading:        'The Council\'s integrated verdict',
    body:           'After all six advisors weigh in, Quorum synthesises their positions into one strategic brief. Dissenting views are preserved, not averaged away. Read this first — it surfaces the sharpest tensions.',
    preferredSide:  'bottom',
  },
  {
    id:             'council-bias',
    targetSelector: '[data-tour-id="council-bias"]',
    heading:        'Pattern detected in how this was framed',
    body:           'When bias scoring flags a distorting pattern in this decision, it surfaces here — above the persona cards, while the analysis is fresh. This is not a judgment. It is a signal about a reasoning tendency Quorum has observed across your sessions.',
    preferredSide:  'bottom',
  },
  {
    id:             'council-validation',
    targetSelector: '[data-tour-id="council-validation"]',
    heading:        'Confirm or correct Quorum\'s read',
    body:           'After synthesis, Quorum surfaces the emotional and identity shape it inferred for this decision. Confirming it trains your Council. Correcting it is even more valuable — a correction feeds directly into how the next session\'s council is framed for you.',
    preferredSide:  'top',
  },
  {
    id:             'council-personas',
    targetSelector: '[data-tour-id="council-personas"]',
    heading:        'Six advisors, six different lenses',
    body:           'Tap any card to read the full analysis. You can challenge an advisor with a follow-up — and once you\'ve exchanged, a "Share this context with all advisors" button appears. Tap it and every advisor re-analyses with your new context. This is the most powerful feature on this page.',
    preferredSide:  'bottom',
  },
  {
    id:             'council-capture',
    targetSelector: '[data-tour-id="council-capture"]',
    heading:        'Capture your position before you decide',
    body:           'After reading the Council, record where you stand — your current lean, what would change your mind, and when you\'ll review this. This is not just a note. Quorum uses it to track how your thinking shifts between decision and outcome.',
    preferredSide:  'bottom',
  },
  {
    id:             'council-save',
    targetSelector: '[data-tour-id="council-save"]',
    heading:        'Save this as a permanent record',
    body:           'Once you\'ve absorbed the Council\'s analysis, save this decision. It becomes a permanent entry in your judgment record — synthesis, every advisor\'s position, and your confidence rating. This is how your Judgment OS compounds over time.',
    preferredSide:  'bottom',
  },
]

interface Props {
  session: Session
  initialMessages?: Record<string, string>
  totalSessionCount?: number   // real DB count for RecordReceipt, passed from server
  // S2-02 / S2-03: server-side context for trust disclosure
  encryptionEnabled?: boolean  // true if DB_ENCRYPTION_KEY is set
}

type RuleMode = 'REDIRECT' | 'GATE' | 'OPEN' | null

// ── Gap → Persona mapping ────────────────────────────────────────────────
function mapGapToPersona(gap: string): string | null {
  const g = gap.toLowerCase()
  if (
    g.includes('stakeholder') || g.includes('spouse') || g.includes('co-founder') ||
    g.includes('sister') || g.includes('brother') || g.includes('wife') ||
    g.includes('children') || g.includes('father') || g.includes('mother') ||
    g.includes('son') || g.includes('daughter') || g.includes('family') ||
    g.includes('succession') || g.includes('motivation') || g.includes('personal') ||
    g.includes('relationship') || g.includes('partner')
  ) return 'stakeholder_mirror'
  if (
    g.includes('financial') || g.includes('health') || g.includes('track record') ||
    g.includes('cash') || g.includes('legal') || g.includes('contract') ||
    g.includes('exit') || g.includes('runway') || g.includes('execution') ||
    g.includes('counterparty') || g.includes('investor') || g.includes('vendor') ||
    g.includes('terms') || g.includes('fee') || g.includes('penalty') ||
    g.includes('valuation') || g.includes('tax')
  ) return 'risk_architect'
  if (
    g.includes('market') || g.includes('competitive') || g.includes('landscape') ||
    g.includes('demand') || g.includes('industry') || g.includes('precedent')
  ) return 'pattern_analyst'
  return null
}

function buildExaminerContextForPersona(
  personaKey: string,
  responses: Array<{ question_text: string; response_text: string | null; gap: string }>
): string | undefined {
  const relevant = responses.filter(r => mapGapToPersona(r.gap) === personaKey && r.response_text?.trim())
  if (relevant.length === 0) return undefined
  const lines = relevant.map(r => `Q: ${r.question_text}\nA: ${r.response_text}`).join('\n\n')
  return `The Examiner gathered additional information from the decision-maker after your initial analysis. Review these answers and update your position if the new information changes your assessment:\n\n${lines}\n\nProvide a concise update (under 200 words). If the new information significantly changes your view, say so directly. If it confirms your original analysis, say that — and why.`
}

export default function SessionView({ session: initialSession, initialMessages = {}, totalSessionCount, encryptionEnabled = false }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    try {
      const key = 'quorum_session_ids'
      const raw = localStorage.getItem(key)
      const ids: string[] = raw ? JSON.parse(raw) : []
      if (!ids.includes(initialSession.id)) {
        const updated = [initialSession.id, ...ids].slice(0, 20)
        localStorage.setItem(key, JSON.stringify(updated))
      }
    } catch {}
  }, [initialSession.id])

  const [saved, setSaved] = useState(false)

  const [registerMode,   setRegisterMode]   = useState<RegisterMode>(
    (initialSession.register_mode ?? 'analytical') as RegisterMode
  )
  const [reRegisterMode, setReRegisterMode] = useState<RegisterMode>(
    (initialSession.register_mode ?? 'analytical') as RegisterMode
  )

  const [session,    setSession]    = useState<Session>(initialSession)
  const [sessionKey, setSessionKey] = useState(0)
  const [completedResponses, setCompletedResponses] = useState<Record<string, string>>(initialMessages)
  const [decisionExpanded, setDecisionExpanded] = useState(false)
  const [contextExpanded,  setContextExpanded]  = useState(false)

  // Synthesis gate state
  const [examinerReady,            setExaminerReady]            = useState(false)
  const [synthesisVersion,         setSynthesisVersion]         = useState(0)
  const [examinerContextByPersona, setExaminerContextByPersona] = useState<Record<string, string>>({})

  // New flow: personas fire AFTER examiner, not before.
  const [examinerSubmitted,      setExaminerSubmitted]      = useState(false)
  const [examinerInitialContext, setExaminerInitialContext] = useState<Record<string, string>>({})
  const [synthExaminerContext,   setSynthExaminerContext]   = useState<string | undefined>(undefined)

  // Sprint 11b: rule engine state
  const [ruleMode,          setRuleMode]          = useState<RuleMode>(null)
  const [redirectBlocked,   setRedirectBlocked]   = useState(false)
  const [redirectQuestion,  setRedirectQuestion]  = useState<string | undefined>(undefined)
  const [examinerDismissed, setExaminerDismissed] = useState(false)

  // Sprint 5: structural context
  const [structuralContext, setStructuralContext] = useState<string | null>(null)

  // Council status bar state
  const [ontologyReady,      setOntologyReady]      = useState(false)
  const [synthesisStreaming,  setSynthesisStreaming]  = useState(false)
  const [synthesisDone,       setSynthesisDone]       = useState(false)
  // Client-side: fetched after synthesisDone — bias scoring is complete by then.
  const [biasNote,            setBiasNote]            = useState<{ label: string; reasoning: string } | null>(null)
  // Sprint TOUR-1: council tour
  const [showCouncilTour,     setShowCouncilTour]     = useState(false)
  const [contradiction,       setContradiction]       = useState<{
    id: string
    principleText: string
    principleSessionId: string | null
    principleDecision: string | null
    violationText: string
    violationSessionId: string | null
    violationDecision: string | null
    severity: 'sharp' | 'notable' | 'forming'
    category: string
  } | null>(null)
  const [authTokenSV,         setAuthTokenSV]         = useState<string | null>(null)

  // Dynamic grid order
  const [orderedPersonaKeys, setOrderedPersonaKeys] = useState<PersonaKey[]>([...PERSONA_ORDER])
  const [gridReordered,      setGridReordered]      = useState(false)
  const [labelText,          setLabelText]          = useState('')
  const pendingOrderRef      = useRef<PersonaKey[] | null>(null)
  const allPersonasDoneRef   = useRef(false)
  const examinerSubmittedRef = useRef(false)
  // Sprint Chunk 1 fix: stores rule text if user clicks "Apply this rule" on
  // RuleRecallBanner BEFORE submitting the examiner. Read by handleExaminerComplete
  // to prepend the rule to every persona's initial context and to synthExaminerContext.
  const appliedRuleRef = useRef<string | null>(null)
  const styleCueRef          = useRef<string | null>(null)

  // ── FLIP animation refs ──────────────────────────────────────────────────
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const snapRef  = useRef<Record<string, DOMRect>>({})

  // FLIP — Play step
  useLayoutEffect(() => {
    const snap = snapRef.current
    if (Object.keys(snap).length === 0) return

    const DURATION = 1100
    const EASING   = 'cubic-bezier(0.4, 0, 0.2, 1)'

    for (const [key, el] of Object.entries(cardRefs.current)) {
      if (!el || !snap[key]) continue
      const newRect = el.getBoundingClientRect()
      const oldRect = snap[key]
      const dx = oldRect.left - newRect.left
      const dy = oldRect.top  - newRect.top
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue

      el.style.transition = 'none'
      el.style.transform  = `translate(${dx}px, ${dy}px)`

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.style.transition = `transform ${DURATION}ms ${EASING}`
          el.style.transform  = ''
        })
      })
    }

    const cleanup = setTimeout(() => {
      for (const el of Object.values(cardRefs.current)) {
        if (el) { el.style.transition = ''; el.style.transform = '' }
      }
    }, DURATION + 60)

    snapRef.current = {}
    return () => clearTimeout(cleanup)
  }, [orderedPersonaKeys])

  const applyOrderWithFlip = useCallback((newOrder: PersonaKey[]) => {
    const snap: Record<string, DOMRect> = {}
    for (const [key, el] of Object.entries(cardRefs.current)) {
      if (el) snap[key] = el.getBoundingClientRect()
    }
    snapRef.current = snap
    setOrderedPersonaKeys(newOrder)
    setGridReordered(true)
  }, [])

  const LABEL_FULL = 'Ranked by relevance to your decision \u2192'
  useEffect(() => {
    if (!gridReordered) return
    let i = 0
    setLabelText('')
    const iv = setInterval(() => {
      i++
      setLabelText(LABEL_FULL.slice(0, i))
      if (i >= LABEL_FULL.length) clearInterval(iv)
    }, 32)
    return () => clearInterval(iv)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridReordered])

  useEffect(() => {
    async function fetchStyleCue() {
      try {
        const supabase = createClient()
        const { data: { session: authSession } } = await supabase.auth.getSession()
        if (!authSession?.access_token) return
        const res = await fetch('/api/mirror/preferences', {
          headers: { Authorization: `Bearer ${authSession.access_token}` },
        })
        if (!res.ok) return
        const { style_cue } = await res.json()
        if (style_cue) styleCueRef.current = style_cue
      } catch {
        // Non-critical
      }
    }
    fetchStyleCue()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetch auth token once for ContradictionBanner
  useEffect(() => {
    createClient().auth.getSession().then(({ data: { session: s } }) => {
      if (s?.access_token) setAuthTokenSV(s.access_token)
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetch contradiction for this session once synthesis is done
  useEffect(() => {
    if (!synthesisDone || !authTokenSV) return
    fetch('/api/mirror/contradictions', {
      headers: { Authorization: `Bearer ${authTokenSV}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.contradictions?.length) return
        // Only show if this session is the violation — no fallback to avoid false context
        const pick = data.contradictions.find(
          (c: { violationSessionId: string | null }) => c.violationSessionId === session.id
        )
        if (pick) setContradiction({
          id:                 pick.id,
          principleText:      pick.principleText,
          principleSessionId: pick.principleSessionId ?? null,
          principleDecision:  pick.principleDecision ?? null,
          violationText:      pick.violationText,
          violationSessionId: pick.violationSessionId ?? null,
          violationDecision:  pick.violationDecision ?? null,
          severity:           pick.severity ?? 'forming',
          category:           pick.category ?? '',
        })
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [synthesisDone, authTokenSV])

  // Fetch bias note client-side after synthesis completes.
  // Bias scoring runs in /api/examiner POST so data is guaranteed in DB by synthesisDone.
  useEffect(() => {
    if (!synthesisDone || !authTokenSV) return
    fetch(`/api/session/${session.id}/bias-note`, {
      headers: { Authorization: `Bearer ${authTokenSV}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.biasNote) setBiasNote(data.biasNote) })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [synthesisDone, authTokenSV])

  // Sprint TOUR-1: fire council tour once after synthesis completes
  useEffect(() => {
    if (!synthesisDone) return
    try {
      const done    = localStorage.getItem('quorum_tour.council')
      const skipped = localStorage.getItem('quorum_tour.home') === 'skip'
      if (!done && !skipped) {
        const t = setTimeout(() => setShowCouncilTour(true), 800)
        return () => clearTimeout(t)
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [synthesisDone])

  useEffect(() => {
    let attempt = 0
    const MAX_ATTEMPTS = 4
    const RETRY_MS     = 6000

    const fetchStructuralContext = () => {
      fetch('/api/structural-match', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sessionId: initialSession.id }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.ontology_ready && !pendingOrderRef.current) {
            setOntologyReady(true)
            const ordered = computePersonaOrder(
              data.rule_engine_result ?? null,
              data.ontology_vector    ?? null,
              styleCueRef.current,
            )
            pendingOrderRef.current = ordered as PersonaKey[]
            if (allPersonasDoneRef.current && examinerSubmittedRef.current) {
              const isDifferent = ordered.some((k: string, i: number) => k !== PERSONA_ORDER[i])
              if (isDifferent) {
                applyOrderWithFlip(ordered as PersonaKey[])
              }
              pendingOrderRef.current = null
            }
          }
          if (data.threshold_met && data.context_block) {
            setStructuralContext(data.context_block)
            return
          }
          if (!data.ontology_ready && attempt < MAX_ATTEMPTS) {
            attempt++
            setTimeout(fetchStructuralContext, RETRY_MS)
          }
        })
        .catch(err => console.error('[SessionView] Structural match fetch failed:', err))
    }

    fetchStructuralContext()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSession.id])

  const handlePersonaComplete = useCallback((personaKey: string, content: string) => {
    setCompletedResponses(prev => {
      const isUpdate = personaKey in prev
      if (isUpdate) setSynthesisVersion(v => v + 1)
      const next = { ...prev, [personaKey]: content }

      if (!isUpdate && Object.keys(next).length >= PERSONA_ORDER.length) {
        allPersonasDoneRef.current = true
        const pending = pendingOrderRef.current
        if (pending && examinerSubmittedRef.current) {
          const isDifferent = pending.some((k, i) => k !== PERSONA_ORDER[i])
          if (isDifferent) {
            setTimeout(() => {
              applyOrderWithFlip(pending as PersonaKey[])
              pendingOrderRef.current = null
            }, 0)
          } else {
            pendingOrderRef.current = null
          }
        }
      }
      return next
    })
  }, [])

  const allPersonasDone = Object.keys(completedResponses).length >= PERSONA_ORDER.length

  const handleExaminerComplete = useCallback(
    (
      responses:       Array<{ question_text: string; response_text: string | null; gap: string }>,
      mode:            RuleMode,
      redirectQuestion?: string
    ) => {
      setRuleMode(mode)

      if (mode === 'REDIRECT') {
        setRedirectBlocked(true)
        if (redirectQuestion) setRedirectQuestion(redirectQuestion)
        setExaminerReady(false)
        setExaminerSubmitted(true)
        examinerSubmittedRef.current = true
        return
      }

      examinerSubmittedRef.current = true
      setExaminerSubmitted(true)
      setExaminerReady(true)

      const pending = pendingOrderRef.current
      if (pending && allPersonasDoneRef.current) {
        const isDifferent = pending.some((k, i) => k !== PERSONA_ORDER[i])
        if (isDifferent) {
          setTimeout(() => {
            applyOrderWithFlip(pending as PersonaKey[])
            pendingOrderRef.current = null
          }, 0)
        } else {
          pendingOrderRef.current = null
        }
      }

      if (!responses.length) return

      // Sprint Chunk 1 fix: if user applied a rule before submitting the examiner,
      // prepend it to all synthesis and persona contexts so the Council reasons
      // against it. Format mirrors the C0 block so personas treat it equivalently.
      const appliedRuleBlock = appliedRuleRef.current
        ? `USER APPLIED RULE — from their prior decisions (factor this into your analysis where relevant):\n"${appliedRuleRef.current}"\n\n`
        : ''

      const allAnswered = responses.filter(r => r.response_text?.trim())
      if (allAnswered.length > 0 || appliedRuleBlock) {
        setSynthExaminerContext(
          appliedRuleBlock +
          allAnswered.map(r => `Q: ${r.question_text}\nA: ${r.response_text}`).join('\n\n')
        )
      }

      const c0Responses = responses.filter(r => r.gap === 'C0 — CONTEXT' && r.response_text?.trim())
      const c0Block = c0Responses.length > 0
        ? `USER STATED INTENT:\nQ: ${c0Responses[0].question_text}\nA: ${c0Responses[0].response_text}\n\n`
        : ''

      // contextPreamble = applied rule (if any) + C0 block — shared prefix for
      // every persona's initial context. Rule comes first so it frames the C0 answer.
      const contextPreamble = appliedRuleBlock + c0Block

      const initialCtx: Record<string, string> = {}
      for (const pk of PERSONA_ORDER) {
        const ruleAnswers = responses.filter(r =>
          r.gap !== 'C0 — CONTEXT' &&
          mapGapToPersona(r.gap) === pk &&
          r.response_text?.trim()
        )
        const ruleBlock = ruleAnswers.length > 0
          ? `ADDITIONAL CONTEXT FROM EXAMINER:\n${ruleAnswers.map(r => `Q: ${r.question_text}\nA: ${r.response_text}`).join('\n\n')}`
          : ''
        const combined = (contextPreamble + ruleBlock).trim()
        if (combined) initialCtx[pk] = combined
      }
      if (contextPreamble.trim() && Object.keys(initialCtx).length < PERSONA_ORDER.length) {
        for (const pk of PERSONA_ORDER) {
          if (!initialCtx[pk]) initialCtx[pk] = contextPreamble.trim()
        }
      }
      if (Object.keys(initialCtx).length > 0) {
        setExaminerInitialContext(initialCtx)
      }
    },
    []
  )

  const shareContextPendingRef = useRef<Set<string>>(new Set())

  const handleExaminerUpdateComplete = useCallback((personaKey: string) => {
    if (!shareContextPendingRef.current.has(personaKey)) return
    shareContextPendingRef.current.delete(personaKey)
    if (shareContextPendingRef.current.size === 0) {
      setSynthesisVersion(v => v + 1)
    }
  }, [])

  const handleShareContext = useCallback((originPersonaKey: string, text: string) => {
    const examinerMsg = `The user submitted the following new information while challenging another advisor. Review it and update your position if it changes your assessment:\n\n"${text}"\n\nProvide a concise update (under 200 words). If this materially changes your view, say so directly. If it confirms your original analysis, say that — and why.`
    const pendingKeys = PERSONA_ORDER.filter(k => k !== originPersonaKey)
    shareContextPendingRef.current = new Set(pendingKeys)
    setExaminerContextByPersona(prev => {
      const next = { ...prev }
      for (const key of pendingKeys) {
        next[key] = examinerMsg
      }
      return next
    })
  }, [])

  const handleOverrideRedirect = useCallback(async () => {
    fetch('/api/ontology', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sessionId: session.id }),
    }).catch(() => {})

    setRedirectBlocked(false)
    setRuleMode(null)
    setExaminerReady(true)
    setExaminerDismissed(true)
    examinerSubmittedRef.current = true
    setExaminerSubmitted(true)
    const pending = pendingOrderRef.current
    if (pending && allPersonasDoneRef.current) {
      const isDifferent = pending.some((k, i) => k !== PERSONA_ORDER[i])
      if (isDifferent) {
        setTimeout(() => { applyOrderWithFlip(pending as PersonaKey[]); pendingOrderRef.current = null }, 0)
      } else {
        pendingOrderRef.current = null
      }
    }
  }, [session.id])

  const [drawerOpen,     setDrawerOpen]     = useState(false)
  const [reDecision,     setReDecision]     = useState(initialSession.decision_text)
  const [reContext,      setReContext]       = useState(initialSession.context_text ?? '')
  // Root-cause fix (Sprint RET-4 follow-up, June 21, 2026): reanalyzed decisions previously
  // never captured entry confidence, so they were silently invisible to the calibration
  // record (KDD 194). Defaults to 5, same as the homepage form's slider.
  const [rePreConfidence, setRePreConfidence] = useState(5)
  const [reanalyzing,    setReanalyzing]     = useState(false)
  const [reanalyzeError, setReanalyzeError] = useState('')

  const handleNewDecision = () => {
    if (!saved) {
      const ok = window.confirm(
        `Start a new decision?\n\nThis session is still available at its URL, but you haven\u2019t saved the Decision Record yet.`
      )
      if (!ok) return
    }
    router.push('/')
  }

  const handleSaveRecord = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/record', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sessionId: session.id }),
      })
      if (!res.ok) throw new Error()
      setSaved(true)
      router.push(`/record/${session.id}`)
    } catch {
      setSaving(false)
      alert('Could not save record. Please try again.')
    }
  }

  const handleReanalyze = useCallback(async () => {
    if (!reDecision.trim() || reDecision.trim().length < 20) {
      setReanalyzeError('Please describe your decision in at least a sentence.')
      return
    }
    setReanalyzeError('')
    setReanalyzing(true)
    try {
      // S4-02: server derives user_id from Bearer token only — never trust body.
      let accessToken: string | null = null
      try {
        const { createClient } = await import('@/lib/supabase')
        const sb = createClient()
        const { data: { session: authSession } } = await sb.auth.getSession()
        accessToken = authSession?.access_token ?? null
      } catch { /* non-blocking */ }

      const res = await fetch('/api/session', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {}),
        },
        body:    JSON.stringify({
          decision_text: reDecision.trim(),
          context_text:  reContext.trim() || null,
          register_mode: reRegisterMode,
          pre_decision_confidence: rePreConfidence,
          // user_id intentionally omitted — server derives from Bearer token (S4-02)
          device_id:     getOrCreateDeviceId(),
          parent_session_id: session.id,    // ← RET-5 Sprint 1: link back to origin
        }),
      })
      if (!res.ok) throw new Error()
      const { id }         = await res.json()
      const sessionRes     = await fetch(`/api/session?id=${id}`)
      if (!sessionRes.ok) throw new Error()
      const newSession: Session = await sessionRes.json()
      setSession(newSession)
      setSessionKey(k => k + 1)
      setCompletedResponses({})
      setExaminerReady(false)
      setExaminerContextByPersona({})
      setExaminerSubmitted(false)
      setExaminerInitialContext({})
      setSynthExaminerContext(undefined)
      setRegisterMode(reRegisterMode)
      setSynthesisVersion(0)
      setSaved(false)
      setDrawerOpen(false)
      setReanalyzing(false)
      setRuleMode(null)
      setRedirectBlocked(false)
      setRedirectQuestion(undefined)
      setExaminerDismissed(false)
      setOrderedPersonaKeys([...PERSONA_ORDER])
      setGridReordered(false)
      setLabelText('')
      allPersonasDoneRef.current = false
      pendingOrderRef.current = null
      examinerSubmittedRef.current = false
      setOntologyReady(false)
      setSynthesisStreaming(false)
      setSynthesisDone(false)
      window.history.replaceState(null, '', `/session/${id}`)
    } catch {
      setReanalyzeError('Something went wrong. Please try again.')
      setReanalyzing(false)
    }
  }, [reDecision, reContext, reRegisterMode, rePreConfidence])

  // ── Scroll state for navbar shadow ───────────────────────────────────────
  const [navScrolled, setNavScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 32)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <>
      {/* ── Entrance animation keyframes (CSS-only, no logic) ── */}
      <style>{`
        @keyframes sessionFadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .sv-fade { animation: sessionFadeIn 400ms ease-out both; }
        .sv-fade-1 { animation-delay: 0ms; }
        .sv-fade-2 { animation-delay: 120ms; }
        .sv-fade-3 { animation-delay: 240ms; }
        .sv-fade-4 { animation-delay: 360ms; }

        /* Drawer slide-up */
        @keyframes drawerSlideUp {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        .sv-drawer { animation: drawerSlideUp 280ms cubic-bezier(0.32, 0.72, 0, 1) both; }

        /* Session navbar */
        .sv-navbar {
          position: fixed;
          top: 0; left: 0; right: 0;
          z-index: 8500;
          display: flex;
          align-items: center;
          height: 56px;
          padding: 0 20px;
          background: var(--bg-card);
          border-bottom: 1px solid var(--border-dim);
          transition: box-shadow 0.3s ease, border-color 0.3s ease;
          gap: 16px;
        }
        .sv-navbar.scrolled {
          box-shadow: 0 2px 20px rgba(0,0,0,0.35);
          border-bottom-color: var(--border-mid);
        }
        [data-theme="light"] .sv-navbar.scrolled {
          box-shadow: 0 2px 12px rgba(6,13,28,0.10);
        }
        .sv-navbar-wordmark {
          flex-shrink: 0;
          font-family: var(--font-mono);
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: var(--gold);
          text-decoration: none;
        }
        .sv-navbar-divider {
          width: 1px;
          height: 18px;
          background: var(--border-dim);
          flex-shrink: 0;
        }
        .sv-navbar-decision {
          flex: 1;
          min-width: 0;
          font-size: 12px;
          color: var(--text-3);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-family: var(--font-body);
          letter-spacing: -0.005em;
        }
        .sv-navbar-badge {
          flex-shrink: 0;
          font-size: 10px;
          font-family: var(--font-mono);
          letter-spacing: 0.09em;
          text-transform: uppercase;
          color: var(--text-4);
          padding: 3px 9px;
          border-radius: 20px;
          background: var(--bg-inset);
          border: 1px solid var(--border-dim);
          white-space: nowrap;
        }
        .sv-navbar-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
          /* Clear ThemeToggle on the right — it's at right: 20px, ~120px wide */
          margin-right: 116px;
        }
        .sv-navbar-actions .btn-ghost {
          font-size: 12px;
          padding: 8px 14px;
          white-space: nowrap;
        }
        .sv-navbar-actions .btn-primary {
          font-size: 12px;
          padding: 9px 16px;
        }
        .sv-save-short { display: none; }
        .sv-save-full  { display: inline; }

        @media (max-width: 600px) {
          .sv-navbar            { padding: 0 10px; }
          .sv-navbar-decision   { display: none; }
          .sv-navbar-divider    { display: none; }
          .sv-navbar-badge      { display: none; }
          .sv-navbar-actions    { margin-right: 92px; gap: 6px; }
          .sv-save-short        { display: inline; }
          .sv-save-full         { display: none; }
          /* Reanalyze sits beside Save with tighter padding */
          .sv-navbar-actions .btn-ghost   { padding: 7px 10px; }
          .sv-navbar-actions .btn-primary { padding: 8px 12px; }
          /* Override global .nav-tagline { display: none } — keep "Reanalyze" label visible here */
          .sv-navbar-actions .btn-ghost .nav-tagline { display: inline; }
        }

        /* Decision hero card */
        .sv-hero {
          background: var(--bg-card);
          border: 1px solid var(--border-mid);
          border-radius: 18px;
          box-shadow: var(--shadow-card);
          padding: 24px 28px 20px;
          position: relative;
          /* NOTE: intentionally NO overflow:hidden here.
             Android Chrome clips sibling elements (e.g. "Show more" button) when
             overflow:hidden is set on a parent that contains a -webkit-line-clamp
             child. The ::before gradient and border-radius work without it. */
        }
        .sv-hero::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 1px;
          background: linear-gradient(90deg, transparent, var(--gold-dim), transparent);
          pointer-events: none;
        }
        @media (max-width: 600px) {
          .sv-hero { padding: 18px 16px 16px; }
        }
        .sv-hero-decision {
          font-family: var(--font-display);
          font-size: clamp(17px, 2.2vw, 22px);
          font-weight: 500;
          line-height: 1.45;
          letter-spacing: -0.015em;
          color: var(--text-1);
        }
        .sv-hero-context {
          font-size: 12.5px;
          line-height: 1.65;
          color: var(--text-3);
        }

        /* Bottom action tray */
        .sv-tray {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
        }
        .sv-tray-left { display: flex; gap: 8px; flex-wrap: wrap; }
        @media (max-width: 480px) {
          .sv-tray { flex-direction: column; align-items: stretch; }
          .sv-tray-left { justify-content: stretch; }
          .sv-tray-left .btn-ghost { flex: 1; justify-content: center; }
        }

        /* Register mode option buttons (reanalyze drawer) */
        .sv-mode-btn {
          padding: 11px 14px;
          border-radius: 10px;
          text-align: left;
          cursor: pointer;
          font-family: var(--font-body);
          transition: border-color 0.15s, background 0.15s;
          border: 1px solid var(--border-dim);
          background: transparent;
        }
        .sv-mode-btn.active-analytical {
          border-color: var(--gold);
          background: var(--gold-glow);
        }
        .sv-mode-btn.active-clarification {
          border-color: var(--green-text);
          background: rgba(74,222,128,0.07);
        }
        [data-theme="light"] .sv-mode-btn.active-clarification {
          background: var(--green-soft);
        }
      `}</style>

      <div style={{ minHeight: '100vh', background: 'var(--bg-void)' }}>

        {/* ── Fixed Session Navbar ──────────────────────────────────── */}
        <nav className={`sv-navbar${navScrolled ? ' scrolled' : ''}`}>
          <button className="sv-navbar-wordmark" onClick={handleNewDecision} style={{background:'none',border:'none',cursor:'pointer',padding:0}}>Quorum</button>
          <div className="sv-navbar-divider" />
          <span className="sv-navbar-decision">{session.decision_text}</span>
          <span className="sv-navbar-badge">Session active</span>
          <div className="sv-navbar-actions">
            <div className="sv-navbar-reanalyze">
            <button
              className="btn-ghost"
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={() => { setReDecision(session.decision_text); setReContext(session.context_text ?? ''); setDrawerOpen(true) }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/>
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
              </svg>
              <span className="nav-tagline" style={{ margin: 0, letterSpacing: '0.04em', textTransform: 'none', color: 'inherit' }}>Reanalyze</span>
            </button>
            </div>
            <button
              className="btn-primary"
              onClick={handleSaveRecord}
              disabled={saving}
              data-tour-id="council-save"
            >
              {saving ? 'Saving…' : <><span className="sv-save-full">Save Record</span><span className="sv-save-short">Save</span></>}
            </button>
          </div>
        </nav>

        {/* ── Main content — padded below fixed navbar ──────────────── */}
        <div style={{ paddingTop: 72, paddingBottom: 60, paddingLeft: 16, paddingRight: 16 }}>
          <div style={{ maxWidth: '80rem', margin: '0 auto' }}>

            {/* ── Decision Hero Card ────────────────────────────────── */}
            <div className="sv-hero sv-fade sv-fade-1" style={{ marginBottom: 20 }}>
              {/* Section label */}
              <p style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--text-4)',
                marginBottom: 10,
              }}>
                The Decision
              </p>

              {/* Decision text — display serif, prominent */}
              <p
                className="sv-hero-decision"
                style={decisionExpanded ? {} : {
                  display: '-webkit-box',
                  WebkitLineClamp: 4,
                  WebkitBoxOrient: 'vertical' as const,
                  overflow: 'hidden',
                }}
              >
                {session.decision_text}
              </p>
              {session.decision_text.length > 220 && (
                <button
                  onClick={() => setDecisionExpanded(v => !v)}
                  style={{
                    marginTop: 6,
                    display: 'block',
                    minHeight: 28,
                    fontSize: 11,
                    color: 'var(--text-4)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '4px 0',
                    fontFamily: 'var(--font-mono)',
                    letterSpacing: '0.05em',
                  }}
                >
                  {decisionExpanded ? '↑ Show less' : '↓ Show more'}
                </button>
              )}

              {/* Context — below gold divider */}
              {session.context_text && (
                <>
                  <div className="gold-rule" style={{ margin: '14px 0' }} />
                  <p
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9.5,
                      letterSpacing: '0.13em',
                      textTransform: 'uppercase',
                      color: 'var(--text-4)',
                      marginBottom: 6,
                    }}
                  >
                    Context
                  </p>
                  <p
                    className="sv-hero-context"
                    style={contextExpanded ? {} : {
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical' as const,
                      overflow: 'hidden',
                    }}
                  >
                    {session.context_text}
                  </p>
                  {session.context_text.length > 120 && (
                    <button
                      onClick={() => setContextExpanded(v => !v)}
                      style={{
                        marginTop: 4,
                        display: 'block',
                        minHeight: 28,
                        fontSize: 11,
                        color: 'var(--text-4)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '4px 0',
                        fontFamily: 'var(--font-mono)',
                        letterSpacing: '0.05em',
                      }}
                    >
                      {contextExpanded ? '↑ Show less' : '↓ Show more'}
                    </button>
                  )}
                </>
              )}

              {/* Privacy notice + AI disclosure — footer inside hero card */}
              <div style={{
                marginTop: 14,
                paddingTop: 12,
                borderTop: '1px solid var(--border-dim)',
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
              }}>
                {/* Session scope */}
                <p style={{
                  fontSize: 11,
                  color: 'var(--text-4)',
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.04em',
                  margin: 0,
                }}>
                  {session.user_id
                    ? `Linked to your account · included in decision memory${encryptionEnabled ? ' · encrypted at rest' : ''}`
                    : `Private by URL · no account or identity linked${encryptionEnabled ? ' · encrypted at rest' : ''}`
                  }
                </p>
                {/* S2-02: AI processing disclosure */}
                <p style={{
                  fontSize: 11,
                  color: 'var(--text-4)',
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.04em',
                  margin: 0,
                }}>
                  Analysed by AI · not used for model training
                </p>
              </div>
            </div>

            <TTSProvider>
              {/* ── Council Status Bar ── */}
              <div className="sv-fade sv-fade-1">
                <CouncilStatusBar
                  key={`statusbar-${sessionKey}`}
                  personasComplete={Object.keys(completedResponses).length}
                  totalPersonas={PERSONA_ORDER.length}
                  ontologyReady={ontologyReady}
                  examinerActive={ontologyReady && !examinerReady && !redirectBlocked}
                  examinerDone={examinerReady || (redirectBlocked && examinerSubmitted)}
                  synthesisStreaming={synthesisStreaming}
                  synthesisDone={synthesisDone}
                />
              </div>

              {/* ── 1. Council Synthesis ── */}
              <div className="sv-fade sv-fade-2" data-tour-id="council-synthesis">
                <SynthesisCard
                  key={`synthesis-${sessionKey}`}
                  sessionId={session.id}
                  decisionText={session.decision_text}
                  contextText={session.context_text ?? undefined}
                  personaResponses={completedResponses}
                  totalPersonas={PERSONA_ORDER.length}
                  version={synthesisVersion}
                  registerMode={registerMode}
                  examinerReady={examinerReady}
                  redirectBlocked={redirectBlocked}
                  redirectQuestion={redirectQuestion}
                  onOverrideRedirect={handleOverrideRedirect}
                  onSynthesisStart={() => setSynthesisStreaming(true)}
                  onSynthesisComplete={() => { setSynthesisStreaming(false); setSynthesisDone(true) }}
                  examinerContext={synthExaminerContext}
                />
              </div>

              {/* ── 1b. Record Receipt (appears after synthesis completes) ── */}
              {synthesisDone && (
                <div className="sv-fade sv-fade-2" style={{ marginTop: 0 }}>
                  <RecordReceipt
                    sessionCount={totalSessionCount ?? getStoredSessionIds().length}
                    decisionType={session.decision_type_primary ?? undefined}
                    irreversibility={(() => {
                      const s = (session.stakes_reversibility ?? '').toLowerCase()
                      if (s.includes('high') || s.includes('irrevers')) return 'high'
                      if (s.includes('medium') || s.includes('partial')) return 'medium'
                      if (s.includes('low') || s.includes('revers')) return 'low'
                      return undefined
                    })()}
                    mirrorActive={false}
                  />
                </div>
              )}

              {/* ── 1c. Contradiction Banner ─────────────────────────────── */}
              {synthesisDone && contradiction && (
                <div className="sv-fade sv-fade-2">
                  <ContradictionBanner
                    contradiction={contradiction}
                    authToken={authTokenSV}
                    onDismiss={() => setContradiction(null)}
                  />
                </div>
              )}

              {/* ── 1d. Decision State Card (Sprint Chunk 1) ─────────────── */}
              {/* Appears after synthesis completes. Captures commitment position,
                  switch conditions, and review date in 3 clubbed fields. */}
              {synthesisDone && (
                <div className="sv-fade sv-fade-2" data-tour-id="council-capture">
                  <DecisionStateCard sessionId={session.id} />
                </div>
              )}

              {/* ── 2b. Rule Recall Banner (Sprint Chunk 1 fix) ──────────── */}
              {/* Fires when ontologyReady — BEFORE examiner submission so the
                  user's "Apply" choice is captured before handleExaminerComplete
                  fires. onRuleApplied sets appliedRuleRef which is then read by
                  handleExaminerComplete to inject the rule into Council context.
                  Auto-dismisses when examiner is submitted without a choice.
                  Silent no-op below the 8-session rules threshold. */}
              <RuleRecallBanner
                sessionId={session.id}
                authToken={authTokenSV}
                visible={ontologyReady && !examinerSubmitted && !redirectBlocked}
                onRuleApplied={(rule) => { appliedRuleRef.current = rule }}
              />

              {/* ── 2c. Examiner ── */}
              <div className="sv-fade sv-fade-2">
                <ExaminerPanel
                  key={`examiner-${sessionKey}`}
                  sessionId={session.id}
                  visible={true}
                  onComplete={handleExaminerComplete}
                  forceDismissed={examinerDismissed}
                />
              </div>

              {/* ── 3. Relevance label ── */}
              {gridReordered && !redirectBlocked && (
                <div style={{ display: 'flex', justifyContent: 'center', margin: '16px 0 12px' }}>
                  <span className="relevance-label">
                    {labelText}
                    {labelText.length < LABEL_FULL.length && (
                      <span style={{ opacity: 1, animation: 'blink 0.7s step-end infinite', marginLeft: 1 }}>|</span>
                    )}
                  </span>
                </div>
              )}

              {/* ── SB-3: Bias note — fetched client-side after synthesis completes ── */}
              {/* biasNote is only set once /api/session/[id]/bias-note resolves, so the  */}
              {/* synthesisDone gate is implicit — no extra condition needed here.         */}
              {biasNote && (
                <div data-tour-id="council-bias" style={{ marginBottom: 8 }}>
                  <BiasNoteCard note={biasNote} />
                </div>
              )}

              {/* ── 4. Six persona panels ── */}
              <div
                className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sv-fade sv-fade-3"
                data-tour-id="council-personas"
                style={{
                  paddingTop:    12,
                  opacity:       redirectBlocked ? 0.55 : 1,
                  pointerEvents: redirectBlocked ? 'none' : 'auto',
                }}
              >
                {orderedPersonaKeys.map((key) => (
                  <div
                    key={`${key}-${sessionKey}`}
                    ref={el => { cardRefs.current[key] = el }}
                    style={{ willChange: 'transform' }}
                  >
                    <PersonaPanel
                      persona={PERSONAS[key]}
                      sessionId={session.id}
                      decisionText={session.decision_text}
                      contextText={session.context_text ?? undefined}
                      registerMode={registerMode}
                      onComplete={handlePersonaComplete}
                      examinerContext={examinerContextByPersona[key]}
                      structuralContext={structuralContext ?? undefined}
                      onShareContext={(text) => handleShareContext(key, text)}
                      onExaminerUpdateComplete={handleExaminerUpdateComplete}
                      initialContent={initialMessages[key]}
                      canStream={examinerSubmitted || !!initialMessages[key]}
                      initialExaminerContext={examinerInitialContext[key]}
                    />
                  </div>
                ))}
              </div>
            </TTSProvider>

            {/* ── SB-1: Validation Card — appears when all personas + synthesis complete ── */}
            {/* Surfaces Quorum's emotional/archetype inference for user to confirm or correct. */}
            {/* The correction feeds directly into the council context for the next session.   */}
            {allPersonasDone && synthesisDone && (
              <div data-tour-id="council-validation">
              <ValidationCard
                sessionId={session.id}
                authToken={authTokenSV}
                userEmail={session.user_email ?? null}
                totalSessionCount={totalSessionCount}
              />
              </div>
            )}

            {/* ── Bottom Action Tray ── */}
            <div className="sv-fade sv-fade-4" style={{ marginTop: 44 }}>
              <div className="gold-rule" style={{ marginBottom: 20 }} />
              <div className="sv-tray">
                <div className="sv-tray-left">
                  <button
                    className="btn-ghost"
                    style={{ fontSize: 13, padding: '11px 18px', display: 'flex', alignItems: 'center', gap: 7, minHeight: 44 }}
                    onClick={handleNewDecision}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    New Decision
                  </button>
                  <button
                    className="btn-ghost"
                    style={{ fontSize: 13, padding: '11px 18px', display: 'flex', alignItems: 'center', gap: 7, minHeight: 44 }}
                    onClick={() => { setReDecision(session.decision_text); setReContext(session.context_text ?? ''); setDrawerOpen(true) }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/>
                      <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
                    </svg>
                    Reanalyze
                  </button>
                </div>
                <button
                  className="btn-primary"
                  style={{ fontSize: 13, padding: '12px 28px', minHeight: 44 }}
                  onClick={handleSaveRecord}
                  disabled={saving}
                >
                  {saving ? 'Saving…' : 'Save to Record'}
                </button>
              </div>
            </div>

          </div>
        </div>

        {/* ── Reanalyze Drawer ── */}
        {drawerOpen && (
          <>
            <div
              onClick={() => setDrawerOpen(false)}
              style={{
                position: 'fixed', inset: 0,
                background: 'rgba(2,4,10,0.72)',
                zIndex: 9100,
                backdropFilter: 'blur(2px)',
                WebkitBackdropFilter: 'blur(2px)',
              }}
            />
            <div
              className="sv-drawer"
              style={{
                position: 'fixed', bottom: 0, left: 0, right: 0,
                zIndex: 9200,
                background: 'var(--bg-card)',
                border: '1px solid var(--border-mid)',
                borderBottom: 'none',
                borderRadius: '18px 18px 0 0',
                padding: '28px 28px 44px',
                maxWidth: 760,
                margin: '0 auto',
                boxShadow: '0 -8px 40px rgba(0,0,0,0.4)',
              }}
            >
              {/* Drag handle */}
              <div style={{
                width: 36, height: 4, borderRadius: 2,
                background: 'var(--border-mid)',
                margin: '0 auto 24px',
              }} />

              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22, gap: 12 }}>
                <div>
                  <h2 style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 20,
                    fontWeight: 500,
                    color: 'var(--text-1)',
                    margin: 0,
                    letterSpacing: '-0.015em',
                  }}>
                    Reanalyze
                  </h2>
                  <p style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 4, fontStyle: 'italic' }}>
                    Edit the decision or add new context — all six advisors re-run
                  </p>
                </div>
                <button
                  className="btn-ghost"
                  style={{ padding: '6px 12px', fontSize: 12, flexShrink: 0, minHeight: 36 }}
                  onClick={() => setDrawerOpen(false)}
                >
                  ✕ Close
                </button>
              </div>

              {/* Decision textarea */}
              <label style={{
                display: 'block',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.13em',
                textTransform: 'uppercase',
                color: 'var(--text-4)',
                marginBottom: 7,
              }}>
                Decision
              </label>
              <textarea
                rows={5}
                value={reDecision}
                onChange={(e) => setReDecision(e.target.value)}
                style={{ fontSize: 13.5, marginBottom: 16 }}
                placeholder="Describe your decision…"
              />

              {/* Context textarea */}
              <label style={{
                display: 'block',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.13em',
                textTransform: 'uppercase',
                color: 'var(--text-4)',
                marginBottom: 7,
              }}>
                Additional context{' '}
                <span style={{ color: 'var(--text-4)', textTransform: 'none', letterSpacing: '0.02em', opacity: 0.7 }}>(optional)</span>
              </label>
              <textarea
                rows={3}
                value={reContext}
                onChange={(e) => setReContext(e.target.value)}
                style={{ fontSize: 13, marginBottom: 20 }}
                placeholder="Add new information that has emerged…"
              />

              {/* Register mode */}
              <label style={{
                display: 'block',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.13em',
                textTransform: 'uppercase',
                color: 'var(--text-4)',
                marginBottom: 10,
              }}>
                What are you looking for this time?
              </label>
              <div className="home-two-col" style={{ gap: 8, marginBottom: 20 }}>
                {([
                  { value: 'analytical',    icon: '⚔',  label: 'Challenge my thinking',        sub: 'Stress-test the decision' },
                  { value: 'clarification', icon: '🪞', label: 'Help me understand what I want', sub: 'Values and identity' },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setReRegisterMode(opt.value)}
                    className={`sv-mode-btn${reRegisterMode === opt.value ? ` active-${opt.value}` : ''}`}
                    style={{ minHeight: 44 }}
                  >
                    <p style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: reRegisterMode === opt.value
                        ? (opt.value === 'analytical' ? 'var(--gold)' : 'var(--green-text)')
                        : 'var(--text-2)',
                      marginBottom: 3,
                    }}>
                      {opt.icon} {opt.label}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--text-4)', fontStyle: 'italic' }}>{opt.sub}</p>
                  </button>
                ))}
              </div>

              {/* Confidence slider — closes the gap that left reanalyzed decisions
                  out of the calibration record (KDD 194) */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <label style={{
                    fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.13em',
                    textTransform: 'uppercase', color: 'var(--text-4)',
                  }}>
                    Confidence going into this reanalysis
                  </label>
                  <span style={{
                    fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)',
                    color: rePreConfidence <= 3 ? '#c04040' : rePreConfidence <= 6 ? 'var(--gold)' : 'var(--green-text)',
                    minWidth: 28, textAlign: 'right',
                  }}>
                    {rePreConfidence}<span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-4)' }}>/10</span>
                  </span>
                </div>
                <input
                  type="range" min={1} max={10} step={1}
                  value={rePreConfidence}
                  onChange={(e) => setRePreConfidence(Number(e.target.value))}
                  style={{
                    width: '100%',
                    accentColor: rePreConfidence <= 3 ? '#c04040' : rePreConfidence <= 6 ? 'var(--gold)' : 'var(--green-text)',
                    cursor: 'pointer', height: 4,
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-4)' }}>Foggy</span>
                  <span style={{ fontSize: 10, color: 'var(--text-4)' }}>Fully clear</span>
                </div>
              </div>

              {reanalyzeError && (
                <p style={{ fontSize: 12, color: 'var(--error)', marginBottom: 12 }}>
                  {reanalyzeError}
                </p>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  className="btn-primary"
                  style={{ flex: 1, fontSize: 14, padding: '13px', minHeight: 48 }}
                  onClick={handleReanalyze}
                  disabled={reanalyzing || !reDecision.trim()}
                >
                  {reanalyzing ? 'Convening new Council…' : 'Convene New Council'}
                </button>
                <button
                  className="btn-ghost"
                  style={{ padding: '13px 20px', fontSize: 13, minHeight: 48 }}
                  onClick={() => setDrawerOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Sprint TOUR-1: First-decision council tour ────────────────── */}
      {showCouncilTour && (
        <OnboardingTour
          page="council"
          steps={COUNCIL_STEPS}
          active={showCouncilTour}
          onComplete={() => {
            try { localStorage.setItem('quorum_tour.council', 'done') } catch {}
            setShowCouncilTour(false)
          }}
          onSkip={() => {
            try {
              ;['quorum_tour.council', 'quorum_tour.record']
                .forEach(k => localStorage.setItem(k, 'skip'))
            } catch {}
            setShowCouncilTour(false)
          }}
        />
      )}
    </>
  )
}