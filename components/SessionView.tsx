'use client'

import { useRouter } from 'next/navigation'
import { pushSessionId, getOrCreateDeviceId } from '@/lib/storage'
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

interface Props {
  session: Session
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

export default function SessionView({ session: initialSession }: Props) {
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
  const [completedResponses, setCompletedResponses] = useState<Record<string, string>>({})
  const [decisionExpanded, setDecisionExpanded] = useState(false)
  const [contextExpanded,  setContextExpanded]  = useState(false)

  // Synthesis gate state
  const [examinerReady,            setExaminerReady]            = useState(false)
  const [synthesisVersion,         setSynthesisVersion]         = useState(0)
  const [examinerContextByPersona, setExaminerContextByPersona] = useState<Record<string, string>>({})

  // Sprint 11b: rule engine state
  const [ruleMode,          setRuleMode]          = useState<RuleMode>(null)
  const [redirectBlocked,   setRedirectBlocked]   = useState(false)
  const [redirectQuestion,  setRedirectQuestion]  = useState<string | undefined>(undefined) // Sprint 16b: R1 question for banner
  const [examinerDismissed, setExaminerDismissed] = useState(false)                         // auto-closes ExaminerPanel on override

  // Sprint 5: structural context
  const [structuralContext, setStructuralContext] = useState<string | null>(null)

  // Council status bar state
  const [ontologyReady,      setOntologyReady]      = useState(false)
  const [synthesisStreaming,  setSynthesisStreaming]  = useState(false)
  const [synthesisDone,       setSynthesisDone]       = useState(false)

  // Dynamic grid order — computed from ontology, applied after all 6 personas complete (no animation)
  const [orderedPersonaKeys, setOrderedPersonaKeys] = useState<PersonaKey[]>([...PERSONA_ORDER])
  const [gridReordered,      setGridReordered]      = useState(false)  // shows "Ranked by relevance" label
  const [labelText,          setLabelText]          = useState('')     // typewriter text for relevance label
  const pendingOrderRef      = useRef<PersonaKey[] | null>(null)  // holds computed order until all 6 done
  const allPersonasDoneRef   = useRef(false)
  const examinerSubmittedRef = useRef(false)  // true once user skips or submits examiner
  // Sprint 21: user style cue — fetched once on mount, used to seed persona order baseline
  const styleCueRef          = useRef<string | null>(null)

  // ── FLIP animation refs ──────────────────────────────────────────────────
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const snapRef  = useRef<Record<string, DOMRect>>({})

  // FLIP — Play step: fires after React commits the new DOM order
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
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue   // didn't actually move

      // Invert: jump card back to old visual position (no transition)
      el.style.transition = 'none'
      el.style.transform  = `translate(${dx}px, ${dy}px)`

      // Play: next frame → clear transform with transition → card glides to real position
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.style.transition = `transform ${DURATION}ms ${EASING}`
          el.style.transform  = ''
        })
      })
    }

    // Cleanup transforms after animation finishes
    const cleanup = setTimeout(() => {
      for (const el of Object.values(cardRefs.current)) {
        if (el) { el.style.transition = ''; el.style.transform = '' }
      }
    }, DURATION + 60)

    snapRef.current = {}
    return () => clearTimeout(cleanup)
  }, [orderedPersonaKeys])

  // applyOrderWithFlip — snapshot first, then update state
  const applyOrderWithFlip = useCallback((newOrder: PersonaKey[]) => {
    // FIRST: snapshot current card positions before React re-renders
    const snap: Record<string, DOMRect> = {}
    for (const [key, el] of Object.entries(cardRefs.current)) {
      if (el) snap[key] = el.getBoundingClientRect()
    }
    snapRef.current = snap
    // State update → React re-renders → useLayoutEffect fires (Play step)
    setOrderedPersonaKeys(newOrder)
    setGridReordered(true)
  }, [])

  // Typewriter effect for "Ranked by relevance" label — fires once when gridReordered flips true
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

  // Sprint 21: Fetch style_cue once on mount — populates styleCueRef for computePersonaOrder.
  // Fast DB read; always resolves before ontology is ready (ontology can take up to 24s).
  // Silent on failure — style calibration is non-critical to session flow.
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
        // Non-critical — persona order falls back to rule/dim signals only
      }
    }
    fetchStyleCue()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
          // Store computed order — applied after all 6 personas complete (no animation)
          if (data.ontology_ready && !pendingOrderRef.current) {
            setOntologyReady(true)
            const ordered = computePersonaOrder(
              data.rule_engine_result ?? null,
              data.ontology_vector    ?? null,
              styleCueRef.current,       // Sprint 21: user style baseline
            )
            pendingOrderRef.current = ordered as PersonaKey[]
            // If all personas done AND examiner already submitted, animate immediately
            // (ontology arrived late — slow network). Otherwise wait for examiner submit.
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

      // If this is the 6th persona completing and we already have a pending order, apply it now
      if (!isUpdate && Object.keys(next).length >= PERSONA_ORDER.length) {
        allPersonasDoneRef.current = true
        const pending = pendingOrderRef.current
        if (pending && examinerSubmittedRef.current) {
          // Examiner already submitted — animate now
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
        // If examiner not yet submitted, leave pendingOrderRef in place —
        // handleExaminerComplete will pick it up and animate then
      }
      return next
    })
  }, [])

  const allPersonasDone = Object.keys(completedResponses).length >= PERSONA_ORDER.length

  // Sprint 11b: receives rule_mode from ExaminerPanel
  const handleExaminerComplete = useCallback(
    (
      responses:       Array<{ question_text: string; response_text: string | null; gap: string }>,
      mode:            RuleMode,
      redirectQuestion?: string   // Sprint 16b: R1 question text for SynthesisCard banner
    ) => {
      setRuleMode(mode)

      // REDIRECT — synthesis must never fire; block immediately
      if (mode === 'REDIRECT') {
        setRedirectBlocked(true)
        if (redirectQuestion) setRedirectQuestion(redirectQuestion)
        setExaminerReady(false)   // synthesis gate stays closed
        return                    // skip persona context mapping entirely
      }

      // GATE or OPEN — normal path (includes skip: OPEN with empty responses)
      examinerSubmittedRef.current = true
      setExaminerReady(true)

      // Trigger card shuffle now that user has submitted / skipped the examiner
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

      const seen       = new Set<string>()
      const contextMap: Record<string, string> = {}
      for (const r of responses) {
        if (!r.response_text?.trim()) continue
        const pk = mapGapToPersona(r.gap)
        if (pk && !seen.has(pk) && seen.size < 2) seen.add(pk)
      }
      for (const pk of seen) {
        const ctx = buildExaminerContextForPersona(pk, responses)
        if (ctx) contextMap[pk] = ctx
      }
      if (Object.keys(contextMap).length > 0) {
        setExaminerContextByPersona(contextMap)
      }
    },
    []
  )

  // Sprint 16b Fix 4b: track which personas still have a share-context update in flight
  // When the set empties, all 5 updated responses are in completedResponses — fire synthesis re-run
  const shareContextPendingRef = useRef<Set<string>>(new Set())

  const handleExaminerUpdateComplete = useCallback((personaKey: string) => {
    if (!shareContextPendingRef.current.has(personaKey)) return   // not a share-context update
    shareContextPendingRef.current.delete(personaKey)
    if (shareContextPendingRef.current.size === 0) {
      // All 5 updates done — bump synthesisVersion to re-run Council synthesis
      setSynthesisVersion(v => v + 1)
    }
  }, [])

  // Sprint 16b Fix 4: fan pushback context out to all other personas via examinerContext
  const handleShareContext = useCallback((originPersonaKey: string, text: string) => {
    const examinerMsg = `The user submitted the following new information while challenging another advisor. Review it and update your position if it changes your assessment:\n\n"${text}"\n\nProvide a concise update (under 200 words). If this materially changes your view, say so directly. If it confirms your original analysis, say that — and why.`

    // Mark all non-origin personas as pending — synthesis re-runs when all 5 complete
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
    // Non-blocking log — writes user_overrode_redirect: true into raw_ontology_json
    fetch('/api/ontology', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sessionId: session.id }),
    }).catch(() => {})

    setRedirectBlocked(false)
    setRuleMode(null)
    setExaminerReady(true)   // synthesis gate opens — personas are already done
    setExaminerDismissed(true) // auto-closes ExaminerPanel — no need to click "Understood — dismiss"
    // Sprint 21 fix: mark examiner as submitted so persona reorder can fire.
    // handleExaminerComplete returned early on REDIRECT without setting this ref.
    examinerSubmittedRef.current = true
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
      const res = await fetch('/api/session', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          decision_text: reDecision.trim(),
          context_text:  reContext.trim() || null,
          register_mode: reRegisterMode,
          user_id:       session.user_id   ?? null,  // ← carry auth across reanalyze
          device_id:     getOrCreateDeviceId(),       // ← device fallback, same as home page
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
      setRegisterMode(reRegisterMode)
      setSynthesisVersion(0)
      setSaved(false)
      setDrawerOpen(false)
      setReanalyzing(false)
      // Sprint 11b: reset rule engine state on reanalyze
      setRuleMode(null)
      setRedirectBlocked(false)
      setRedirectQuestion(undefined)
      setExaminerDismissed(false)
      // Reset grid order for fresh ontology signals on new session
      setOrderedPersonaKeys([...PERSONA_ORDER])
      setGridReordered(false)
      setLabelText('')
      allPersonasDoneRef.current = false
      pendingOrderRef.current = null
      examinerSubmittedRef.current = false
      // Reset council status bar
      setOntologyReady(false)
      setSynthesisStreaming(false)
      setSynthesisDone(false)
      window.history.replaceState(null, '', `/session/${id}`)
    } catch {
      setReanalyzeError('Something went wrong. Please try again.')
      setReanalyzing(false)
    }
  }, [reDecision, reContext, reRegisterMode])

  return (
    <div className="min-h-screen px-4 py-8" style={{ background: 'var(--bg-void)' }}>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="flex items-center gap-3 mb-2">
              <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '0.2em', color: 'var(--gold)', textTransform: 'uppercase' }}>
                Quorum
              </span>
              <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, background: 'var(--bg-inset)', color: 'var(--text-4)', border: '1px solid var(--border-dim)' }}>
                Session active
              </span>
            </div>
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', marginBottom: 4, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              The Decision
            </p>
            <p style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--text-2)', maxWidth: 640, ...(decisionExpanded ? {} : { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }) }}>
              {session.decision_text}
            </p>
            {session.decision_text.length > 220 && (
              <button
                onClick={() => setDecisionExpanded(v => !v)}
                style={{ marginTop: 4, fontSize: 11.5, color: 'var(--text-4)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, letterSpacing: '0.02em' }}
              >
                {decisionExpanded ? '↑ See less' : '↓ See more'}
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexShrink: 0, flexWrap: 'wrap' }}>
            <button className="btn-ghost" style={{ fontSize: 13, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 7 }} onClick={handleNewDecision}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              New Decision
            </button>
            <button className="btn-ghost" style={{ fontSize: 13, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 7 }} onClick={() => { setReDecision(session.decision_text); setReContext(session.context_text ?? ''); setDrawerOpen(true) }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/>
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
              </svg>
              Reanalyze
            </button>
            <button className="btn-primary" style={{ fontSize: 13, padding: '10px 18px' }} onClick={handleSaveRecord} disabled={saving}>
              {saving ? 'Saving…' : 'Save to Record'}
            </button>
          </div>
        </div>

        {session.context_text && (
          <div style={{ marginTop: 10, padding: '8px 14px', borderRadius: 8, background: 'var(--bg-inset)', border: '1px solid var(--border-dim)' }}>
            <p style={{ fontSize: 12, color: 'var(--text-4)', margin: 0, ...(contextExpanded ? {} : { display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }) }}>
              <span style={{ color: 'var(--text-3)' }}>Context · </span>{session.context_text}
            </p>
            {session.context_text.length > 120 && (
              <button
                onClick={() => setContextExpanded(v => !v)}
                style={{ marginTop: 3, fontSize: 11, color: 'var(--text-4)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, letterSpacing: '0.02em' }}
              >
                {contextExpanded ? '↑ See less' : '↓ See more'}
              </button>
            )}
          </div>
        )}
        <p style={{ marginTop: 8, fontSize: 11, color: 'var(--text-4)' }}>
          {session.user_id
            ? 'This session is linked to your account and included in your decision memory.'
            : 'Sessions are private by URL. No account or identity is linked to this decision.'
          }
        </p>
      </div>

      <TTSProvider>
      <div className="max-w-7xl mx-auto">

        {/* ── Council Status Bar ── */}
        <CouncilStatusBar
          key={`statusbar-${sessionKey}`}
          personasComplete={Object.keys(completedResponses).length}
          totalPersonas={PERSONA_ORDER.length}
          ontologyReady={ontologyReady}
          examinerActive={allPersonasDone && !examinerReady}
          examinerDone={examinerReady}
          synthesisStreaming={synthesisStreaming}
          synthesisDone={synthesisDone}
        />

        {/* ── 1. Council Synthesis — top, locked until examiner submitted ── */}
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
        />

        {/* ── 2. Examiner — appears once all 6 personas done, glows on entry ── */}
        <ExaminerPanel
          key={`examiner-${sessionKey}`}
          sessionId={session.id}
          visible={allPersonasDone}
          onComplete={handleExaminerComplete}
          forceDismissed={examinerDismissed}
        />

        {/* ── 3. "Ranked by relevance" label — typewriter, above persona cards ── */}
        {gridReordered && !redirectBlocked && (
          <div style={{ display: 'flex', justifyContent: 'center', margin: '14px 0 10px' }}>
            <span className="relevance-label">
              {labelText}
              {/* blinking cursor while typing */}
              {labelText.length < LABEL_FULL.length && (
                <span style={{ opacity: 1, animation: 'blink 0.7s step-end infinite', marginLeft: 1 }}>|</span>
              )}
            </span>
          </div>
        )}

        {/* ── 4. Six persona panels ── */}
        {/* Sprint 11b: dim at 55% opacity on REDIRECT — still stream, visually provisional */}
        <div
          className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
          style={{
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
              />
            </div>
          ))}
        </div>
        </div>
      </TTSProvider>

      {/* ── Bottom bar ── */}
      <div style={{ maxWidth: '80rem', margin: '28px auto 0', display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button className="btn-ghost" style={{ fontSize: 13, padding: '11px 20px', display: 'flex', alignItems: 'center', gap: 7 }} onClick={handleNewDecision}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New Decision
        </button>
        <button className="btn-ghost" style={{ fontSize: 13, padding: '11px 20px', display: 'flex', alignItems: 'center', gap: 7 }} onClick={() => { setReDecision(session.decision_text); setReContext(session.context_text ?? ''); setDrawerOpen(true) }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/>
            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
          </svg>
          Reanalyze
        </button>
        <button className="btn-primary" style={{ fontSize: 13, padding: '11px 28px' }} onClick={handleSaveRecord} disabled={saving}>
          {saving ? 'Saving…' : 'Save to Record'}
        </button>
      </div>

      {/* ── Reanalyze drawer ── */}
      {drawerOpen && (
        <>
          <div onClick={() => setDrawerOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(2,4,10,0.78)', zIndex: 40 }} />
          <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50, background: 'var(--bg-card)', border: '1px solid var(--border-mid)', borderBottom: 'none', borderRadius: '18px 18px 0 0', padding: '28px 28px 40px', maxWidth: 760, margin: '0 auto' }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border-mid)', margin: '0 auto 22px' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-1)', margin: 0 }}>Reanalyze</h2>
                <p style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 3 }}>Edit your decision or add context — all six advisors re-run</p>
              </div>
              <button className="btn-ghost" style={{ padding: '5px 12px', fontSize: 12 }} onClick={() => setDrawerOpen(false)}>✕ Close</button>
            </div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 6, fontWeight: 500 }}>Decision</label>
            <textarea rows={5} value={reDecision} onChange={(e) => setReDecision(e.target.value)} style={{ fontSize: 13.5, marginBottom: 14 }} placeholder="Describe your decision…" />
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 6, fontWeight: 500 }}>
              Additional context <span style={{ color: 'var(--text-4)', fontWeight: 400 }}>(optional)</span>
            </label>
            <textarea rows={3} value={reContext} onChange={(e) => setReContext(e.target.value)} style={{ fontSize: 13, marginBottom: 18 }} placeholder="Add new information that has emerged…" />
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 8, fontWeight: 500 }}>
              What are you looking for this time?
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
              {([
                { value: 'analytical',   icon: '⚔',  label: 'Challenge my thinking',        sub: 'Stress-test the decision' },
                { value: 'clarification', icon: '🪞', label: 'Help me understand what I want', sub: 'Values and identity' },
              ] as const).map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setReRegisterMode(opt.value)}
                  style={{
                    padding: '10px 12px', borderRadius: 9, textAlign: 'left',
                    cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                    border: `1px solid ${reRegisterMode === opt.value ? (opt.value === 'analytical' ? 'var(--gold)' : '#4ade80') : 'var(--border-dim)'}`,
                    background: reRegisterMode === opt.value ? (opt.value === 'analytical' ? 'rgba(201,168,76,0.1)' : 'rgba(74,222,128,0.08)') : 'transparent',
                  }}
                >
                  <p style={{ fontSize: 12, fontWeight: 600, color: reRegisterMode === opt.value ? (opt.value === 'analytical' ? 'var(--gold)' : '#4ade80') : 'var(--text-2)', marginBottom: 2 }}>
                    {opt.icon} {opt.label}
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--text-4)' }}>{opt.sub}</p>
                </button>
              ))}
            </div>
            {reanalyzeError && <p style={{ fontSize: 12, color: '#e05050', marginBottom: 12 }}>{reanalyzeError}</p>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-primary" style={{ flex: 1, fontSize: 14, padding: '13px' }} onClick={handleReanalyze} disabled={reanalyzing || !reDecision.trim()}>
                {reanalyzing ? 'Convening new Council…' : 'Convene New Council'}
              </button>
              <button className="btn-ghost" style={{ padding: '13px 20px', fontSize: 13 }} onClick={() => setDrawerOpen(false)}>Cancel</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
