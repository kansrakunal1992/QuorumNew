// lib/record-tour-steps.ts
//
// Pure step-list builder for the Record-page tour (components/RecordTour.tsx).
//
// ROOT CAUSE this replaces: the tour used a FIXED step list whose sign-in step pointed at
// [data-tour-id="record-email-link"] — an anchor that only existed inside EmailCaptureCard,
// which the Record page stopped rendering when NextDecisionPrompt/ConnectCard replaced it. The
// step therefore had no element to spotlight ("tour tip has nowhere to focus"). It also decided
// "does this person need the sign-in step?" from localStorage, while ConnectCard decides
// whether to show itself from a live Supabase session — the two could disagree.
//
// New rule: the DOM is the single source of truth. A step is included only if its target is
// actually on the page right now; the sign-in step therefore appears exactly when ConnectCard
// does, and the invite step exactly when ReferralLink does (signed-in people only).

import type { TourStep } from '@/components/OnboardingTour'

export const SEL = {
  signin: '[data-tour-id="record-signin"]',
  share:  '[data-tour-id="record-share"]',
  invite: '[data-tour-id="record-invite"]',
} as const

export const SIGNIN_STEP: TourStep = {
  id: 'record-signin',
  targetSelector: SEL.signin,
  heading: 'Keep this record yours',
  body: 'Right now this decision lives on this device only. Continue with Google for one-click access, or enter your email for a one-time link — either way your whole record follows you across devices.',
  preferredSide: 'top',
}

export const SHARE_STEP: TourStep = {
  id: 'record-share',
  targetSelector: SEL.share,
  heading: 'Share this decision',
  body: 'Tap Share to get a read-only link to this decision. Copy it, or send it straight to WhatsApp or LinkedIn — handy when a partner, mentor or friend should weigh in.',
  preferredSide: 'top',
}

export const INVITE_STEP: TourStep = {
  id: 'record-invite',
  targetSelector: SEL.invite,
  heading: 'Know someone who’d use this?',
  body: 'Tap “Copy invite link” for your personal link to Quorum — send it to anyone stuck on a decision of their own.',
  preferredSide: 'top',
}

export interface BuildArgs {
  baseSteps: TourStep[]
  /** True if the selector currently matches an element on the page. */
  present: (selector: string) => boolean
  /** Result of buildPWAInstallStep() — only offered to people who are linked. */
  pwaStep: TourStep | null
}

export function buildRecordTourSteps({ baseSteps, present, pwaStep }: BuildArgs): TourStep[] {
  const keep = (s: TourStep) => !s.targetSelector || present(s.targetSelector)
  const steps = baseSteps.filter(keep)
  const signinShown = present(SEL.signin)

  if (signinShown) steps.push(SIGNIN_STEP)
  // Linked people see the PWA nudge in place of the sign-in step, never alongside it.
  else if (pwaStep) steps.push(pwaStep)

  if (present(SEL.invite)) steps.push(INVITE_STEP)
  if (present(SEL.share))  steps.push(SHARE_STEP)
  return steps
}

/** Resolve once `selector` is on the page, or after `timeoutMs` (ConnectCard mounts after an async auth check). */
export function waitForSelector(selector: string, timeoutMs: number, intervalMs = 150): Promise<boolean> {
  return new Promise(resolve => {
    const start = Date.now()
    const tick = () => {
      if (document.querySelector(selector)) return resolve(true)
      if (Date.now() - start >= timeoutMs) return resolve(false)
      setTimeout(tick, intervalMs)
    }
    tick()
  })
}
