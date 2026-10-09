'use client'

// app/NaturalIntakeClient.tsx
// ── Natural Intake (v1) — the new front door ──────────────────────────────────
//
// Rendered by app/page.tsx instead of HomeClient when
// NEXT_PUBLIC_NATURAL_INTAKE_ENABLED is on. HomeClient.tsx is not imported
// or modified here — the two are fully independent, so nothing in the
// classic form's 2,000+ lines is at risk from this addition.
//
// Owns the phase transition (chat → checkpoint), the identity bits every
// session needs (device id, optional email), AND — item 6 plan, Phase 0 —
// the shared Mirror/history data both the chat hero's status-card stack and
// ChatIntake's own top-bar label need. Fetched once here and passed down,
// instead of ChatIntake fetching /api/mirror/status on its own (which is
// what it did before this component had anything else that needed the
// same data).

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  getOrCreateDeviceId,
  getStoredUserEmail,
  getStoredSessionIds,
} from '@/lib/storage'
import { createClient } from '@/lib/supabase'
import { isUnifiedSessionEnabled } from '@/lib/feature-flags'
import { track } from '@/lib/track'   // Phase 0: first-party events
import { setDecisionPrefill } from '@/lib/prefill'   // Phase 1
import { eligibleHeroCards } from '@/lib/hero-cards'
import type { MirrorStatus } from '@/lib/types'
import type { DimPattern } from '@/components/RecurringConditionCard'
import ChatIntake from '@/components/ChatIntake'
import DecisionCheckpoint from '@/components/DecisionCheckpoint'
import ProfileCaptureOverlay from '@/components/ProfileCaptureOverlay'

type Phase = 'chat' | 'checkpoint'

// Minimal shape — this component only ever needs `outcome` (to split
// pending vs. decided for MemoryEngineStatus), not the rest of what
// app/HomeClient.tsx's fuller SessionSummary carries.
interface HistorySession {
  id:             string
  decision_text:  string
  created_at:     string
  outcome: {
    council_helped: string
    what_decided:   string
  } | null
}

