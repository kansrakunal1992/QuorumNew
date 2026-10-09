'use client'

// components/NextDecisionPrompt.tsx
// -- Phase 1 (retention work): the post-decision "what next" block -------------
// Replaces three generic endings ("Start a new decision" faint link,
// "New Decision" ghost button in the Council tray, "New Decision" ghost button
// on the record page) with one continuity block:
//
//   1. a running prediction tally ("Quorum has guessed right 1 of 2"),
//   2. one line on why another decision helps (what Quorum can do with it),
//   3. one field -- "Anything else you're going back and forth on?" --
//      with two ways out: bring it to Quorum now, or park it for later,
//   4. a soft, skippable "keep my record" card for anonymous people
//      (ConnectCard), tied to their review date or the item they parked.
//
// One idea per screen: the primary button is the only loud element. Parking
// only appears when the Watchlist feature flag is on, and only once there is
// text to park.
//
// ONE PRIMARY BUTTON PER SCREEN. Every host screen already has its own primary
// action (done screen: convene the Council; session page: Save to Record; record
// page: the brief CTA), so this block defaults to the outline style and never
// competes with it. Pass emphasis='primary' only on a screen with no other
// primary action. ConnectCard (rendered below) is outline-only for the same reason.
//
// variant 'full'  -> button always visible ("Bring me another decision")
// variant 'field' -> block sits under other actions (record page); the button
//                    only appears once the person has typed something.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import ConnectCard from '@/components/ConnectCard'
import PredictionTally from '@/components/PredictionTally'
import HabitSetupCard from '@/components/HabitSetupCard'   // Phase 2
import type { HabitPrefs } from '@/lib/habit-prefs'
import { getStoredSessionIds } from '@/lib/storage'
import { getAuthHeaders } from '@/lib/auth-headers'
import { isWatchlistEnabled } from '@/lib/feature-flags'
import { addPendingPark } from '@/lib/pending-park'
import { setDecisionPrefill } from '@/lib/prefill'
import { track } from '@/lib/track'

interface Props {
  surface:        'done_screen' | 'session_page' | 'record_page'
  variant?:       'full' | 'field'
  emphasis?:      'primary' | 'secondary'
  sessionId?:     string | null
  reviewDate?:    string | null
  showExplainer?: boolean
  /** Bump to refetch the tally (e.g. when a decision gets locked). */
  refreshKey?:    string | number | boolean
  /**
   * Override navigation. Receives the text typed into the field ('' if none).
   * Default: store it as a one-shot prefill and go to '/'.
   */
  onBringNow?:    (text: string) => void
}

type ParkState = 'idle' | 'saving' | 'parked_linked' | 'parked_pending' | 'error'

function explainer(n: number): string {
  if (n <= 1) return 'Quorum learns how you decide by comparing decisions. Two are enough for a first comparison.'
  if (n === 2) return 'A third decision gives Quorum its first real look at how you decide.'
  return 'Each new decision sharpens what Quorum can see in how you decide.'
}

