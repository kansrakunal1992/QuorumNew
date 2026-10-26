import { describe, it, expect } from 'vitest'
import { buildRecordTourSteps, SEL } from '@/lib/record-tour-steps'
import type { TourStep } from '@/components/OnboardingTour'

const base: TourStep[] = [
  { id: 'record-decision', targetSelector: '[data-tour-id="record-decision"]', heading: 'h', body: 'b', preferredSide: 'bottom' },
  { id: 'record-gone',     targetSelector: '[data-tour-id="removed-feature"]',  heading: 'h', body: 'b', preferredSide: 'bottom' },
]
const pwa: TourStep = { id: 'install-pwa', targetSelector: null, heading: 'h', body: 'b', preferredSide: 'bottom' }
const dom = (...sels: string[]) => (s: string) => sels.includes(s)
const ids = (a: TourStep[]) => a.map(s => s.id)

describe('buildRecordTourSteps — DOM is the source of truth', () => {
  it('anonymous: sign-in, share (no invite: ReferralLink is signed-in only)', () => {
    const steps = buildRecordTourSteps({ baseSteps: base, pwaStep: null,
      present: dom('[data-tour-id="record-decision"]', SEL.signin, SEL.share) })
    expect(ids(steps)).toEqual(['record-decision', 'record-signin', 'record-share'])
  })
  it('signed in: invite + share, plus PWA nudge instead of sign-in', () => {
    const steps = buildRecordTourSteps({ baseSteps: base, pwaStep: pwa,
      present: dom('[data-tour-id="record-decision"]', SEL.invite, SEL.share) })
    expect(ids(steps)).toEqual(['record-decision', 'install-pwa', 'record-invite', 'record-share'])
  })
  it('never shows PWA alongside sign-in', () => {
    const steps = buildRecordTourSteps({ baseSteps: base, pwaStep: pwa, present: dom(SEL.signin) })
    expect(ids(steps)).not.toContain('install-pwa')
  })
  it('drops any step whose target is not on the page (no "nowhere to focus" tips)', () => {
    const steps = buildRecordTourSteps({ baseSteps: base, pwaStep: null, present: dom('[data-tour-id="record-decision"]') })
    expect(ids(steps)).toEqual(['record-decision'])
  })
  it('sign-in dismissed (ConnectCard hidden) ⇒ no sign-in step', () => {
    const steps = buildRecordTourSteps({ baseSteps: base, pwaStep: null, present: dom(SEL.share) })
    expect(ids(steps)).toEqual(['record-share'])
  })
  it('the share step copy mentions the link and the invite step names the button', () => {
    const steps = buildRecordTourSteps({ baseSteps: [], pwaStep: null, present: dom(SEL.invite, SEL.share) })
    expect(steps.find(s => s.id === 'record-invite')!.body).toContain('Copy invite link')
    expect(steps.find(s => s.id === 'record-share')!.body).toMatch(/link/i)
  })
})
