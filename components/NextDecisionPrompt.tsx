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

      {showExplainer && (
        <p style={{ fontSize: 13.5, color: 'var(--text-3)', lineHeight: 1.55, margin: 0, textAlign: 'center' }}>
          {explainer(count)}
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

      {linked === false && (
        <ConnectCard
          mode="d1_soft"
          surface={surface}
          reviewDate={reviewDate}
          parkedText={parkState === 'parked_pending' ? parkedText : null}
          sessionId={sessionId}
        />
      )}
    </div>
  )
}