export default function NextDecisionPrompt({
  surface, variant = 'full', emphasis = 'secondary', sessionId, reviewDate,
  showExplainer = true, refreshKey, onBringNow,
}: Props) {
  const router = useRouter()
  const [text,      setText]      = useState('')
  const [count,     setCount]     = useState(0)
  const [linked,    setLinked]    = useState<boolean | null>(null)
  const [parkState, setParkState] = useState<ParkState>('idle')
  const [parkedText, setParkedText] = useState<string | null>(null)
  // Phase 2: cross-decision observation (D2 and later) and the habit answer.
  const [obs, setObs] = useState<{ line: string; kind: string } | null>(null)
  const [habit, setHabit] = useState<HabitPrefs | null>(null)

  const canPark = isWatchlistEnabled()

  useEffect(() => {
    const ids = getStoredSessionIds()
    setCount(Math.max(ids.length, 1))
    let cancelled = false
    ;(async () => {
      const auth = await getAuthHeaders()
      if (!cancelled) setLinked(!!auth.Authorization)
    })()
    return () => { cancelled = true }
  }, [])

  // Phase 2: one deterministic observation across the person's decisions
  // (/api/session/[id]/cross-decision). Nothing is shown for a first decision;
  // when nothing overlaps yet the server says so honestly.
  useEffect(() => {
    if (!showExplainer || !sessionId || count < 2) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/session/${sessionId}/cross-decision`, { cache: 'no-store' })
        if (!res.ok) return
        const d = await res.json()
        if (!cancelled && d?.line) {
          setObs({ line: d.line, kind: d.kind })
          track('observation_seen', { kind: d.kind, n: d.decisionCount ?? count, surface })
        }
      } catch { /* the explainer line stays */ }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, count, showExplainer, refreshKey])

  const trimmed = text.trim()

  function bringNow() {
    track('another_decision_clicked', { surface, with_text: !!trimmed })
    if (onBringNow) { onBringNow(trimmed); return }
    setDecisionPrefill(trimmed)
    router.push('/')
  }

  async function park() {
    if (!trimmed || parkState === 'saving') return
    track('park_started', { surface, linked: !!linked })
    const toPark = trimmed
    if (linked) {
      setParkState('saving')
      try {
        const res = await fetch('/api/watchlist', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
          body:    JSON.stringify({ text: toPark }),
        })
        if (!res.ok) throw new Error(String(res.status))
        setParkState('parked_linked')
        setParkedText(toPark)
        setText('')
        track('park_saved', { surface, linked: true })
      } catch {
        setParkState('error')
      }
      return
    }
    // Anonymous: hold it locally; /auth/callback files it once they link.
    addPendingPark(toPark)
    setParkState('parked_pending')
    setParkedText(toPark)
    setText('')
    track('park_saved', { surface, linked: false })
  }

  const showButton = variant === 'full' || !!trimmed
  const buttonLabel = trimmed ? 'Bring this one now \u2192' : 'Bring me another decision \u2192'
  const buttonClass = emphasis === 'primary' ? 'btn-primary' : 'btn-ghost'

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PredictionTally refreshKey={refreshKey} sessionId={sessionId} surface={surface} />

      {showExplainer && obs && count === 2 && (
        // The second decision is the first time Quorum can say something about
        // the person rather than the decision -- give it its own small card.
        <div style={{
          width: '100%', boxSizing: 'border-box', textAlign: 'left', padding: '14px 16px',
          background: 'var(--bg-card)', border: '1px solid var(--gold-dim)', borderRadius: 12,
        }}>
          <p style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-4)', margin: '0 0 6px' }}>
            Across your two decisions
          </p>
          <p style={{ fontSize: 14.5, color: 'var(--text-1)', lineHeight: 1.5, margin: 0 }}>{obs.line}</p>
        </div>
      )}
      {showExplainer && (!obs || count !== 2) && (
        <p style={{ fontSize: 13.5, color: 'var(--text-3)', lineHeight: 1.55, margin: 0, textAlign: 'center' }}>
          {obs ? obs.line : explainer(count)}
        </p>
      )}

      {parkState === 'parked_linked' || parkState === 'parked_pending' ? (
        <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0, textAlign: 'center' }}>
          Parked{parkState === 'parked_linked' ? ' on your Watchlist.' : '.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 12.5, color: 'var(--text-3)' }} htmlFor={`ndp-${surface}`}>
            Anything else you&apos;re going back and forth on?
          </label>
          <input
            id={`ndp-${surface}`}
            type="text"
            value={text}
            maxLength={300}
            placeholder={"A message you haven't sent, something you keep putting off\u2026"}
            onChange={e => { setText(e.target.value); if (parkState === 'error') setParkState('idle') }}
            onKeyDown={e => { if (e.key === 'Enter' && trimmed) bringNow() }}
            style={{
              width: '100%', boxSizing: 'border-box', background: 'var(--bg-inset)',
              border: '1px solid var(--border-mid)', borderRadius: 10, padding: '11px 14px',
              fontSize: 14, color: 'var(--text-1)', fontFamily: 'inherit', outline: 'none',
            }}
          />
          {parkState === 'error' && (
            <p style={{ fontSize: 11.5, color: 'var(--danger-text, #e07a7a)', margin: 0 }}>
              Could not park that right now. You can still bring it now.
            </p>
          )}
        </div>
      )}

      {showButton && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <button
            className={buttonClass}
            style={{ fontSize: 14, padding: '13px 26px', minHeight: 46, width: '100%', maxWidth: 320 }}
            onClick={bringNow}
          >
            {buttonLabel}
          </button>
          {canPark && trimmed && (
            <button
              onClick={park}
              disabled={parkState === 'saving'}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 12.5, color: 'var(--text-3)', textDecoration: 'underline',
                textUnderlineOffset: 2, padding: '4px 8px',
              }}
            >
              {parkState === 'saving' ? 'Parking\u2026' : 'Park it for later'}
            </button>
          )}
        </div>
      )}

      {/* Phase 2: cue + cadence, once, under the second decision. Order is
          deliberate: the way to the next decision (field + button) stays
          directly under the observation; this is optional and below it. */}
      {showExplainer && count === 2 && linked !== null && (
        <HabitSetupCard surface={surface} linked={linked} onSaved={setHabit} />
      )}

      {linked === false && (
        <ConnectCard
          mode={count >= 2 ? 'd2_earned' : 'd1_soft'}
          surface={surface}
          reviewDate={reviewDate}
          parkedText={parkState === 'parked_pending' ? parkedText : null}
          sessionId={sessionId}
          lead={habit?.cadence === 'weekly'
            ? 'Weekly needs somewhere to send it. Where should Quorum reach you?'
            : null}
        />
      )}
    </div>
  )
}
