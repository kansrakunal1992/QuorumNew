'use client'

// components/ChatIntake.tsx
// ── Natural Intake (v1) — the chat screen ─────────────────────────────────────
//
// Design rules locked in docs/COPY_AND_STRUCTURE_LOCK_v1.md:
//   - No setup screen: cursor active in the input the instant this mounts.
//   - One decision on screen at a time — a single input, a single send action.
//   - No internal jargon ever reaches this component's copy.
//   - Progress is a quiet, non-numeric dot trail — never "3 of 6".
//   - Replies arrive as a brief typewriter reveal, not a spinner-then-block —
//     true token streaming is a fast-follow (see docs/CHANGELOG_v1.md); this
//     is the visual approximation for v1.
//
// A brand-new file — HomeClient.tsx and SessionView.tsx are not touched.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import type { CSSProperties } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
const PushEnablePrompt = dynamic(() => import('@/components/PushEnablePrompt'), { ssr: false })   // Phase 2: was only mounted in HomeClient
import DecisionStarters from '@/components/DecisionStarters'
import FAQModal from '@/components/FAQModal'
import BehaviorAlerts from '@/components/BehaviorAlerts'           // item 6 plan, Phase 1
import AuthPanel from '@/components/AuthPanel'                     // item 6 plan, Phase 3
import MeetTheCouncil from '@/components/MeetTheCouncil'           // item 6 plan, Phase 4
import MemoryEngineStatus from '@/components/MemoryEngineStatus'   // item 6 plan, Phase 2
import MirrorOpenLoopCard from '@/components/MirrorOpenLoopCard'   // item 6 plan, Phase 2
import PatternSurfaceCard from '@/components/PatternSurfaceCard'   // item 6 plan, Phase 2
import CalibrationRevealCard from '@/components/CalibrationRevealCard' // item 6 plan, Phase 2
import RecurringConditionCard from '@/components/RecurringConditionCard' // item 6 plan, Phase 2
import HeroCardCollapsible from '@/components/HeroCardCollapsible' // item 6 plan, round 2
import JudgmentRecordStrip from '@/components/JudgmentRecordStrip'
import type { JudgmentRecordSession } from '@/components/JudgmentRecordStrip'
import type { DimPattern } from '@/components/RecurringConditionCard'
import { heroCardSummary } from '@/lib/hero-cards'
import type { HeroCardId } from '@/lib/hero-cards'
import type { MirrorStatus, ChatDecisionState, ChatQuickReplies } from '@/lib/types'
import DecisionBriefPanel from '@/components/DecisionBriefPanel'   // v7: live "what I've got so far"
import {
  ENOUGH_LABEL, WALKTHROUGH_LABEL, WALKTHROUGH_LINE,
  UNKNOWN_CHIP_LABEL, UNKNOWN_REPLY_TEXT, PLAYBACK_YES,
} from '@/lib/chat-intake-brief'
import { isUnifiedSessionEnabled, isWatchlistEnabled } from '@/lib/feature-flags'
import WatchlistSection from '@/components/WatchlistSection'   // Phase 1: parked items need a visible home
import ConnectCard from '@/components/ConnectCard'                 // Phase 3: optional connect-before-next-decision gate
import AddToHomeScreenPrompt from '@/components/AddToHomeScreenPrompt'   // Phase 3
import { getGateMode, resolveArm, isGated } from '@/lib/auth-gate'        // Phase 3
import { getStoredSessionIds } from '@/lib/storage'                       // Phase 3
import { getAuthHeaders } from '@/lib/auth-headers'   // Phase 0: send the token so chat_intakes/sessions get user_id
import { track } from '@/lib/track'                     // Phase 0: first-party events
import { takeDecisionPrefill } from '@/lib/prefill'    // Phase 1: "Bring it now" hand-off
import { buildLeanChoices, matchSavedLean, PRIORITIES } from '@/lib/chat-intake-lean'
import type { LeanChoice } from '@/lib/chat-intake-lean'
const VoiceInput = dynamic(() => import('@/components/VoiceInput'), { ssr: false })

interface ChatBubble {
  role:    'user' | 'quorum'
  content: string
}

interface ChatIntakeProps {
  chatIntakeId:          string | null
  deviceId:              string
  grantExtraExchanges:   boolean
  onChatIntakeId:        (id: string) => void
  onReadyToReflect:      (chatIntakeId: string) => void

  // Item 6 plan, Phase 0 — fetched once by NaturalIntakeClient and shared
  // between the top bar's Mirror label and the hero's status-card stack,
  // instead of this component fetching /api/mirror/status a second time.
  authToken:             string | null
  userEmail:             string | null
  onUserEmailChange:     (email: string) => void
  mirrorStatus:          MirrorStatus | null
  patternDimensions:     DimPattern[]
  pendingOutcomesCount:  number
  decidedCount:          number
  heroCards:             HeroCardId[]
  historySessions:       JudgmentRecordSession[]
}

function TypewriterLine({ text }: { text: string }) {
  const [shown, setShown] = useState('')
  useEffect(() => {
    setShown('')
    let i = 0
    const id = setInterval(() => {
      i += 2
      setShown(text.slice(0, i))
      if (i >= text.length) clearInterval(id)
    }, 14)
    return () => clearInterval(id)
  }, [text])
  return <>{shown}</>
}

