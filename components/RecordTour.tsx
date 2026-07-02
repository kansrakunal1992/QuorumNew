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
import OnboardingTour, { buildPWAInstallStep } from './OnboardingTour'
import type { TourStep } from './OnboardingTour'

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
    id:               'record-new-decision',
    targetSelector:   '[data-tour-id="record-new-decision"]',
    heading:          'Your next decision is already waiting',
    body:             'Each decision you bring to the Council adds a layer to your Judgment OS. Tap here when you have your next decision — patterns begin to surface from your third entry onward.',
    preferredSide:    'bottom',
  },
]

// Two-step email-link sequence — only for first-time users with no linked email.
const EMAIL_LINK_STEPS: TourStep[] = [
  {
    id:               'record-email-link',
    targetSelector:   '[data-tour-id="record-email-link"]',
    heading:          'Lock in your decisions with an email',
    body:             'Right now your decisions are tied to this device only. Enter your email right here — we\'ll send you a single link. No password. Click it and your entire record travels with you across devices.',
    preferredSide:    'bottom',
  },
  {
    id:               'record-email-after',
    targetSelector:   null,
    heading:          'After the link lands in your inbox',
    body:             'Click it — that\'s the whole flow. You\'ll come straight back here with all your decisions linked to your account. Pattern memory activates, and you can pick up from any device, any time.',
    preferredSide:    'bottom',
  },
]

export default function RecordTour() {
  const [active, setActive] = useState(false)
  const [steps,  setSteps]  = useState<TourStep[]>(RECORD_STEPS_BASE)

  useEffect(() => {
    try {
      const done    = localStorage.getItem('quorum_tour.record')
      const skipped = localStorage.getItem('quorum_tour.home') === 'skip'
      if (!done && !skipped) {
        // ── Build dynamic step list ──────────────────────────────────────────
        const hasEmail = !!localStorage.getItem('quorum_user_email')

        const dynamicSteps: TourStep[] = [...RECORD_STEPS_BASE]

        if (!hasEmail) {
          // User hasn't linked email → show the two email-link tutorial steps.
          // Do NOT append PWA step yet (requires email to be linked first).
          dynamicSteps.push(...EMAIL_LINK_STEPS)
        } else {
          // User has email → check if a PWA install step is appropriate.
          const pwaStep = buildPWAInstallStep()
          if (pwaStep) dynamicSteps.push(pwaStep)
        }

        setSteps(dynamicSteps)

        // Delay to let the record page fully paint before overlay appears
        const t = setTimeout(() => setActive(true), 700)
        return () => clearTimeout(t)
      }
    } catch {}
  }, [])

  if (!active) return null

  const handleComplete = () => {
    try { localStorage.setItem('quorum_tour.record', 'done') } catch {}
    setActive(false)
  }

  const handleSkip = () => {
    try { localStorage.setItem('quorum_tour.record', 'skip') } catch {}
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
