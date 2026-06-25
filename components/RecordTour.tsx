'use client'

// components/RecordTour.tsx
// Sprint TOUR-1 — Record page tour wrapper (client component)
// Server-rendered record page imports this; it reads localStorage on mount
// and shows the tour only when the user hasn't seen it yet.

import { useState, useEffect } from 'react'
import OnboardingTour from './OnboardingTour'
import type { TourStep } from './OnboardingTour'

const RECORD_STEPS: TourStep[] = [
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

export default function RecordTour() {
  const [active, setActive] = useState(false)

  useEffect(() => {
    try {
      const done    = localStorage.getItem('quorum_tour.record')
      const skipped = localStorage.getItem('quorum_tour.home') === 'skip'
      if (!done && !skipped) {
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
      steps={RECORD_STEPS}
      active={active}
      onComplete={handleComplete}
      onSkip={handleSkip}
    />
  )
}