export default function ChatIntake({
  chatIntakeId,
  deviceId,
  grantExtraExchanges,
  onChatIntakeId,
  onReadyToReflect,
  authToken,
  userEmail,
  onUserEmailChange,
  mirrorStatus,
  patternDimensions,
  pendingOutcomesCount,
  decidedCount,
  heroCards,
  historySessions,
}: ChatIntakeProps) {
  const [bubbles, setBubbles]   = useState<ChatBubble[]>([])
  const [input, setInput]       = useState('')
  const [sending, setSending]   = useState(false)
  // v4 — the chat no longer hands off on a timer. When the server says the
  // conversation is complete, `closing` holds what the end-of-chat panel
  // needs (the id to hand off, and the state the lean chips are built from);
  // the input stays locked while it's set. The panel's Continue button is the
  // transition — nothing waits on a clock.
  const [closing, setClosing] = useState<{ chatIntakeId: string; state: ChatDecisionState } | null>(null)
  const transitioning = !!closing
  const [leanPick, setLeanPick]         = useState<LeanChoice | null>(null)
  const [priorityPick, setPriorityPick] = useState<string | null>(null)
  const [savingLean, setSavingLean]     = useState(false)
  const [leanError, setLeanError]       = useState<string | null>(null)
  const unified = isUnifiedSessionEnabled()
  const leanChoices = useMemo(() => (closing ? buildLeanChoices(closing.state.options) : []), [closing])
  const [exchangeCount, setExchangeCount] = useState(0)
  // v7 — adaptive brief. `quick` is the tap-answers under Quorum's latest message
  // (typing is always still available); `briefState` feeds the live brief panel;
  // `walkthrough` is the optional "Walk me through it" start for people who don't
  // know what to say. quickRef lets a failed send put the chips back.
  const [quick, setQuick]             = useState<ChatQuickReplies | null>(null)
  const [briefState, setBriefState]   = useState<ChatDecisionState | null>(null)
  const [walkthrough, setWalkthrough] = useState(false)
  const quickRef = useRef<ChatQuickReplies | null>(null)
  const [faqOpen, setFaqOpen]   = useState(false)
  const [examplesOpen, setExamplesOpen] = useState(false)   // landing: starter chips live behind "See examples"
  const inputRef  = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const router    = useRouter() // only used by MemoryEngineStatus's onScrollToHistory below

  // Top-bar identity affordance — doesn't gate anything here, just answers
  // "where do my past decisions live now?" for a returning, signed-in
  // visitor, the same way the classic home page's plan/status badge used to
  // (PlanBadge.tsx deliberately skips path "/" and leaves that job to
  // whichever screen renders there — HomeClient normally, ChatIntake when
  // Natural Intake is on, so this is that screen's own version of it).
  // userEmail/mirrorStatus arrive as props now (item 6 plan, Phase 0) —
  // NaturalIntakeClient fetches both once on mount and shares them with the
  // hero's status-card stack below, rather than this component making its
  // own separate /api/mirror/status call the way it used to.
  const hasEmail       = !!userEmail
  const mirrorUnlocked = mirrorStatus?.gateState === 'unlocked'
  // Phase 0 fix: an anonymous visitor's mirrorStatus is null (or gateState
  // 'auth' with sessionCount 0), so this used to read 0 even with decisions on
  // the device -- the Memory Engine card then said "0 sessions" while hero-card
  // eligibility (computed in NaturalIntakeClient from history) said otherwise.
  // Fall back to the locally-known history count.
  const sessionCount   = mirrorStatus && mirrorStatus.gateState !== 'auth'
    ? mirrorStatus.sessionCount
    : historySessions.length

  // True once the user has sent at least one message — switches the screen
  // from the branded "front door" hero (headline + example chips) into the
  // scrolling conversation thread. Same underlying bubbles array either way.
  const started = bubbles.some(b => b.role === 'user')

  // -- Phase 3: optional "connect before the next decision" gate -------------
  // OFF unless NEXT_PUBLIC_AUTH_GATE_MODE is set (lib/auth-gate.ts). Never
  // applies mid-chat, to signed-in people, or to people with no device id (no
  // cookie consent -- we do not assign experiment arms without it). The server
  // (POST /api/chat-intake) enforces the same rule, so this is a UX layer, not
  // the only check; serverGated covers a device that slipped past the client.
  const [serverGated, setServerGated]       = useState(false)
  const [localDecisionCount, setLocalCount] = useState(0)
  const gateMode = getGateMode()
  const gateArm  = gateMode === 'off' || !deviceId ? null : resolveArm(gateMode, deviceId)
  useEffect(() => {
    try { setLocalCount(Math.max(historySessions.length, getStoredSessionIds().length)) } catch {}
  }, [historySessions.length])
  const gated = !started && !authToken && !userEmail && (serverGated || isGated(localDecisionCount, gateArm))
  useEffect(() => {
    if (!gateArm) return
    try {
      if (localStorage.getItem('quorum_gate_arm_reported') === gateArm) return
      localStorage.setItem('quorum_gate_arm_reported', gateArm)
    } catch { return }
    track('gate_arm_assigned', { arm: gateArm, mode: gateMode })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateArm])

  function handleStarterPick(text: string) {
    setInput(text)
    inputRef.current?.focus()
  }
  // Only the landing-page example chips are measured; WatchlistSection also
  // calls handleStarterPick (graduating a watched item) and must not count.
  function handleExamplePick(text: string) {
    track('starter_picked')
    handleStarterPick(text)
  }
  function toggleExamples() {
    if (!examplesOpen) track('starter_opened')
    setExamplesOpen(o => !o)
  }

  // Phase 1: text handed over from a post-decision screen ("Bring it now").
  // Only for a brand-new chat; a resumed chat already has its own thread.
  useEffect(() => {
    if (chatIntakeId) return
    const pending = takeDecisionPrefill()
    // Phase 3: /q (and the weekly email's CTA) lands here as /?q=1 -- focus the
    // input, then tidy the URL so a refresh does not re-trigger it.
    let focusRequested = false
    try {
      const params = new URLSearchParams(window.location.search)
      if (params.get('q') === '1') {
        focusRequested = true
        params.delete('q')
        const qs = params.toString()
        window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''))
      }
    } catch {}
    if (pending) setInput(pending)
    if (pending || focusRequested) setTimeout(() => inputRef.current?.focus(), 60)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Load the conversation this screen should show ──────────────────────────
  // Two cases share one effect, both mount-only (chatIntakeId is read at the
  // time this component mounts, not watched afterward — see the eslint
  // suppression below):
  //   - Brand-new chat (chatIntakeId null): no DB row exists yet, so just
  //     grab the fixed opening line — no round trip needed.
  //   - Resuming (chatIntakeId already set): this happens when "Let me add
  //     more first" sends the person back from DecisionCheckpoint —
  //     NaturalIntakeClient unmounts this component while on the checkpoint
  //     screen and remounts a fresh instance when it flips back to 'chat',
  //     so local state (bubbles, exchangeCount) starts empty even though
  //     the chat_intake row and its full history are untouched server-side.
  //     Re-fetch that transcript here so the conversation reappears instead
  //     of the screen looking like it started over.
  useEffect(() => {
    if (!chatIntakeId) {
      fetch('/api/chat-intake')
        .then(r => r.json())
        .then(d => setBubbles([{ role: 'quorum', content: d.openingLine }]))
        .catch(() => setBubbles([{ role: 'quorum', content: "What's going on?" }]))
        .finally(() => inputRef.current?.focus())
      return
    }

    let cancelled = false
    fetch(`/api/chat-intake?chatIntakeId=${chatIntakeId}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        const msgs = (d.messages ?? []) as { role: 'user' | 'quorum'; content: string }[]
        if (msgs.length) {
          setBubbles(msgs.map(m => ({ role: m.role, content: m.content })))
        }
        if (typeof d.intake?.exchange_count === 'number') {
          setExchangeCount(d.intake.exchange_count)
        }
        // v7: bring back the brief and whatever Quorum was waiting on.
        const st = (d.intake?.decision_state ?? null) as ChatDecisionState | null
        if (st) {
          setBriefState(st)
          const p = st.pending
          if (p && st.phase !== 'done') {
            if (p.kind === 'playback')                          setQuick({ kind: 'playback', chips: p.chips })
            else if (p.kind === 'ask' || p.kind === 'smart_friend') setQuick({ kind: 'ask', slotKey: p.slotKey ?? null, chips: p.chips })
          }
        }
      })
      .catch(() => { /* worst case: hero shows briefly, chat still works from here */ })
      .finally(() => { if (!cancelled) inputRef.current?.focus() })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [bubbles, sending, closing])

  const send = useCallback(async (
    text: string,
    meta?: { kind: 'chip' | 'unknown' | 'playback_yes' | 'playback_no'; slotKey?: string | null },
    opts?: { enough?: boolean },
  ) => {
    const trimmed = text.trim()
    const enough  = !!opts?.enough
    if ((!trimmed && !enough) || sending || transitioning) return

    if (!enough) {
      setBubbles(prev => [...prev, { role: 'user', content: trimmed }])
      setInput('')
    }
    quickRef.current = quick
    setQuick(null)
    setSending(true)

    try {
      const res = await fetch('/api/chat-intake', {
        method:  'POST',
        // Phase 0 fix: previously no Authorization header here, so chat_intakes
        // (and, via the checkpoint, sessions) were created with user_id = null
        // even for signed-in people.
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({
          chatIntakeId,
          message:        enough ? undefined : trimmed,
          deviceId,
          extraExchanges: grantExtraExchanges,
          quickReply:     meta,
          action:         enough ? 'enough' : undefined,
          // Only meaningful on the very first message of a brand-new chat.
          walkthrough:    !chatIntakeId && walkthrough ? true : undefined,
        }),
      })
      const data = await res.json()
      // Phase 3: the server says this device needs a linked email before a
      // new decision. Roll the optimistic bubble back and show the gate; the
      // typed text is put back so nothing is lost.
      if (res.status === 403 && data?.error === 'auth_required') {
        if (!enough) { setBubbles(prev => prev.slice(0, -1)); setInput(trimmed) }
        setServerGated(true)
        if (typeof data.decisionCount === 'number') setLocalCount(c => Math.max(c, data.decisionCount))
        return
      }
      if (!res.ok) throw new Error(data?.error || 'Chat failed')

      if (!chatIntakeId) {
        onChatIntakeId(data.chatIntakeId)
        // Phase 4: if this visit began from one of our emails (?n= was captured by
        // NotificationLandingTracker), the decision is attributable to it.
        let fromNotification: string | null = null
        try {
          fromNotification = sessionStorage.getItem('quorum_from_notification')
          if (fromNotification && !sessionStorage.getItem('quorum_notif_converted')) {
            sessionStorage.setItem('quorum_notif_converted', '1')
            track('notification_to_decision', { source: fromNotification })
          }
        } catch {}
        track('decision_started', { entry: 'chat', from_notification: fromNotification })
      }
      setExchangeCount(data.exchangeCount)
      setBubbles(prev => [...prev, { role: 'quorum', content: data.quorumReply }])
      setBriefState((data.state ?? null) as ChatDecisionState | null)
      const qr = data.quickReplies as ChatQuickReplies | undefined
      setQuick(!data.readyToReflect && qr && qr.kind !== 'none' ? qr : null)

      if (data.readyToReflect) {
        // v4: no timer. The closing line stays on screen with the lean /
        // priority panel directly beneath it (or just a Continue button when
        // the unified session flag is off, since the chips only exist for it).
        // Preselects any earlier tap, so someone who came back via "Let me
        // add more first" doesn't have to pick everything again.
        const st      = (data.state ?? {}) as ChatDecisionState
        const choices = buildLeanChoices(st.options)
        setLeanPick(matchSavedLean(choices, st.chosenLean, st.chosenLeanLabel))
        setPriorityPick(st.optimizationPriority ?? null)
        setLeanError(null)
        setClosing({ chatIntakeId: data.chatIntakeId ?? chatIntakeId!, state: st })
      }
    } catch (err) {
      console.error('[ChatIntake] send failed:', err)
      setQuick(quickRef.current)   // put the tap-answers back so nothing is lost
      setBubbles(prev => [...prev, { role: 'quorum', content: "Sorry — something slipped. Try that again?" }])
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }, [chatIntakeId, deviceId, grantExtraExchanges, sending, transitioning, onChatIntakeId, quick, walkthrough])

  // v7 — tap-answers. A chip is a complete answer; "Not sure" is data, not a failure.
  function tapChip(label: string) {
    if (!quick) return
    if (quick.kind === 'playback') {
      send(label, { kind: label === PLAYBACK_YES ? 'playback_yes' : 'playback_no' })
    } else {
      send(label, { kind: 'chip', slotKey: quick.slotKey ?? null })
    }
  }
  function tapNotSure() {
    send(UNKNOWN_REPLY_TEXT, { kind: 'unknown', slotKey: quick?.slotKey ?? null })
  }
  function tapEnough() {
    send('', undefined, { enough: true })
  }
  function editBriefRow(label: string) {
    setInput(`About ${label.toLowerCase()}: `)
    inputRef.current?.focus()
  }

  const canContinue = unified ? (!!leanPick && !!priorityPick && !savingLean) : !savingLean

  async function handleContinue() {
    if (!closing || !canContinue) return
    if (!unified) { onReadyToReflect(closing.chatIntakeId); return }
    if (!leanPick || !priorityPick) return

    setSavingLean(true)
    setLeanError(null)
    try {
      const res = await fetch('/api/chat-intake/lean', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatIntakeId:         closing.chatIntakeId,
          initialInstinct:      leanPick.value,
          optimizationPriority: priorityPick,
          label:                leanPick.isUnsure ? null : leanPick.fullLabel,
        }),
      })
      if (!res.ok) throw new Error('lean save failed')
      onReadyToReflect(closing.chatIntakeId)   // parent swaps this screen out
    } catch (err) {
      console.error('[ChatIntake] lean save failed:', err)
      setLeanError("That didn't save — tap Continue to try again.")
      setSavingLean(false)
    }
  }

  function handleAddMore() {
    setClosing(null)
    setLeanError(null)
    inputRef.current?.focus()
  }

  const chipStyle = (selected: boolean): CSSProperties => ({
    padding: '9px 14px', borderRadius: 999, fontSize: 14.5, lineHeight: 1.3,
    border: selected ? '1px solid var(--gold)' : '1px solid var(--border-mid)',
    background: selected ? 'var(--gold-dim)' : 'transparent',
    color: selected ? 'var(--text-1)' : 'var(--text-2)',
    cursor: 'pointer', textAlign: 'left',
  })

  // Item 6 plan, round 2 — extracted so the exact same input row can render
  // in two different places depending on `started`: inline in the hero
  // (right after the starter chips, so it's visible without scrolling
  // past anything) before the first message, and pinned to the screen
  // bottom once the thread view takes over. Same handlers/refs either way;
  // only its position in the tree changes, and the two spots are mutually
  // exclusive (started flips exactly once per visit), so there's no risk
  // of it ever rendering twice at once.
  const inputForm = (
    <form
      onSubmit={e => { e.preventDefault(); send(input) }}
      style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        padding: started ? '10px 16px calc(52px + env(safe-area-inset-bottom, 0px))' : '0',
        borderTop: started ? '1px solid var(--border-dim)' : 'none',
      }}
    >
      <div style={{ position: 'relative' }}>
      <textarea
        ref={inputRef}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
        }}
        placeholder={
          transitioning ? 'Tap your answers above…'
          : started ? (quick?.chips.length ? 'Or type your own answer…' : 'Type here…')
          : walkthrough ? 'In a sentence — what\'s the decision?'
          : 'Tell me what you\'re trying to decide… a rough version is fine'
        }
        rows={started ? 1 : 3}
        disabled={transitioning}
        style={{
          width: '100%', resize: 'none', maxHeight: 120,
          padding: started ? '11px 14px' : '11px 62px 11px 14px',
          borderRadius: 14, border: '1px solid var(--border-mid)',
          background: 'var(--bg-inset)', color: 'var(--text-1)',
          fontSize: 16, fontFamily: 'var(--font-body)',
          opacity: transitioning ? 0.6 : 1,
        }}
      />
      {/* Landing: the mic sits inside the box's corner (frees the button row so
          the CTA can be full width). In the thread it stays beside the button. */}
      {!started && (
        <div style={{ position: 'absolute', right: 8, bottom: 8 }}>
          <VoiceInput compact onTranscript={(t: string) => setInput(prev => (prev ? `${prev} ${t}` : t))} />
        </div>
      )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        {started && <VoiceInput compact onTranscript={(t: string) => setInput(prev => (prev ? `${prev} ${t}` : t))} />}
        <button
          type="submit"
          disabled={sending || transitioning || !input.trim()}
          style={{
            flex: 1, maxWidth: started ? 140 : 'none', whiteSpace: 'nowrap', padding: '11px 18px', borderRadius: 14, border: 'none',
            background: input.trim() && !transitioning ? 'var(--gold)' : 'var(--border-dim)',
            color: input.trim() && !transitioning ? 'var(--bg-void)' : 'var(--text-4)',
            fontWeight: 600, fontSize: 15, cursor: input.trim() && !transitioning ? 'pointer' : 'default',
          }}
        >
          {started ? 'Send' : 'Help me decide →'}
        </button>
      </div>
      {/* Item 6 plan, Phase 1 — the classic home page's live bias detector
          (app/HomeClient.tsx) had no equivalent here at all. Same
          component, same two props, wired to this screen's own input
          state instead of HomeClient's `decision` state. */}
      <BehaviorAlerts decision={input} authToken={authToken} />
    </form>
  )

  // Shared inputs for every collapsed hero card's one-line summary — see
  // lib/hero-cards.ts's heroCardSummary.
  const heroSummaryInput = {
    sessionCount,
    mirrorUnlocked,
    patternDimensionsCount: patternDimensions.length,
  }

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        maxWidth: 640,
        margin: '0 auto',
        width: '100%',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {/* ── Front door — restrained brand bar, not a marketing header ────
          Left group (wordmark + FAQ + Mirror) is deliberately clear of the
          top-right corner: ThemeToggle (globals.css .theme-toggle) is fixed
          at top:18/right:20 across the whole app, so nothing here competes
          with it for that space. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '16px 20px 0',
      }}>
        <span style={{
          fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 500,
          letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--gold)',
        }}>
          Quorum
        </span>
        <span style={{ width: 1, height: 14, background: 'var(--border-dim)' }} />
        <button
          onClick={() => setFaqOpen(true)}
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '0.05em',
            color: 'var(--text-3)', background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          }}
        >
          FAQ
        </button>
        <span style={{ width: 1, height: 14, background: 'var(--border-dim)' }} />
        <Link href="/mirror" style={{
          fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '0.05em',
          color: 'var(--text-3)', textDecoration: 'none',
        }}>
          {mirrorStatus && mirrorStatus.gateState !== 'auth' && mirrorStatus.sessionCount > 0
            ? `${mirrorStatus.sessionCount} decision${mirrorStatus.sessionCount === 1 ? '' : 's'}`
            : hasEmail ? 'Mirror'
            // Phase 0: an anonymous visitor with decisions on this device
            // used to see a bare "Sign in" -- say what signing in keeps.
            : historySessions.length > 0 ? 'Keep my record' : 'Sign in'}
        </Link>
      </div>

      {faqOpen && <FAQModal onClose={() => setFaqOpen(false)} />}

      {/* Quiet, non-numeric progress — a dot trail, never "3 of 6". Only
          appears once the conversation is actually under way. */}
      {started && (
        <div style={{ display: 'flex', gap: 5, justifyContent: 'center', padding: '14px 0 4px' }}>
          {Array.from({ length: Math.min(exchangeCount + 1, 9) }).map((_, i) => (
            <div
              key={i}
              style={{
                width: 5, height: 5, borderRadius: 999,
                background: i <= exchangeCount ? 'var(--gold)' : 'var(--border-dim)',
                transition: 'background 0.4s ease',
              }}
            />
          ))}
        </div>
      )}

      {/* v7 — the decision brief, filling in as we talk. Collapsed by default. */}
      {started && <DecisionBriefPanel state={briefState} onEditRow={editBriefRow} />}

      {started ? (
        <div
          ref={scrollRef}
          style={{ flex: 1, overflowY: 'auto', padding: '12px 20px 8px', display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          {bubbles.map((b, i) => (
            <div
              key={i}
              style={{
                alignSelf:  b.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth:   '82%',
                padding:    '11px 15px',
                borderRadius: 16,
                fontSize:   15.5,
                lineHeight: 1.5,
                background: b.role === 'user' ? 'var(--gold-dim)' : 'var(--bg-card)',
                color:      'var(--text-1)',
                border:     b.role === 'quorum' ? '1px solid var(--border-dim)' : 'none',
              }}
            >
              {b.role === 'quorum' && i === bubbles.length - 1 && !sending
                ? <TypewriterLine text={b.content} />
                : b.content}
            </div>
          ))}
          {sending && (
            <div style={{ alignSelf: 'flex-start', display: 'flex', gap: 4, padding: '11px 15px' }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 6, height: 6, borderRadius: 999, background: 'var(--text-4)',
                  animation: `chatDotPulse 1.1s ${i * 0.15}s infinite ease-in-out`,
                }} />
              ))}
            </div>
          )}

          {/* v7 — tap-answers under Quorum's latest message. Each chip is a complete
              answer; typing stays available; "Not sure" is recorded as an unknown (and
              turned into a to-do) rather than re-asked. */}
          {quick && quick.chips.length > 0 && !sending && !closing && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignSelf: 'flex-start', maxWidth: '92%' }}>
              {quick.chips.map(c => (
                <button key={c} type="button" onClick={() => tapChip(c)} style={chipStyle(false)}>{c}</button>
              ))}
              {quick.kind === 'ask' && (
                <button type="button" onClick={tapNotSure} style={{ ...chipStyle(false), color: 'var(--text-3)', borderStyle: 'dashed' }}>
                  {UNKNOWN_CHIP_LABEL}
                </button>
              )}
            </div>
          )}
          {/* "Not sure" is also offered on questions that have no tap-answers of their own. */}
          {quick && quick.kind === 'ask' && quick.chips.length === 0 && !sending && !closing && (
            <button type="button" onClick={tapNotSure} style={{ ...chipStyle(false), alignSelf: 'flex-start', color: 'var(--text-3)', borderStyle: 'dashed' }}>
              {UNKNOWN_CHIP_LABEL}
            </button>
          )}
          {/* Always-available exit for people who've said what they have to say. */}
          {exchangeCount >= 1 && !sending && !closing && quick?.kind !== 'playback' && (
            <button
              type="button"
              onClick={tapEnough}
              style={{
                alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0,
                fontSize: 13, color: 'var(--text-4)', cursor: 'pointer', textDecoration: 'underline',
              }}
            >
              {ENOUGH_LABEL}
            </button>
          )}

          {/* v4 — end-of-chat panel: the lean + priority taps that used to be
              a separate screen after the checkpoint. Tap-only (no typing),
              both required before Continue, saved before the person ever sees
              Quorum's prediction (bias protection). */}
          {closing && (
            <div style={{
              alignSelf: 'stretch', background: 'var(--bg-card)',
              border: '1px solid var(--border-dim)', borderRadius: 16,
              padding: 16, display: 'flex', flexDirection: 'column', gap: 16,
            }}>
              {unified && (
                <>
                  <div>
                    <p style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--text-1)', margin: '0 0 10px' }}>
                      Where are you leaning?
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {leanChoices.map((c, i) => (
                        <button
                          key={`${i}-${c.fullLabel}`}
                          type="button"
                          title={c.fullLabel}
                          onClick={() => setLeanPick(c)}
                          style={chipStyle(leanPick?.fullLabel === c.fullLabel)}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--text-1)', margin: '0 0 10px' }}>
                      What matters most here?
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {PRIORITIES.map(p => (
                        <button
                          key={p.value}
                          type="button"
                          onClick={() => setPriorityPick(p.value)}
                          style={chipStyle(priorityPick === p.value)}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
              {leanError && (
                <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>{leanError}</p>
              )}
              <button
                type="button"
                disabled={!canContinue}
                onClick={handleContinue}
                style={{
                  padding: '13px 20px', borderRadius: 14, border: 'none', width: '100%',
                  background: canContinue ? 'var(--gold)' : 'var(--border-dim)',
                  color: canContinue ? 'var(--bg-void)' : 'var(--text-4)',
                  fontWeight: 600, fontSize: 15.5, cursor: canContinue ? 'pointer' : 'default',
                }}
              >
                {savingLean ? 'One moment…' : 'Continue'}
              </button>
              <button
                type="button"
                onClick={handleAddMore}
                style={{
                  background: 'none', border: 'none', padding: 0, margin: '-4px auto 0',
                  fontSize: 13, color: 'var(--text-4)', cursor: 'pointer', textDecoration: 'underline',
                }}
              >
                Add one more thing first
              </button>
            </div>
          )}
        </div>
      ) : (
        /* ── Hero — "Quorum is ready to think with me," not a blank chatbot.
            Devil's-advocate note (product docs, Sept 2026): a bare "type
            here" screen reads as "isn't this just ChatGPT?" within seconds.
            This hero is the fix — a short positioning line + what happens
            next (Council for the decisions worth it), not decoration (no
            gold borders/animation, per the same docs: "the premium feeling
            should come from clarity + confidence + restraint"). The literal
            first chat message (OPENING_LINE, shown once the thread starts)
            carries the fuller warm-welcome version of this same positioning
            as an actual paragraph — this headline is deliberately just the
            short prompt, not that whole paragraph blown up to display type,
            which would look like a wall of giant text. Replaced by the
            thread the moment the user sends their first message. ── */
        <div style={{
          flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column',
          alignItems: 'center', textAlign: 'center', padding: '24px 28px 32px',
        }}>
          {/* Wrapped in its own `margin: auto 0` block, rather than putting
              justifyContent:'center' on the scrolling parent above — that
              combination (flex column + overflow:auto + justify-content:
              center) clips the top of the content once it's taller than the
              viewport in some browsers. This still centers the primary
              hero content vertically when it's short (a brand-new,
              anonymous visitor with nothing eligible below) and lets it
              scroll naturally once the optional blocks below make the
              screen taller (a returning user with hero cards, AuthPanel,
              and/or the reference section all present). */}
          <div style={{ margin: 'auto 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, width: '100%' }}>
            <div>
              <h1 style={{
                fontFamily: 'var(--font-display)', fontWeight: 400,
                fontSize: 'clamp(24px, 6vw, 32px)', lineHeight: 1.28,
                color: 'var(--text-1)', margin: '0 0 10px', maxWidth: 440,
              }}>
                What's the decision you're circling?
              </h1>
              <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 1.5, margin: '0 auto', maxWidth: 360 }}>
                I'll uncover the decision, weigh your options, and challenge what you might be missing.
              </p>
            </div>

            {gated && (
              <div style={{ width: '100%', maxWidth: 440 }}>
                <ConnectCard
                  mode="d3_gate"
                  surface="chat_hero"
                  decisionCount={localDecisionCount}
                  arm={gateArm}
                />
              </div>
            )}

            {/* Landing simplification — input first, everything else one tap away:
                input -> "Not sure what to say? Walk me through it · See examples".
                The six category chips, the "or type anything" hint and the
                "big calls and smaller ones" line now live in the examples panel. */}
            {!gated && (
            <div style={{ width: '100%', maxWidth: 440 }}>
              {inputForm}
            </div>
            )}

            {!gated && (
              <div style={{ width: '100%', maxWidth: 440, marginTop: -6 }}>
                <div style={{
                  display: 'flex', alignItems: 'baseline', justifyContent: 'center', flexWrap: 'wrap',
                  gap: '4px 8px', fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.5,
                }}>
                  {walkthrough ? (
                    <span>{WALKTHROUGH_LINE}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setWalkthrough(true); inputRef.current?.focus() }}
                      style={{ background: 'none', border: 'none', padding: 0, fontSize: 12.5, color: 'var(--text-3)', cursor: 'pointer', textDecoration: 'underline' }}
                    >
                      {WALKTHROUGH_LABEL}
                    </button>
                  )}
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={toggleExamples}
                    aria-expanded={examplesOpen}
                    style={{ background: 'none', border: 'none', padding: 0, fontSize: 12.5, color: 'var(--text-3)', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    {examplesOpen ? 'Hide examples' : 'See examples'}
                  </button>
                </div>
              </div>
            )}

            {!gated && examplesOpen && (
              <div style={{ width: '100%', maxWidth: 440, marginTop: -6 }}>
                <p style={{ fontSize: 11.5, color: 'var(--text-4)', lineHeight: 1.5, margin: '0 auto 10px', maxWidth: 360 }}>
                  For the big calls, and the smaller ones you keep circling.
                </p>
                <DecisionStarters compact label="Start from an example" onPick={handleExamplePick} />
                <p style={{ fontSize: 11, color: 'var(--text-4)', lineHeight: 1.5, margin: '10px auto 0', maxWidth: 360 }}>
                  Or type anything — just tell me who's involved, what you're
                  choosing, or what's making it hard.
                </p>
              </div>
            )}

            <p style={{ fontSize: 11.5, color: 'var(--text-4)', letterSpacing: '0.02em', margin: 0 }}>
              Private · nothing is shared without your permission
            </p>
          </div>

          {/* Item 6 plan, Phase 2 / round 2 — Mirror/status hero cards.
              Still at most two, picked dynamically (lib/hero-cards.ts), but
              now collapsed to a one-line summary by default
              (components/HeroCardCollapsible.tsx) rather than rendering
              full detail immediately — two full cards still read as
              crowded even at two instead of five. Each still applies its
              own internal gate too (e.g. CalibrationRevealCard needs ≥3
              paired outcomes) — being in this list means "eligible," not
              "guaranteed to have something to show once expanded." */}
          {heroCards.length > 0 && (
            <div style={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', marginTop: 28, textAlign: 'left' }}>
              {heroCards.map((id, i) => {
                const { title, summary, statusDot } = heroCardSummary(id, heroSummaryInput)
                const card = (() => {
                  switch (id) {
                    case 'memory-engine':
                      return (
                        <MemoryEngineStatus
                          sessionCount={sessionCount}
                          pendingOutcomes={pendingOutcomesCount}
                          decidedCount={decidedCount}
                          hasIdentity={hasEmail}
                          mirrorUnlocked={mirrorUnlocked}
                          foundingAvailable={mirrorStatus?.foundingAvailable}
                          onScrollToHistory={() => router.push('/mirror')}
                        />
                      )
                    case 'mirror-open-loop':
                      return <MirrorOpenLoopCard authToken={authToken} sessionCount={sessionCount} mirrorUnlocked={mirrorUnlocked} />
                    case 'pattern-surface':
                      return <PatternSurfaceCard authToken={authToken} sessionCount={sessionCount} />
                    case 'calibration-reveal':
                      return <CalibrationRevealCard authToken={authToken} mirrorUnlocked={mirrorUnlocked} />
                    case 'recurring-condition':
                      return <RecurringConditionCard dimensions={patternDimensions} sessionCount={sessionCount} />
                    default:
                      return null
                  }
                })()
                return (
                  <div key={id} style={{ borderTop: i > 0 ? '1px solid var(--border-dim)' : 'none' }}>
                    <HeroCardCollapsible title={title} summary={summary} statusDot={statusDot}>
                      {card}
                    </HeroCardCollapsible>
                  </div>
                )
              })}
            </div>
          )}

          {/* Phase 1 — Watchlist, back in the chat front door for signed-in
              people (it only ever existed in the classic HomeClient). Pulled
              forward from the Phase 2 plan because "Park it for later" at the
              end of a decision writes here; without a visible list that would
              feel like a black hole. Graduating an item drops its text into
              the chat input; the normal chat -> Council path takes it from
              there. Flag-gated and bearer-only, exactly as in HomeClient. */}
          {/* Phase 2/3 — reminders and the home-screen icon, both only once there
              are two decisions to remind about. PushEnablePrompt hides itself
              unless notifications are actually available and not dismissed. */}
          {authToken && sessionCount >= 2 && (
            <div style={{ width: '100%', maxWidth: 440, marginTop: 16, textAlign: 'left' }}>
              <PushEnablePrompt authToken={authToken} />
            </div>
          )}
          {!started && sessionCount >= 2 && (
            <div style={{ width: '100%', maxWidth: 440, marginTop: 16 }}>
              <AddToHomeScreenPrompt decisionCount={sessionCount} signedIn={!!authToken} />
            </div>
          )}

          {isWatchlistEnabled() && authToken && (
            <div style={{ width: '100%', maxWidth: 440, marginTop: 16, textAlign: 'left' }}>
              <WatchlistSection authToken={authToken} onGraduate={handleStarterPick} />
            </div>
          )}

          {/* Item 6 plan, Phase 3 — inline capture. Now clearly below the
              input (see the note above it) rather than above, so it reads
              as "you can do this later," not a gate in front of typing. */}
          {!hasEmail && (
            <div style={{ width: '100%', maxWidth: 440, marginTop: 16, textAlign: 'left' }}>
              <AuthPanel userEmail={userEmail} onAuthenticated={onUserEmailChange} />
            </div>
          )}

          {/* Judgment Record, ported from app/HomeClient.tsx's flag-off
              version — same tabs/data, deliberately NOT HeroCardCollapsible's
              look (see components/JudgmentRecordStrip.tsx's own header
              comment for why). Renders nothing when there's no history yet. */}
          <JudgmentRecordStrip sessions={historySessions} />

          {/* Item 6 plan, Phase 4 — reference content: read-whenever, not
              core to the current task, so it's the last thing on the
              screen. Referral link removed from here entirely (round 2) —
              it now lives on the record page instead, after the person has
              actually been through a decision. Generous bottom padding
              matches inputForm's own bottom padding in the `started` state:
              globals.css's .visitor-counter pill is fixed at bottom:20/
              left:20 site-wide, and this is now the last scrollable content
              in the hero, so it needs the same clearance the input used to
              provide on its own. */}
          <div style={{
            width: '100%', maxWidth: 440, marginTop: 28,
            paddingBottom: 'calc(52px + env(safe-area-inset-bottom, 0px))',
          }}>
            <MeetTheCouncil />
          </div>
        </div>
      )}

      {/* Input — pinned to the screen bottom once the thread view takes
          over (see inputForm's own definition above for the hero-state
          version, which renders inline instead). Voice and send sit below
          the textarea on a second row so neither crowds the other on
          narrow screens. */}
      {started && inputForm}

      <style jsx>{`
        @keyframes chatDotPulse {
          0%, 60%, 100% { opacity: 0.25; transform: translateY(0); }
          30% { opacity: 1; transform: translateY(-2px); }
        }
      `}</style>
    </div>
  )
}