export default function NaturalIntakeClient() {
  const router = useRouter()
  const [phase, setPhase]               = useState<Phase>('chat')
  const [chatIntakeId, setChatIntakeId] = useState<string | null>(null)
  const [grantExtra, setGrantExtra]     = useState(false)

  const deviceId = typeof window !== 'undefined' ? getOrCreateDeviceId() : ''

  // ── Phase 0 — shared plumbing ────────────────────────────────────────────
  const [authToken, setAuthToken]   = useState<string | null>(null)
  const [userEmail, setUserEmail]   = useState<string | null>(null)
  const [mirrorStatus, setMirrorStatus]           = useState<MirrorStatus | null>(null)
  const [patternDimensions, setPatternDimensions] = useState<DimPattern[]>([])
  const [historySessions, setHistorySessions]     = useState<HistorySession[]>([])
  const [showProfileCapture, setShowProfileCapture] = useState(false)
  // Phase 1: bumped when a new decision starts so the home history (and the
  // counts derived from it) refetch instead of staying frozen at page load.
  const [historyVersion, setHistoryVersion] = useState(0)

  // Phase 0: one landing_view per mount of the front door.
  useEffect(() => { track('landing_view', { surface: 'natural_intake' }) }, [])

  useEffect(() => {
    setUserEmail(getStoredUserEmail())
    let cancelled = false
    ;(async () => {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token ?? null
        if (cancelled) return
        setAuthToken(token)
        // Item 6 plan, round 2: userId is no longer needed here — it only
        // ever fed ChatIntake's ReferralLink, which has moved to the record
        // page (app/record/[id]/page.tsx), where session.user_id already
        // covers the same need without this component fetching it too.
        if (session?.user?.email) setUserEmail(session.user.email)
        if (!token) return

        const statusRes = await fetch('/api/mirror/status', { headers: { Authorization: `Bearer ${token}` } })
        if (cancelled) return
        if (statusRes.ok) {
          const status = await statusRes.json() as MirrorStatus
          setMirrorStatus(status)
          // Same as app/HomeClient.tsx's refreshMirrorStatus: pattern
          // dimensions (RecurringConditionCard) are only meaningful, and
          // only fetched, once Mirror is actually unlocked.
          if (status?.gateState === 'unlocked') {
            fetch('/api/mirror/patterns', { headers: { Authorization: `Bearer ${token}` } })
              .then(r => r.json())
              .then(pd => { if (!cancelled && pd?.top_dimensions) setPatternDimensions(pd.top_dimensions) })
              .catch(() => {})
          }
        }
      } catch { /* hero/top-bar just fall back to their signed-out state */ }
    })()
    return () => { cancelled = true }
  }, [])

  // History (for MemoryEngineStatus's pending/decided counts) — separate
  // effect from the auth/mirror one above since it also runs for anonymous
  // visitors with locally-stored session ids and no authToken.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const ids = getStoredSessionIds()
        if (!ids.length) return
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`
        const res  = await fetch('/api/history', { method: 'POST', headers, body: JSON.stringify({ ids }) })
        const data = await res.json()
        if (!cancelled) setHistorySessions(data.sessions ?? [])
      } catch {}
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, historyVersion])

  const sessionCount   = mirrorStatus?.sessionCount ?? historySessions.length
  const mirrorUnlocked = mirrorStatus?.gateState === 'unlocked'
  const pendingOutcomesCount = historySessions.filter(s => !s.outcome).length
  const decidedCount        = historySessions.filter(s =>  s.outcome).length

  // Cap removed (Sept 2026, Kunal's call) — every eligible card shows, no
  // rotation. lib/hero-cards.ts's pickTopHeroCards/rotation-index helpers
  // are left in place, unused, in case a cap is reintroduced later.
  const heroCards = eligibleHeroCards({
    sessionCount,
    mirrorUnlocked,
    patternDimensionsCount: patternDimensions.length,
  })

  // ── SB-1: Profile capture overlay ────────────────────────────────────────
  // Same rule as app/HomeClient.tsx: under the unified-session flag, skipped
  // entirely until the user has a completed session — every screen before
  // first value counts against the "no concierge" test. Mounted at this
  // level (not inside ChatIntake) so it behaves identically regardless of
  // which phase ('chat' or 'checkpoint') is currently active, instead of
  // needing to be duplicated into both.
  //
  // Deliberately does NOT include <OnboardingTour> here (see the note on
  // that component's own mount point in components/SessionView.tsx) — under
  // Natural Intake + unified session, "the new experience," onboarding
  // should begin only once the Council has actually been convened, never
  // during chat or the checkpoint. SessionView.tsx already owns that tour
  // and already only fires it once synthesis completes; mounting a second
  // one here would either duplicate it or, worse, risk showing tour content
  // before there's anything on screen for it to point at.
  useEffect(() => {
    try {
      if (localStorage.getItem('quorum_profile_overlay_shown') === 'true') return
    } catch {}
    if (isUnifiedSessionEnabled() && historySessions.length === 0) return
    if (!authToken) {
      const t = setTimeout(() => setShowProfileCapture(true), 1200)
      return () => clearTimeout(t)
    }
    let cancelled = false
    fetch('/api/profile', { headers: { Authorization: `Bearer ${authToken}` } })
      .then(r => r.json())
      .then(d => { if (!cancelled && !d?.profile) setShowProfileCapture(true) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [authToken, historySessions.length])

  function handleReadyToReflect(id: string) {
    setChatIntakeId(id)
    setPhase('checkpoint')
  }

  function handleBackToChat() {
    // "Let me add more" — same chat_intake, a few extra exchanges (plan
    // section 4E's "Keep thinking", scoped in v1 to the pre-session
    // reflection step — see docs/CHANGELOG_v1.md for why).
    setGrantExtra(true)
    setPhase('chat')
  }

  function handleSessionCreated(sessionId: string) {
    router.push(`/session/${sessionId}`)
  }

  // Phase 1: "Bring me another decision" from the "I'm done" ending. A real
  // state reset instead of window.location.reload(): fresh chat, fresh history.
  function handleNewDecision(prefill: string) {
    setDecisionPrefill(prefill)
    setChatIntakeId(null)
    setGrantExtra(false)
    setPhase('chat')
    setHistoryVersion(v => v + 1)
    try { window.scrollTo(0, 0) } catch {}
  }

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-void)',
        color: 'var(--text-1)',
        fontFamily: 'var(--font-body)',
      }}
    >
      {phase === 'chat' && (
        <ChatIntake
          chatIntakeId={chatIntakeId}
          deviceId={deviceId}
          grantExtraExchanges={grantExtra}
          onChatIntakeId={setChatIntakeId}
          onReadyToReflect={handleReadyToReflect}
          authToken={authToken}
          userEmail={userEmail}
          onUserEmailChange={setUserEmail}
          mirrorStatus={mirrorStatus}
          patternDimensions={patternDimensions}
          pendingOutcomesCount={pendingOutcomesCount}
          decidedCount={decidedCount}
          heroCards={heroCards}
          historySessions={historySessions}
        />
      )}
      {phase === 'checkpoint' && chatIntakeId && (
        <DecisionCheckpoint
          chatIntakeId={chatIntakeId}
          onBackToChat={handleBackToChat}
          onSessionCreated={handleSessionCreated}
          onNewDecision={handleNewDecision}
        />
      )}

      {showProfileCapture && (
        <ProfileCaptureOverlay
          authToken={authToken}
          deviceId={null}
          onDone={() => setShowProfileCapture(false)}
        />
      )}
    </main>
  )
}
