'use client'

import { useRouter } from 'next/navigation'
import { pushSessionId, getOrCreateDeviceId, getStoredSessionIds } from '@/lib/storage'
import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import PersonaPanel from './PersonaPanel'
import ExaminerPanel from './ExaminerPanel'
import SynthesisCard from './SynthesisCard'
import CouncilStatusBar from './CouncilStatusBar'
import { TTSProvider } from '@/context/TTSContext'
import {
  PERSONAS, PERSONA_ORDER, computePersonaOrder,
  type RuleEngineResult, type OntologyVector,
} from '@/lib/personas'
import type { Session, RegisterMode } from '@/lib/types'
import type { PersonaKey } from '@/lib/types'
import { createClient } from '@/lib/supabase'
import RecordReceipt from './RecordReceipt'
import ContradictionBanner from './ContradictionBanner'
import DecisionStateCard from './DecisionStateCard'    // Sprint Chunk 1
import RuleRecallBanner from './RuleRecallBanner'       // Sprint Chunk 1
import OnboardingTour from './OnboardingTour'
import type { TourStep } from './OnboardingTour'
import { buildPWAInstallStep } from './OnboardingTour'
import ValidationCard from './ValidationCard'             // SB-1
import BiasNoteCard from './BiasNoteCard'                 // SB-3: shown above personas on live session
import OntologyRevealCard   from './OntologyRevealCard'   // S1-01: Decision X-Ray (sessions 1–3)
import DecisionGraph        from './DecisionGraph'        // S1-07: Graph teaser (sessions 1–3)
import GraphNudgeLine       from './GraphNudgeLine'        // QW-3: Graph nudge (sessions 6+)
import OpeningCeremonyCard  from './OpeningCeremonyCard'  // S2-07: ritual beat before personas stream (sessions 1–3)
import TensionInterstitial  from './TensionInterstitial'  // S3-01: pre-synthesis tension beat
import EarlyEchoCard        from './EarlyEchoCard'         // Sprint: second-use early signal, sessions 2-4
import type { Lean }        from './TensionInterstitial'
import SessionCompleteBadge from './SessionCompleteBadge' // S1-06: Council complete timestamp
import {
  DECISION_TYPE_LABELS,
  REVERSIBILITY_LABELS,
  FRAMING_INTENT_LABELS,
} from '@/lib/session-labels'                             // S1-05: profile strip labels

