'use client'

// components/RecordTour.tsx
// Sprint TOUR-1 — Record page tour wrapper (client component)
// Server-rendered record page imports this; it reads localStorage on mount
// and shows the tour only when the user hasn't seen it yet.
//
// Dynamic step logic (built once on mount):
//   1. Base steps always appear.
//   2. Email-link steps (2 steps): only when user has no linked email.
//      — Explains where to enter email + what to do after the link arrives.
//   3. PWA install step: only when user HAS linked email AND is on a mobile
//      browser outside standalone mode (via buildPWAInstallStep).
//      Email-link users never see the PWA step in the same session — they get
//      it on a future tour after they've clicked the email link.

import { useState, useEffect } from 'react'
import { isUnifiedSessionEnabled } from '@/lib/feature-flags'
import OnboardingTour, { buildPWAInstallStep } from './OnboardingTour'
import type { TourStep } from './OnboardingTour'
import { buildRecordTourSteps, waitForSelector, SEL } from '@/lib/record-tour-steps'

interface Props {
  /** P0 fix: real cross-session decision count, resolved server-side in
   *  app/record/[id]/page.tsx. Previously this component had no way to know
   *  whether the user was new — it only ever checked localStorage, so an
   *  established user (e.g. 5 decisions already on record) opening the app on
   *  a fresh device/PWA install would see a "first decision" tour here too. */
  totalSessionCount?: number
  /** P0 fix: server-side truth for "has this user already seen the Record
   *  tour", resolved from user_profiles.record_tour_completed_at — same
   *  cross-device durability the Home tour already had. */
  tourDone?: boolean
}

const RECORD_STEPS_BASE: TourStep[] = [
  {
    id:               'record-decision',
    targetSelector:   '[data-tour-id="record-decision"]',
    heading:          'Your decision is now on the record',
    body:             'This is your permanent audit trail — the decision exactly as you framed it, when you made it, and how confident you were. Quorum never alters what you wrote.',
    preferredSide:    'bottom',
  },
  {
    id:               'record-outcome',
    targetSelector:   '[data-tour-id="record-outcome"]',
    heading:          'Come back here when the outcome is known',
    body:             'Log what you actually decided and how it unfolded. Without outcome data, pattern detection has nothing to learn from. Most users return 2–4 weeks after the decision.',
    preferredSide:    'bottom',
  },
  {
    id:               'record-decision-brief',
    targetSelector:   '[data-tour-id="record-decision-brief"]',
    heading:          'Take the full analysis with you',
    body:             isUnifiedSessionEnabled()
      ? 'Download this decision as a formatted PDF — the synthesis, your initial lean, Quorum\'s hypothesis and reasoning, what you actually chose, and any pushbacks you raised. Useful for sharing with a partner or co-founder, or just for your own records outside Quorum.'
      : 'Download this decision as a formatted PDF — every advisor\'s position, the synthesis, and any pushbacks you raised. Useful for sharing with a partner or co-founder, or just for your own records outside Quorum.',
    preferredSide:    'bottom',
  },
  {
    id:               'record-new-decision',
    targetSelector:   '[data-tour-id="record-new-decision"]',
    heading:          'Your next decision is already waiting',
    body:             'Each decision you bring to the Council adds a layer to your Judgment OS. Tap here when you have your next decision — patterns begin to surface from your third entry onward.',
    preferredSide:    'bottom',
  },
]

export default function RecordTour({ totalSessionCount, tourDone = false }: Props) {
  const [active, setActive] = useState(false)
  const [steps,  setSteps]  = useState<TourStep[]>(RECORD_STEPS_BASE)

  useEffect(() => {
    // P0 fix: server truth + real decision count first — localStorage alone
    // was never enough to tell "new user" from "established user, new device".
    if (tourDone) return
    if ((totalSessionCount ?? 0) > 1) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      // Product decision (2026-08): the three tours (home, council, record) are
      // independent — this one only looks at its own dismissal state.
      if (localStorage.getItem('quorum_tour.record')) return
      const hasEmail = !!localStorage.getItem('quorum_user_email')

      ;(async () => {
        // ConnectCard (the sign-in block) mounts AFTER an async auth check, so a fixed
        // delay raced it. Wait for it — but only people who might actually see it, so a
        // linked person isn't held up. If it never appears, that step is simply omitted.
        if (!hasEmail) await waitForSelector(SEL.signin, 2500)
        if (cancelled) return
        // The DOM is the source of truth: only steps whose target exists are shown
        // (see lib/record-tour-steps.ts).
        const dynamicSteps = buildRecordTourSteps({
          baseSteps: RECORD_STEPS_BASE,
          present:   sel => !!document.querySelector(sel),
          pwaStep:   hasEmail ? buildPWAInstallStep() : null,
        })
        setSteps(dynamicSteps)
        // Let the page finish painting before the overlay appears.
        timer = setTimeout(() => { if (!cancelled) setActive(true) }, 400)
      })()
    } catch {}
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [tourDone, totalSessionCount])

  if (!active) return null

  // P0 fix: persist completion/skip server-side too, not just localStorage —
  // mirrors the Home tour's existing cross-device fix. Token is fetched lazily
  // here (rather than held in state throughout) since it's only ever needed
  // at this one moment; dynamic import keeps the supabase client out of this
  // component's initial bundle for the common case where the tour never fires.
  const persistTourDone = async () => {
    try {
      const { createClient } = await import('@/lib/supabase')
      const sb = createClient()
      const { data: { session: authSession } } = await sb.auth.getSession()
      const token = authSession?.access_token
      if (!token) return
      fetch('/api/onboarding/complete', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ tour: 'record' }),
      }).catch(() => {})
    } catch { /* anonymous session — nothing to persist server-side */ }
  }

  const handleComplete = () => {
    try { localStorage.setItem('quorum_tour.record', 'done') } catch {}
    persistTourDone()
    setActive(false)
  }

  const handleSkip = () => {
    try { localStorage.setItem('quorum_tour.record', 'skip') } catch {}
    persistTourDone()
    setActive(false)
  }

  return (
    <OnboardingTour
      page="record"
      steps={steps}
      active={active}
      onComplete={handleComplete}
      onSkip={handleSkip}
    />
  )
}
