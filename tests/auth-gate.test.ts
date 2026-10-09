import { describe, it, expect } from 'vitest'
import { armForKey, resolveArm, isGated, GATE_AFTER } from '../lib/auth-gate'

describe('auth gate', () => {
  it('off -> never gated', () => {
    expect(resolveArm('off', 'dev')).toBeNull()
    expect(isGated(50, null)).toBe(false)
  })
  it('d3 gates at 2 decisions, d4 at 3', () => {
    expect(isGated(1, resolveArm('d3', 'x'))).toBe(false)
    expect(isGated(2, resolveArm('d3', 'x'))).toBe(true)
    expect(isGated(2, resolveArm('d4', 'x'))).toBe(false)
    expect(isGated(3, resolveArm('d4', 'x'))).toBe(true)
  })
  it('soft_only is never gated', () => {
    expect(GATE_AFTER.soft_only).toBeNull()
    expect(isGated(99, 'soft_only')).toBe(false)
  })
  it('arm assignment is deterministic and roughly balanced', () => {
    expect(armForKey('device-1')).toBe(armForKey('device-1'))
    const counts: Record<string, number> = { gate_d3: 0, gate_d4: 0, soft_only: 0 }
    for (let i = 0; i < 3000; i++) counts[armForKey(`dev-${i}`)]++
    Object.values(counts).forEach(c => { expect(c).toBeGreaterThan(800); expect(c).toBeLessThan(1200) })
  })
  it('experiment with no key -> no arm', () => {
    expect(resolveArm('experiment', null)).toBeNull()
  })
})