// ── Sprint TOUR-1: Council page tour steps ────────────────────────────────────
// Fires once, 800ms after synthesisDone flips to true for the first time.
// The final step list is built dynamically at runtime (see the synthesisDone effect)
// so a PWA install step can be appended when conditions are met.
const COUNCIL_STEPS_BASE: TourStep[] = [
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
    body:           'When Quorum detects a bias pattern in how this decision was framed, it surfaces here — above the persona cards, while the analysis is still fresh. Not every session triggers this. When it does, it\'s a signal about a reasoning tendency in your framing — not a judgment on the decision itself.',
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
    targetSelector: '[data-tour-id="council-challenge"]',
    heading:        'Six advisors, six different lenses',
    body:           'Tap any card to read the full analysis. At the bottom of a finished card you\'ll find "Disagree or ask a follow-up" — use it to push back, and that advisor responds directly. Challenge one, and the same option appears highlighted on the others. Once you have, the verdict below updates to reflect it.',
    preferredSide:  'top',
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
  /** O4: real Mirror subscription state, resolved server-side via getMirrorAccessState().
   *  Previously hardcoded false — paying Mirror subscribers were getting free-tier
   *  Council behaviour. Now threaded through to RecordReceipt and PersonaPanel. */
  mirrorActive?: boolean
  /** P0 tour fix: server-side truth for "has this user already seen the Council tour",
   *  resolved from user_profiles.council_tour_completed_at. Previously this tour was
   *  gated on localStorage alone, so a returning/established user on a fresh device
   *  (e.g. a freshly installed mobile PWA) would see a "first decision" tour again. */
  councilTourDone?: boolean
  /** P0 examiner-refire fix: server-side truth for "has the Examiner already been
   *  submitted or skipped for this session", resolved from sessions_ontology.examiner_status.
   *  Previously this was never checked on mount, so a page reload (e.g. after a
   *  network error mid-Council) always re-asked the Examiner questions from scratch,
   *  even though the answers (or the skip) were already persisted. */
  examinerAlreadySubmitted?: boolean
  /** P0 follow-up fix: the persisted Examiner Q&A for this session (decrypted
   *  server-side), used to reconstruct examinerInitialContext/synthExaminerContext
   *  on mount when examinerAlreadySubmitted is true. Without this, an advisor
   *  that hadn't finished streaming before a reload (e.g. a network failure
   *  mid-Council) would fire fresh with no Examiner context at all — the
   *  Examiner UI correctly doesn't re-ask, but the context it gathered was
   *  otherwise lost. Empty array when skipped (no rows) or not yet submitted. */
  examinerSavedResponses?: Array<{ question_text: string; response_text: string | null; gap: string }>
  /** P1 fix: server-side truth for a previously "applied" Rule Recall choice
   *  (sessions.rule_recall_choice/rule_recall_rule_text). appliedRuleRef was
   *  purely in-memory, so a reload after a network failure silently dropped
   *  the user's choice even though it was already persisted. */
  appliedRuleFromServer?: string | null
  /** P1: persisted synthesis-version snapshots (verdict/weights/leans per
   *  version), for the What Changed drawer's reload resilience — same
   *  pattern as examinerSavedResponses above. Empty on a brand-new session. */
  initialSynthesisVersions?: Array<{
    version:     number
    verdictText: string
    verdictLean: string
    weights:     Record<string, number>
    leans:       Record<string, string>
  }>
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

export default function SessionView({ session: initialSession, initialMessages = {}, totalSessionCount, encryptionEnabled = false, mirrorActive = false, councilTourDone = false, examinerAlreadySubmitted = false, examinerSavedResponses = [], appliedRuleFromServer = null, initialSynthesisVersions = [] }: Props) {
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

  // Bug fix: `initialMessages` (built server-side from the `messages` table) contains
  // an entry per DISTINCT persona value ever saved for this session — which includes
  // 'synthesis' (and potentially 'decision_brief') alongside the six real council
  // personas. Seeding completedResponses directly from initialMessages was leaking
  // those non-advisor entries into the advisor-response map: it inflated the
  // "all personas done" count and, on any real re-synthesis, would have fed the PRIOR
  // synthesis text back into the synthesis prompt as if it were a 7th advisor's
  // response. Filter to PERSONA_ORDER keys only; the synthesis text is threaded to
  // SynthesisCard separately via initialSynthesisContent below.
  const [completedResponses, setCompletedResponses] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(initialMessages).filter(([key]) => (PERSONA_ORDER as string[]).includes(key))
    )
  )
  // Bug fix (council synthesis re-run on back-navigation): the persisted synthesis
  // text for this session, if any — passed to SynthesisCard so it renders the cached
  // result instead of firing a brand-new AI synthesis call every time SessionView
  // remounts (e.g. navigating back from the record page).
  //
  // Guarded to sessionKey === 0: initialMessages is a static prop from the original
  // server-rendered session and never updates client-side, so after Reanalyze creates
  // a brand-new session id, this must NOT carry the prior session's synthesis text
  // forward — the new session has no synthesis yet and must generate one for real.
  const initialSynthesisContent = sessionKey === 0 ? initialMessages['synthesis'] : undefined
  // P1: same sessionKey===0 guard — a "Reanalyze" session is a brand-new
  // linked session and starts its own fresh version history, it shouldn't
  // inherit the original session's synthesis-version snapshots.
  const initialSynthesisVersionsForThisSession = sessionKey === 0 ? initialSynthesisVersions : []
  const [decisionExpanded, setDecisionExpanded] = useState(false)
  const [contextExpanded,  setContextExpanded]  = useState(false)

  // Synthesis gate state
  const [examinerReady,            setExaminerReady]            = useState(examinerAlreadySubmitted)
  const [synthesisVersion,         setSynthesisVersion]         = useState(0)
  const [examinerContextByPersona, setExaminerContextByPersona] = useState<Record<string, string>>({})

  // New flow: personas fire AFTER examiner, not before.
  // P0 fix: seed from server truth (sessions.examiner_status) rather than always
  // starting false — otherwise a reload (e.g. after a network error mid-Council)
  // re-asks Examiner questions that were already answered or explicitly skipped.
  const [examinerSubmitted,      setExaminerSubmitted]      = useState(examinerAlreadySubmitted)
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
  const [councilTourSteps,    setCouncilTourSteps]    = useState<TourStep[]>(COUNCIL_STEPS_BASE)
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
  const examinerSubmittedRef = useRef(examinerAlreadySubmitted)
  // Sprint Chunk 1 fix: stores rule text if user clicks "Apply this rule" on
  // RuleRecallBanner BEFORE submitting the examiner. Read by handleExaminerComplete
  // to prepend the rule to every persona's initial context and to synthExaminerContext.
  // P1 fix: seeded from appliedRuleFromServer (sessions.rule_recall_rule_text)
  // rather than always null — see Props doc comment above.
  const appliedRuleRef = useRef<string | null>(appliedRuleFromServer)
  const styleCueRef          = useRef<string | null>(null)

  // S1-08: Race fix — track when style cue has resolved (or timed out)
  // Mirror preferences fetch can be slow; 4s timeout gives ample opportunity
  // before we fall back to ordering without personal style calibration.
  const [styleCueReady, setStyleCueReady] = useState(false)

  // S1-01: Decision X-Ray — ontology vector + dismiss flag
  const [ontologyVector, setOntologyVector] = useState<Record<string, { score: number; confidence: number }> | null>(null)
  // S1-05 fix: decision_type_primary + stakes_reversibility arrive from the
  // structural-match response once ontology is ready. Stored here so the profile
  // strip renders even on first load (server-side session has nulls until ontology
  // completes async). Falls back to session prop for returning users.
  const [profileMeta, setProfileMeta] = useState<{
    decision_type_primary: string | null
    stakes_reversibility:  string | null
  } | null>(null)
  const [xRayDismissed,  setXRayDismissed]  = useState(false)

  // QW-3: 6+ session graph nudge (Option A "new-connection" / Option C
  // "milestone") — fetched once from /api/session/[id]/graph-nudge, which
  // does its own event/cooldown gating server-side. null = not fetched yet
  // or nothing to show; this component only renders when show===true.
  const [graphNudge, setGraphNudge] = useState<
    | { show: true; variant: 'new-connection'; edgeType: string }
    | { show: true; variant: 'milestone'; edgeCount: number; milestone: number }
    | { show: true; variant: 'watchlist-suggestion'; gapText: string }
    | null
  >(null)
  // S2-07: Opening Ceremony dismiss flag — gates persona streaming for 3s on sessions 1-3
  const [ceremonyDismissed, setCeremonyDismissed] = useState(false)
  // S3-01: per-persona lean classification (proceed/wait/mixed), parsed from each
  // persona's raw <lean> header tag in handlePersonaComplete.
  const [personaLeans, setPersonaLeans] = useState<Record<string, Lean>>({})
  // P1 fix: called when a pushback reply carries a fresh lean that differs
  // from the persona's original classification (PersonaPanel's onLeanUpdate).
  // This is the only place personaLeans updates after the initial response —
  // synthesisVersion itself is already bumped separately by handlePersonaComplete's
  // isUpdate check on the same pushback event, so no extra version bump needed here.
  const handleLeanUpdate = useCallback((personaKey: string, lean: Lean) => {
    setPersonaLeans(prev => (prev[personaKey] === lean ? prev : { ...prev, [personaKey]: lean }))
  }, [])
  // S3-01: gates synthesis start for a brief tension-interstitial beat
  const [interstitialDismissed, setInterstitialDismissed] = useState(false)

  // S1-07: Structural echo banner — pattern_analyst card
  const [structuralContextActive, setStructuralContextActive] = useState(false)
  const [structuralMatchDate,     setStructuralMatchDate]     = useState<string | null>(null)
  // (d): matched past session's id, so the S1-07 echo banner can link to it
  const [structuralMatchSessionId, setStructuralMatchSessionId] = useState<string | null>(null)

  // S1-02: Sequential streaming — unlocks one persona at a time as each completes
  const [streamUnlockedUpTo, setStreamUnlockedUpTo] = useState<number>(0)

  // S1-06: Council complete badge — timestamp captured when synthesis finishes
  const [synthesisCompletedAt, setSynthesisCompletedAt] = useState<Date | null>(null)

  // S1-08: Race fix — stores rule_engine_result + ontology_vector from structural match
  // so computePersonaOrder can run once BOTH ontologyReady and styleCueReady are true
  const ontologyDataRef = useRef<{ rule_engine_result: RuleEngineResult | null; ontology_vector: OntologyVector | null } | null>(null)

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
    let settled = false
    // 4-second timeout — gives Mirror preferences API ample opportunity to respond
    // before we fall back to ordering without personal style calibration.
    // Deliberately generous: style cue affects persona ordering quality, not just speed.
    const timeout = setTimeout(() => {
      if (!settled) { settled = true; setStyleCueReady(true) }
    }, 4000)

    async function fetchStyleCue() {
      try {
        const supabase = createClient()
        const { data: { session: authSession } } = await supabase.auth.getSession()
        if (!authSession?.access_token) {
          if (!settled) { settled = true; setStyleCueReady(true) }
          return
        }
        const res = await fetch('/api/mirror/preferences', {
          headers: { Authorization: `Bearer ${authSession.access_token}` },
        })
        if (!res.ok) {
          if (!settled) { settled = true; setStyleCueReady(true) }
          return
        }
        const { style_cue } = await res.json()
        if (style_cue) styleCueRef.current = style_cue
      } catch {
        // Non-critical
      } finally {
        if (!settled) { settled = true; setStyleCueReady(true) }
      }
    }
    fetchStyleCue()
    return () => clearTimeout(timeout)
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
  // Auth header is included when available but is NOT required — bias-note route
  // accepts anonymous sessions via session UUID. Do not gate on authTokenSV.
  useEffect(() => {
    if (!synthesisDone) return
    fetch(`/api/session/${session.id}/bias-note`, {
      headers: authTokenSV ? { Authorization: `Bearer ${authTokenSV}` } : {},
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.biasNote) setBiasNote(data.biasNote) })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [synthesisDone, authTokenSV])

  // QW-3: fetch the 6+ session graph nudge once synthesis is done. Unlike
  // bias-note, this DOES require authTokenSV — the endpoint writes
  // cooldown/milestone state server-side and has no anonymous path (see its
  // own header comment). Gate on totalSessionCount > 5 client-side too, even
  // though the endpoint re-checks server-side — avoids a pointless fetch for
  // the sessions-1–5 window where the pictorial graph (S1-07) is shown instead.
  useEffect(() => {
    if (!synthesisDone || !authTokenSV) return
    if ((totalSessionCount ?? 0) <= 5) return
    fetch(`/api/session/${session.id}/graph-nudge`, {
      headers: { Authorization: `Bearer ${authTokenSV}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.show) setGraphNudge(data) })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [synthesisDone, authTokenSV, totalSessionCount])

  // Sprint TOUR-1: fire council tour once after synthesis completes
  // P0 fix: previously gated on localStorage alone, which is device-local — a
  // user with real decisions already on record (server truth: councilTourDone,
  // or a real DB count via totalSessionCount) would still see a "first decision"
  // tour on any device/browser where that one key had never been set (e.g. a
  // freshly installed mobile PWA on an account that already has 5 decisions).
  useEffect(() => {
    if (!synthesisDone) return
    if (councilTourDone) return
    if ((totalSessionCount ?? 0) > 1) return
    try {
      const done    = localStorage.getItem('quorum_tour.council')
      const skipped = localStorage.getItem('quorum_tour.home') === 'skip'
      if (!done && !skipped) {
        // Build step list: base steps + optional PWA install step
        const pwaStep = buildPWAInstallStep()
        setCouncilTourSteps(pwaStep ? [...COUNCIL_STEPS_BASE, pwaStep] : COUNCIL_STEPS_BASE)
        const t = setTimeout(() => setShowCouncilTour(true), 800)
        return () => clearTimeout(t)
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [synthesisDone, councilTourDone, totalSessionCount])

  useEffect(() => {
    let attempt = 0
    // Bug fix (STRUCT-1): widened from 4x6s (24s) — see app/api/ontology/
    // route.ts's fireStructuralMatch() for the primary fix (server-side
    // chain, fires immediately once tagging completes rather than relying on
    // this client poll alone). This retry loop is now a fallback for cases
    // where that server-to-server call fails for some transient reason —
    // widened modestly to match the Examiner's own retry budget rather than
    // giving up meaningfully sooner than the rest of the tagging-dependent UI.
    const MAX_ATTEMPTS = 6
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
            // S1-08: Store ontology data in ref — computePersonaOrder runs in
            // a dedicated useEffect once BOTH ontologyReady and styleCueReady
            // are true, ensuring style cue always informs ordering.
            ontologyDataRef.current = {
              rule_engine_result: (data.rule_engine_result as RuleEngineResult) ?? null,
              ontology_vector:    (data.ontology_vector    as OntologyVector)    ?? null,
            }
            // S1-01: Capture ontology vector for Decision X-Ray card (sessions 1–3)
            if (data.ontology_vector && typeof data.ontology_vector === 'object') {
              setOntologyVector(data.ontology_vector)
            }
            // S1-05: Capture metadata labels for the decision profile strip.
            // The server-side session prop may have nulls on first load; this
            // is the authoritative post-ontology source.
            setProfileMeta({
              decision_type_primary: (data.decision_type_primary as string) ?? null,
              stakes_reversibility:  (data.stakes_reversibility  as string) ?? null,
            })
          }
          if (data.threshold_met && data.context_block) {
            setStructuralContext(data.context_block)
            // S1-07: Structural echo banner — show on Pattern Analyst card
            setStructuralContextActive(true)
            setStructuralMatchDate(data.best_match_date ?? null)
            setStructuralMatchSessionId(data.best_match_session_id ?? null)
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

  // S1-08: Deferred persona ordering — runs once BOTH signals are ready.
  // Using a dedicated effect (not inside fetchStructuralContext callback) ensures
  // styleCueRef.current is populated before computePersonaOrder is called.
  // The 4-second styleCueReady timeout above guarantees this effect always fires.
  useEffect(() => {
    if (!ontologyReady || !styleCueReady) return
    if (pendingOrderRef.current) return // already computed
    const stored = ontologyDataRef.current
    if (!stored) return

    const ordered = computePersonaOrder(
      stored.rule_engine_result ?? null,
      stored.ontology_vector    ?? null,
      styleCueRef.current,
    )
    pendingOrderRef.current = ordered as PersonaKey[]

    if (allPersonasDoneRef.current && examinerSubmittedRef.current) {
      const isDifferent = ordered.some((k: string, i: number) => k !== PERSONA_ORDER[i])
      if (isDifferent) {
        applyOrderWithFlip(ordered as PersonaKey[])
        pendingOrderRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ontologyReady, styleCueReady])

  // Fix #3: tracks which advisors have a "Share to all advisors" update still
  // in flight. Declared here (rather than down near handleShareContext) so
  // handlePersonaComplete below can consult it. See handlePersonaComplete and
  // handleExaminerUpdateComplete for how this collapses N per-advisor
  // synthesis re-runs into one.
  const shareContextPendingRef = useRef<Set<string>>(new Set())

  const handlePersonaComplete = useCallback((personaKey: string, content: string) => {
    // P0 fix: defense-in-depth against the "N of 6" overcount bug — completedResponses
    // is keyed by personaKey and its size drives every "X of 6" display (CouncilStatusBar,
    // SynthesisCard). initialMessages seeding is already filtered to PERSONA_ORDER keys
    // (see completedResponses useState above), but that guard only covers the initial
    // hydration, not this live-update path — if anything ever calls onComplete with a
    // non-advisor key (e.g. 'synthesis', 'decision_brief', or a future mistake), it would
    // silently re-open the same leak. Ignore anything outside the canonical 6 here too.
    if (!(PERSONA_ORDER as string[]).includes(personaKey)) return

    // S3-01: capture this persona's lean classification, if present. Only overwrite on a
    // valid match — later calls (pushback replies, examiner updates) send pre-stripped
    // content without the tag, and should never clear a previously captured lean.
    const leanMatch = content.match(/<lean>([\s\S]*?)<\/lean>/)
    if (leanMatch) {
      const lean = leanMatch[1].trim().toLowerCase()
      if (lean === 'proceed' || lean === 'wait' || lean === 'mixed') {
        setPersonaLeans(prev => ({ ...prev, [personaKey]: lean as Lean }))
      }
    }

    setCompletedResponses(prev => {
      const isUpdate = personaKey in prev
      // Fix #3: during "Share to all advisors", each of the (up to 5) other
      // advisors completes independently, and previously each one bumped
      // synthesisVersion here — triggering, then immediately aborting, up to
      // 4 redundant synthesis re-runs before the real final one. When this
      // completion is part of a pending share-context batch, defer to
      // handleExaminerUpdateComplete, which bumps exactly once after the
      // whole batch has landed (with a timeout safety net in
      // handleShareContext in case one advisor's update fails).
      if (isUpdate && !shareContextPendingRef.current.has(personaKey)) {
        setSynthesisVersion(v => v + 1)
      }
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

  // S2-07: Opening Ceremony gating — only applies on sessions 1–3, and never during
  // a REDIRECT (R1 upstream block), where provisional advisor perspectives should
  // appear immediately rather than be delayed by a 3s ritual beat.
  const ceremonyApplicable = (totalSessionCount ?? 0) <= 3 && !redirectBlocked
  const ceremonyGateOpen   = !ceremonyApplicable || ceremonyDismissed
  const ceremonyActive     = examinerSubmitted && ceremonyApplicable && !ceremonyDismissed

  // S3-01: Tension interstitial — fires once all 6 advisors have finished AND the user
  // has answered the follow-up questions (the exact moment synthesis would otherwise
  // begin). Not gated by session count — this reflects THIS decision's actual tension,
  // not an onboarding ritual, so it's valuable for every session.
  const interstitialActive   = allPersonasDone && examinerReady && !interstitialDismissed && !redirectBlocked
  const interstitialGateOpen = !interstitialActive

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

  // P0 follow-up fix: on a fresh mount where the Examiner was already
  // submitted (examinerAlreadySubmitted), the Examiner UI correctly doesn't
  // re-fire — but nothing was reconstructing examinerInitialContext /
  // synthExaminerContext, so any advisor that hadn't finished streaming
  // before the reload (e.g. a network failure mid-Council) would start
  // fresh with no Examiner context at all. Feeding the persisted Q&A back
  // through handleExaminerComplete rebuilds those context blocks exactly as
  // if the Examiner had just been submitted normally. Guarded to sessionKey
  // === 0 (the page's original session — a "Reanalyze" session starts its
  // own fresh Examiner flow and shouldn't inherit this) and to run once.
  const examinerContextRestoredRef = useRef(false)
  useEffect(() => {
    if (examinerContextRestoredRef.current) return
    if (sessionKey !== 0) return
    if (!examinerAlreadySubmitted) return
    if (!examinerSavedResponses.length) return
    examinerContextRestoredRef.current = true
    handleExaminerComplete(examinerSavedResponses, 'GATE')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    const thisBatch = new Set(pendingKeys)
    shareContextPendingRef.current = thisBatch
    // Safety net: if any advisor's share-context update fails or hangs, it
    // never calls handleExaminerUpdateComplete, so the batch would otherwise
    // sit at size > 0 forever and synthesis would never re-run — silently
    // dropping the advisors that DID succeed too. Force a bump after a
    // generous window. The reference-equality check no-ops this if the batch
    // already completed normally, or if a newer share-context batch has since
    // replaced this one.
    setTimeout(() => {
      if (shareContextPendingRef.current === thisBatch && shareContextPendingRef.current.size > 0) {
        shareContextPendingRef.current = new Set()
        setSynthesisVersion(v => v + 1)
      }
    }, 25000)
    setExaminerContextByPersona(prev => {
      const next = { ...prev }
      for (const key of pendingKeys) {
        next[key] = examinerMsg
      }
      return next
    })
  }, [])

  // Challenge discoverability pass (Phase 3): once ANY card's pushback
  // completes, every other still-unchallenged card shows a quiet ambient
  // hint ("You can challenge this one too."). One-way flip for the session —
  // there's no scenario where it should go back to false mid-session.
  const [anyCardChallenged, setAnyCardChallenged] = useState(false)
  const handleFirstChallengeUsed = useCallback(() => {
    setAnyCardChallenged(true)
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
  const [rePreConfidence, setRePreConfidence] = useState(5)
  const [reanalyzing,    setReanalyzing]     = useState(false)
  const [reanalyzeError, setReanalyzeError] = useState('')
  // S1-04: third framing mode for reanalyze — 'right' matches home page option
  const [reFramingIntent, setReFramingIntent] = useState<'challenge' | 'clarify' | 'right'>('challenge')

  // S2-08: prior Council summary — fetched once when the drawer opens, so the user
  // recalls what was already concluded before choosing what to change. Full text is
  // fetched; a short preview shows by default with a toggle to expand (fix: previously
  // truncated server-side with no way to see the rest).
  const [priorSynthesisFull,   setPriorSynthesisFull]   = useState<string | null>(null)
  const [prioSummaryLoaded,    setPrioSummaryLoaded]    = useState(false)
  const [priorSummaryExpanded, setPriorSummaryExpanded] = useState(false)
  const PRIOR_SUMMARY_PREVIEW_CHARS = 220
  useEffect(() => {
    if (!drawerOpen || prioSummaryLoaded) return
    setPrioSummaryLoaded(true)
    fetch(`/api/session/${session.id}/synthesis-summary`)
      .then(r => r.json())
      .then(data => setPriorSynthesisFull(data.full ?? null))
      .catch(() => setPriorSynthesisFull(null))
  }, [drawerOpen, prioSummaryLoaded, session.id])

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
          // S1-04: framing_intent from third mode option ('right' = objective analysis)
          framing_intent: reFramingIntent === 'right'
            ? 'right'
            : reFramingIntent === 'clarify'
              ? 'clarify'
              : 'challenge',
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
      // S1: Reset all sprint 1 state on reanalyze
      setOntologyVector(null)
      setXRayDismissed(false)
      setStructuralContextActive(false)
      setStructuralMatchDate(null)
      setStreamUnlockedUpTo(0)
      setSynthesisCompletedAt(null)
      ontologyDataRef.current = null
      window.history.replaceState(null, '', `/session/${id}`)
    } catch {
      setReanalyzeError('Something went wrong. Please try again.')
      setReanalyzing(false)
    }
  // QC fix: session.id and reFramingIntent are both read inside this callback
  // (parent_session_id + framing_intent in the POST body) but were missing here.
  // Without them, a second reanalyze submitted with identical text/context/register/
  // confidence to the first would reuse the stale memoized closure and send the
  // ORIGINAL session's id as parent_session_id instead of the immediately prior one.
  }, [reDecision, reContext, reRegisterMode, rePreConfidence, reFramingIntent, session.id])

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
        .sv-mode-btn.active-right {
          border-color: #8840c4;
          background: rgba(136,64,196,0.10);
        }
        [data-theme="light"] .sv-mode-btn.active-right {
          background: rgba(136,64,196,0.08);
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

              {/* S1-05: Decision profile strip — plain-English metadata tags */}
              {(() => {
                const parts: string[] = []
                // Use profileMeta once ontology is ready; fall back to session prop
                // (pre-populated for returning users whose session already has these fields).
                const dt  = profileMeta?.decision_type_primary  ?? session.decision_type_primary
                const rev = profileMeta?.stakes_reversibility   ?? session.stakes_reversibility
                const fi  = session.framing_intent
                if (dt  && DECISION_TYPE_LABELS[dt])   parts.push(DECISION_TYPE_LABELS[dt])
                if (rev && REVERSIBILITY_LABELS[rev])  parts.push(REVERSIBILITY_LABELS[rev])
                if (fi  && FRAMING_INTENT_LABELS[fi])  parts.push(FRAMING_INTENT_LABELS[fi])
                // Show strip as long as at least one label is available — framing_intent
                // is always set on session creation so the strip is never empty.
                if (parts.length < 1) return null
                return (
                  <p style={{
                    fontSize:      11,
                    color:         'var(--text-4)',
                    margin:        '6px 0 0',
                    letterSpacing: '0.02em',
                    lineHeight:    1.4,
                    fontFamily:    'var(--font-mono)',
                  }}>
                    {parts.join(' · ')}
                  </p>
                )
              })()}

              {/* S3-04: Structural memory badge — a persistent, glanceable marker at the
                  top of the page that this decision is drawing on structural/longitudinal
                  memory. Complements the R6 per-persona citation badges (which appear on
                  whichever of the 5 eligible advisor cards actually drew on it, quoting
                  their specific observation) by making the fact visible immediately,
                  before the user scrolls to any advisor card. */}
              {structuralContextActive && (
                <div style={{
                  display:      'inline-flex',
                  alignItems:   'center',
                  gap:          5,
                  marginTop:    9,
                  padding:      '3px 10px',
                  borderRadius: 999,
                  border:       '1px solid var(--success-border)',
                  background:   'var(--success-bg)',
                  fontSize:     10.5,
                  color:        'var(--success-text)',
                }}>
                  <span style={{
                    width: 5, height: 5, borderRadius: '50%',
                    background: 'var(--success-text)', flexShrink: 0,
                  }} />
                  Drawing on structural memory
                </div>
              )}
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

              {/* S1-01: Decision X-Ray — shown sessions 1–3, auto-dismisses after 5s */}
              {/* Deliberately generous window: gives user time to read all 3 dimensions */}
              {ontologyReady
                && !xRayDismissed
                && (totalSessionCount ?? 0) <= 3
                && ontologyVector
                && (
                  <OntologyRevealCard
                    ontologyVector={ontologyVector}
                    onDismiss={() => setXRayDismissed(true)}
                  />
                )
              }

              {/* S1-07 / QW-3: Graph teaser — Option B (pictorial), sessions 1–5.
                  Sessions 1–3: appears as the X-Ray fades out, referencing the
                  ontology shape it just showed. Sessions 4–5: X-Ray no longer
                  renders (gated <=3), so this appears on its own once the
                  session is ready — no ontology callback in the copy, since
                  there's no "this shape" to refer back to.
                  Deliberately reuses DecisionGraph unmodified (same component +
                  same /api/mirror/graph endpoint as /mirror) rather than a
                  bespoke visual — what's shown here is guaranteed to match
                  what the person would see if they clicked through to /mirror
                  right now: a ghost node at session 1, a real (redacted)
                  preview graph from session 2 on. No timer — this one stays
                  up, it's meant to be an open loop, not a flash message.
                  Sessions 6+ get GraphNudgeLine instead (see bottom of flow) —
                  event-gated single line, not this pictorial version, per the
                  POV doc (item3-4plus-sessions-pov-plan.md). */}
              {(totalSessionCount ?? 0) <= 5
                && ontologyReady
                && (xRayDismissed || (totalSessionCount ?? 0) > 3)
                && (
                  <div
                    className="sv-fade"
                    style={{
                      background:   'var(--bg-card)',
                      border:       '1px solid var(--border-mid)',
                      borderRadius: 13,
                      padding:      '16px 20px 18px',
                      marginBottom: 12,
                    }}
                  >
                    <p style={{
                      fontFamily:    'var(--font-mono)',
                      fontSize:      10,
                      fontWeight:    700,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color:         'var(--text-4)',
                      margin:        '0 0 12px',
                    }}>
                      {(totalSessionCount ?? 0) <= 3
                        ? 'This shape gets compared against future decisions'
                        : 'Your Decision Graph'}
                    </p>
                    
                    <DecisionGraph
                                          authToken={authTokenSV ?? ''}
                                          fallbackSessionCount={totalSessionCount ?? getStoredSessionIds().length}
                                          fallbackCurrentNode={{
                                            id: session.id,
                                            decision_snippet: session.decision_text.slice(0, 120),
                                            created_at: new Date().toISOString(),
                                            status: 'active',
                                          }}
                                        />
                  </div>
                )
              }

              {/* S1-06: Council complete badge — permanent timestamp after synthesis */}
              {synthesisDone && synthesisCompletedAt && (
                <SessionCompleteBadge
                  decisionTypePrimary={session.decision_type_primary}
                  completedAt={synthesisCompletedAt}
                />
              )}

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
                  onSynthesisComplete={() => {
                    setSynthesisStreaming(false)
                    setSynthesisDone(true)
                    setSynthesisCompletedAt(new Date())  // S1-06: timestamp for badge
                  }}
                  examinerContext={synthExaminerContext}
                  // S2-05: prior session's validation correction carried into this council
                  hasValidationCorrection={!!initialSession.validation_correction_carry}
                  // S3-01: withholds the synthesis fetch while the tension interstitial is showing
                  interstitialGateOpen={interstitialGateOpen}
                  // O3: gates the auto-surfaced Decision-Maker Observation line
                  mirrorActive={mirrorActive}
                  // Bug fix: cached synthesis from a prior visit — skips regenerating
                  // it on remount when already persisted for this session.
                  initialContent={initialSynthesisContent}
                  // P1: What Changed drawer — current lean snapshot (for the
                  // lean-shift weight boost + advisor-moves diff) and persisted
                  // version history (for reload resilience).
                  personaLeans={personaLeans}
                  initialSynthesisVersions={initialSynthesisVersionsForThisSession}
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
                    mirrorActive={mirrorActive}
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

              {/* ── Bias note — client-side, fires independently once bias scoring completes ── */}
              {/* Renders as soon as /api/session/[id]/bias-note resolves after synthesisDone. */}
              {/* All other elements (personas, validation) render in parallel — not blocked.  */}
              {biasNote && (
                <div className="sv-fade sv-fade-2" data-tour-id="council-bias" style={{ marginTop: 16, marginBottom: 8 }}>
                  <BiasNoteCard note={biasNote} />
                </div>
              )}

              {/* ── Validation Card — fires after synthesis (not gated on all personas) ── */}
              {/* Quorum's emotional/archetype read of this decision. Confirming sharpens    */}
              {/* the next session's council. Correcting is even more valuable.              */}
              {synthesisDone && (
                <div className="sv-fade sv-fade-2" data-tour-id="council-validation">
                  <ValidationCard
                    sessionId={session.id}
                    authToken={authTokenSV}
                    userEmail={session.user_email ?? null}
                    totalSessionCount={totalSessionCount}
                  />
                </div>
              )}

              {/* ── Early Echo Card — second-use signal, sessions 2-4 ── */}
              {/* Self-gates internally (count<2 or >=5 renders nothing, dismiss via  */}
              {/* sessionStorage) — no additional session-count logic needed here.    */}
              {/* Fires post-synthesis, same beat as ValidationCard above it.         */}
              {synthesisDone && (
                <div className="sv-fade sv-fade-2">
                  <EarlyEchoCard sessionId={session.id} />
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
              {/* P0 fix: don't remount/re-fetch the Examiner if it was already
                  submitted or skipped for this session (examinerSubmitted seeded
                  from sessions.examiner_status server-side). Without this guard,
                  a reload — e.g. after a network error mid-Council — always
                  re-asked the same questions from scratch. */}
              {!examinerSubmitted && (
                <div className="sv-fade sv-fade-2">
                  <ExaminerPanel
                    key={`examiner-${sessionKey}`}
                    sessionId={session.id}
                    visible={true}
                    onComplete={handleExaminerComplete}
                    forceDismissed={examinerDismissed}
                  />
                </div>
              )}

              {/* ── S2-07: Opening Ceremony — sessions 1–3, gates persona streaming for 3s ── */}
              {ceremonyActive && (
                <OpeningCeremonyCard onDismiss={() => setCeremonyDismissed(true)} />
              )}

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


              {/* ── S3-01: Tension interstitial — gates synthesis for a brief beat ── */}
              {/* Repositioned to sit at the persona grid rather than near the Examiner: */}
              {/* it only ever renders once allPersonasDone is true, so by the time it   */}
              {/* appears the user's attention is on the six cards below, not the        */}
              {/* Examiner section they finished with several beats earlier.             */}
              {interstitialActive && (
                <TensionInterstitial leans={personaLeans} onDismiss={() => setInterstitialDismissed(true)} />
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
                {orderedPersonaKeys.map((key, personaIndex) => (
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
                      onLeanUpdate={handleLeanUpdate}
                      examinerContext={examinerContextByPersona[key]}
                      structuralContext={structuralContext ?? undefined}
                      onShareContext={(text) => handleShareContext(key, text)}
                      anyCardChallenged={anyCardChallenged}
                      onFirstChallengeUsed={handleFirstChallengeUsed}
                      onExaminerUpdateComplete={handleExaminerUpdateComplete}
                      initialContent={sessionKey === 0 ? initialMessages[key] : undefined}
                      // S1-02: Sequential streaming — each persona unlocks only after
                      // the previous one completes. initialContent (DB load) bypasses
                      // the gate so re-reads render instantly without cascading delays.
                      // S2-07: also gated on ceremonyGateOpen — sessions 1–3 hold for the
                      // 3s Opening Ceremony beat before the first advisor begins streaming.
                      //
                      // Bug fix: initialMessages is a static prop from the ORIGINAL
                      // server-rendered session and never updates client-side. Without
                      // the sessionKey===0 guard, reanalyzing a session (which creates a
                      // brand-new session id) would still see the PRIOR session's
                      // persona text here, rendering stale cached content instead of
                      // running the six advisors fresh against the new decision text.
                      canStream={
                        (sessionKey === 0 && !!initialMessages[key]) ||
                        (examinerSubmitted && ceremonyGateOpen && personaIndex <= streamUnlockedUpTo)
                      }
                      initialExaminerContext={examinerInitialContext[key]}
                      // S1-02: fires when this persona reaches 'done', unlocking the next
                      onPersonaComplete={() =>
                        setStreamUnlockedUpTo(prev => Math.max(prev, personaIndex + 1))
                      }
                      // R6: match date/session id are session-wide (which past decision
                      // matched) and passed to every persona unconditionally — harmless
                      // for the 4 non-eligible/uncited cases, since each card's citation
                      // badge only renders when THAT persona's own output actually
                      // contains a <structural> tag. No client-side eligibility list needed.
                      structuralMatchDate={structuralMatchDate}
                      structuralMatchSessionId={structuralMatchSessionId}
                    />
                  </div>
                ))}
              </div>

              {/* ── Capture Position — after personas, giving time to read all six advisors ── */}
              {/* Originally between synthesis and personas; moved here so the user records   */}
              {/* their stance after absorbing the full Council, not just the synthesis.      */}
              {synthesisDone && (
                <div className="sv-fade sv-fade-3" data-tour-id="council-capture" style={{ marginTop: 8 }}>
                  <DecisionStateCard sessionId={session.id} />
                </div>
              )}
            </TTSProvider>


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

            {/* QW-3: 6+ session graph nudge — deliberately the very last thing in
                the flow, after every core session-completion element (synthesis,
                receipt, validation, personas, the action tray itself). Only
                renders when /api/session/[id]/graph-nudge returned show:true —
                see that route + item3-4plus-sessions-pov-plan.md for why this
                is event-gated rather than shown on a fixed cadence. */}
            {(totalSessionCount ?? 0) > 5 && graphNudge?.show && (
              <GraphNudgeLine
                variant={graphNudge.variant}
                edgeType={graphNudge.variant === 'new-connection' ? graphNudge.edgeType : undefined}
                edgeCount={graphNudge.variant === 'milestone' ? graphNudge.edgeCount : undefined}
                milestone={graphNudge.variant === 'milestone' ? graphNudge.milestone : undefined}
                gapText={graphNudge.variant === 'watchlist-suggestion' ? graphNudge.gapText : undefined}
                authToken={authTokenSV}
                mirrorActive={mirrorActive}
              />
            )}

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
                // Fix: drawer had no height cap or scroll — content taller than the viewport
                // (e.g. the S2-08 prior-summary card) was pushed above the visible area with
                // no way to reach it. Caps height and makes the drawer itself scrollable.
                maxHeight: '88vh',
                overflowY: 'auto',
                WebkitOverflowScrolling: 'touch',
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

              {/* S2-08: prior Council summary — reminds the user what was already concluded */}
              {priorSynthesisFull && (
                <div style={{
                  padding:      '11px 14px',
                  borderRadius:  9,
                  border:        '1px solid var(--border-dim)',
                  background:    'var(--bg-inset)',
                  marginBottom:  18,
                }}>
                  <p style={{
                    fontFamily:    'var(--font-mono)',
                    fontSize:      9.5,
                    fontWeight:    700,
                    letterSpacing: '0.11em',
                    textTransform: 'uppercase',
                    color:         'var(--text-4)',
                    margin:        '0 0 6px',
                  }}>
                    What the Council concluded last time
                  </p>
                  <p style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.6, margin: 0, fontStyle: 'italic' }}>
                    {priorSummaryExpanded || priorSynthesisFull.length <= PRIOR_SUMMARY_PREVIEW_CHARS
                      ? priorSynthesisFull
                      : `${priorSynthesisFull.slice(0, PRIOR_SUMMARY_PREVIEW_CHARS).trimEnd()}…`}
                  </p>
                  {priorSynthesisFull.length > PRIOR_SUMMARY_PREVIEW_CHARS && (
                    <button
                      onClick={() => setPriorSummaryExpanded(v => !v)}
                      style={{
                        marginTop:   7,
                        padding:     0,
                        background:  'transparent',
                        border:      'none',
                        color:       'var(--gold)',
                        fontSize:    11.5,
                        fontWeight:  600,
                        cursor:      'pointer',
                        fontFamily:  'inherit',
                      }}
                    >
                      {priorSummaryExpanded ? 'Show less ▴' : 'Show full synthesis ▾'}
                    </button>
                  )}
                </div>
              )}

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
                  { value: 'analytical',    framing: 'challenge' as const, icon: '⚔',  label: 'Challenge my thinking',        sub: 'Stress-test the decision' },
                  { value: 'clarification', framing: 'clarify'  as const,  icon: '🪞', label: 'Help me understand what I want', sub: 'Values and identity' },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { setReRegisterMode(opt.value); setReFramingIntent(opt.framing) }}
                    className={`sv-mode-btn${reRegisterMode === opt.value && reFramingIntent !== 'right' ? ` active-${opt.value}` : ''}`}
                    style={{ minHeight: 44 }}
                  >
                    <p style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: reRegisterMode === opt.value && reFramingIntent !== 'right'
                        ? (opt.value === 'analytical' ? 'var(--gold)' : 'var(--green-text)')
                        : 'var(--text-2)',
                      marginBottom: 3,
                    }}>
                      {opt.icon} {opt.label}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--text-4)', fontStyle: 'italic' }}>{opt.sub}</p>
                  </button>
                ))}
                {/* S1-04: Third framing mode — matches home page option exactly */}
                <button
                  type="button"
                  onClick={() => { setReRegisterMode('analytical'); setReFramingIntent('right') }}
                  className={`sv-mode-btn${reFramingIntent === 'right' ? ' active-right' : ''}`}
                  style={{
                    minHeight:   44,
                    borderColor: reFramingIntent === 'right' ? '#8840c4'               : undefined,
                    background:  reFramingIntent === 'right' ? 'rgba(136,64,196,0.10)' : undefined,
                  }}
                >
                  <p style={{
                    fontSize:     12,
                    fontWeight:   600,
                    color:        reFramingIntent === 'right' ? '#b070e0' : 'var(--text-2)',
                    marginBottom: 3,
                  }}>
                    ⚖ Tell me what&apos;s actually right here
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--text-4)', fontStyle: 'italic' }}>
                    Objective analysis — challenge any assumptions in the framing
                  </p>
                </button>
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
          steps={councilTourSteps}
          active={showCouncilTour}
          onComplete={() => {
            try { localStorage.setItem('quorum_tour.council', 'done') } catch {}
            if (authTokenSV) {
              fetch('/api/onboarding/complete', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authTokenSV}` },
                body:    JSON.stringify({ tour: 'council' }),
              }).catch(() => {})
            }
            setShowCouncilTour(false)
          }}
          onSkip={() => {
            try {
              ;['quorum_tour.council', 'quorum_tour.record']
                .forEach(k => localStorage.setItem(k, 'skip'))
            } catch {}
            if (authTokenSV) {
              fetch('/api/onboarding/complete', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authTokenSV}` },
                body:    JSON.stringify({ tour: 'council' }),
              }).catch(() => {})
            }
            setShowCouncilTour(false)
          }}
        />
      )}
    </>
  )
}