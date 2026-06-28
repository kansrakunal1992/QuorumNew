'use client'

import { useEffect, useRef, useState } from 'react'

// ── Timing constants ───────────────────────────────────────────────────────
const MIN_DISPLAY_MS   = 2500  // minimum time any message stays visible
const INITIAL_DELAY_MS = 700   // silence before the first message appears
const FADE_MS          = 300   // CSS fade-out duration

type Phase =
  | 'silent'      // 0–700ms — nothing rendered
  | 'mapping'     // ontology tagger running
  | 'history'     // ontology ready; checking past decisions
  | 'council'     // personas streaming (N of 6)
  | 'examiner'    // all 6 done, examiner active
  | 'synthesis'   // examiner submitted, synthesis streaming
  | 'done'        // synthesis complete — fade out then unmount

// Determines the desired phase from current props (priority order — highest first)
// New flow: examiner fires BEFORE personas, so council phase comes after examinerDone.
function desiredPhase(
  synthesisDone:     boolean,
  synthesisStreaming: boolean,
  examinerDone:      boolean,
  examinerActive:    boolean,
  personasComplete:  number,
  ontologyReady:     boolean,
): Phase {
  if (synthesisDone)      return 'done'
  if (synthesisStreaming)  return 'synthesis'
  if (examinerDone)        return 'council'   // personas streaming after examiner submitted
  if (personasComplete > 0) return 'council'  // edge-case guard (e.g. pre-loaded sessions)
  if (examinerActive)      return 'examiner'  // examiner loaded, waiting for user answers
  if (ontologyReady)       return 'history'
  return 'mapping'
}

interface Props {
  personasComplete:   number
  totalPersonas:      number
  ontologyReady:      boolean
  examinerActive:     boolean   // allPersonasDone && !examinerReady
  examinerDone:       boolean   // examinerReady === true
  synthesisStreaming: boolean
  synthesisDone:      boolean
}

export default function CouncilStatusBar({
  personasComplete,
  totalPersonas,
  ontologyReady,
  examinerActive,
  examinerDone,
  synthesisStreaming,
  synthesisDone,
}: Props) {
  const [phase,   setPhase]   = useState<Phase>('silent')
  const [visible, setVisible] = useState(false)
  const [mounted, setMounted] = useState(true)

  // Refs for non-stale reads inside timeouts/callbacks
  const phaseRef    = useRef<Phase>('silent')
  const phaseSetAt  = useRef<number>(0)
  const pendingRef  = useRef<Phase | null>(null)
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initialised = useRef(false)

  const setPhaseSync = (p: Phase) => {
    phaseRef.current = p
    setPhase(p)
    phaseSetAt.current = Date.now()
  }

  // ── Apply a phase: fade out → swap message → fade in ────────────────────
  const applyPhase = (next: Phase) => {
    if (next === phaseRef.current) return   // already here — no flicker
    setVisible(false)
    setTimeout(() => {
      setPhaseSync(next)
      if (next !== 'silent' && next !== 'done') setVisible(true)
      if (next === 'done') setTimeout(() => setMounted(false), 800)
    }, FADE_MS)
  }

  // ── Transition respecting MIN_DISPLAY_MS ─────────────────────────────────
  const transitionTo = (next: Phase) => {
    if (next === phaseRef.current) return
    if (timerRef.current) clearTimeout(timerRef.current)
    const elapsed   = Date.now() - phaseSetAt.current
    const remaining = MIN_DISPLAY_MS - elapsed
    if (remaining <= 0) {
      applyPhase(next)
    } else {
      pendingRef.current = next
      timerRef.current = setTimeout(() => {
        if (pendingRef.current) { applyPhase(pendingRef.current); pendingRef.current = null }
      }, remaining)
    }
  }

  // ── Initial delay — fires once on mount ──────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => {
      initialised.current = true
      setPhaseSync('mapping')
      setVisible(true)
    }, INITIAL_DELAY_MS)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Phase progression — any prop change re-evaluates desired phase ────────
  useEffect(() => {
    if (!initialised.current) return       // still in silent window
    if (phaseRef.current === 'done') return
    const target = desiredPhase(
      synthesisDone, synthesisStreaming, examinerDone,
      examinerActive, personasComplete, ontologyReady,
    )
    transitionTo(target)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ontologyReady, personasComplete, examinerActive, examinerDone, synthesisStreaming, synthesisDone])

  // ── Cleanup ──────────────────────────────────────────────────────────────
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  if (!mounted || phase === 'silent') return null

  // ── Build display message ─────────────────────────────────────────────────
  let message = ''
  if (phase === 'mapping')   message = 'Understanding the structure of your decision'
  if (phase === 'history')   message = 'Checking if you\'ve faced a structurally similar decision before'
  if (phase === 'examiner')  message = 'The Examiner has questions for you — the Council will convene once you\'ve answered'
  if (phase === 'council')   message = personasComplete > 0
    ? `${personasComplete} of ${totalPersonas} advisor${personasComplete === 1 ? '' : 's'} ha${personasComplete === 1 ? 's' : 've'} reviewed the brief`
    : 'Convening the Council — advisors are reviewing your decision'
  if (phase === 'synthesis') message = "Writing the Council's conclusion"

  if (!message) return null

  const isSynthesis = phase === 'synthesis'

  return (
    <div
      style={{
        maxWidth:   '80rem',
        margin:     '0 auto 4px',
        padding:    '0 4px',
        opacity:    visible ? 1 : 0,
        transition: `opacity ${FADE_MS}ms ease`,
      }}
    >
      <div
        style={{
          display:     'flex',
          alignItems:  'center',
          gap:         10,
          padding:     '9px 16px',
          borderRadius: 10,
          background:  'var(--bg-inset)',
          border:      '1px solid var(--border-dim)',
        }}
      >
        {/* Pulse dot */}
        <span
          style={{
            flexShrink:   0,
            width:        6,
            height:       6,
            borderRadius: '50%',
            background:   isSynthesis ? 'var(--gold)' : 'var(--text-4)',
            animation:    'blink 1.4s ease-in-out infinite',
          }}
        />

        {/* Phase label pill */}
        <span
          style={{
            flexShrink:    0,
            fontSize:      10,
            fontWeight:    600,
            letterSpacing: '0.09em',
            textTransform: 'uppercase',
            color:         isSynthesis ? 'var(--gold)' : 'var(--text-4)',
            padding:       '2px 7px',
            borderRadius:  5,
            background:    isSynthesis ? 'rgba(201,168,76,0.10)' : 'var(--overlay-bg)',
            border:        '1px solid',
            borderColor:   isSynthesis ? 'var(--gold-dim)' : 'var(--border-dim)',
            whiteSpace:    'nowrap',
          }}
        >
          {phase === 'mapping'   && 'Structuring'}
          {phase === 'history'   && 'Pattern check'}
          {phase === 'council'   && 'Council'}
          {phase === 'examiner'  && 'Examiner'}
          {phase === 'synthesis' && 'Synthesis'}
        </span>

        {/* Message */}
        <span style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.4 }}>
          {message}
        </span>
      </div>
    </div>
  )
}
