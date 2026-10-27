import { describe, it, expect } from 'vitest'
import { councilGates, type CouncilGateInput } from '../lib/council-gates'

const base: CouncilGateInput = {
  earlyStart: false, examinerSubmitted: true, notReadyBlocked: false, ceremonyGateOpen: false, quorumReadGateOpen: false,
}
const g = (o: Partial<CouncilGateInput>) => councilGates({ ...base, ...o })

describe('flag OFF — identical to the old single expression', () => {
  it('advisors fetch only after the Examiner AND both reveal gates (the sessions 1-3 behaviour)', () => {
    expect(g({}).canStream).toBe(false)
    expect(g({ ceremonyGateOpen: true }).canStream).toBe(false)
    expect(g({ quorumReadGateOpen: true }).canStream).toBe(false)
    expect(g({ ceremonyGateOpen: true, quorumReadGateOpen: true }).canStream).toBe(true)
  })
  it('the reveal is never held back by this module', () => {
    expect(g({}).councilRevealed).toBe(true)
  })
  it('matches the legacy expression over every input combination', () => {
    for (const examinerSubmitted of [true, false]) for (const notReadyBlocked of [true, false])
      for (const ceremonyGateOpen of [true, false]) for (const quorumReadGateOpen of [true, false]) {
        const legacy = examinerSubmitted && ceremonyGateOpen && quorumReadGateOpen && !notReadyBlocked
        expect(councilGates({ earlyStart: false, examinerSubmitted, notReadyBlocked, ceremonyGateOpen, quorumReadGateOpen }).canStream).toBe(legacy)
      }
  })
})

describe('flag ON — fetch early, reveal late', () => {
  const on = (o: Partial<CouncilGateInput>) => g({ earlyStart: true, ...o })
  it('advisors fetch as soon as the Examiner is done, before either gate opens', () => {
    expect(on({}).canStream).toBe(true)
  })
  it('…but nothing is revealed until BOTH gates are open (hypothesis before advisors)', () => {
    expect(on({}).councilRevealed).toBe(false)
    expect(on({ ceremonyGateOpen: true }).councilRevealed).toBe(false)
    expect(on({ quorumReadGateOpen: true }).councilRevealed).toBe(false)
    expect(on({ ceremonyGateOpen: true, quorumReadGateOpen: true }).councilRevealed).toBe(true)
  })
  it('still never fetches before the Examiner is submitted', () => {
    expect(on({ examinerSubmitted: false }).canStream).toBe(false)
  })
  it('still never fetches when readiness blocks the Council', () => {
    expect(on({ notReadyBlocked: true }).canStream).toBe(false)
  })
  it('for later sessions (gates not applicable ⇒ both open) behaviour is the same on or off', () => {
    const open = { ceremonyGateOpen: true, quorumReadGateOpen: true }
    expect(g(open)).toEqual(on(open))
  })
})
