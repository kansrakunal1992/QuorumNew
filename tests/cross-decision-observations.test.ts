import { describe, it, expect } from 'vitest'
import {
  computeObservations, pickObservation, followedInstinct, NO_OVERLAP,
  type DecisionRow,
} from '../lib/cross-decision-observations'

const row = (i: number, over: Partial<DecisionRow> = {}): DecisionRow => ({
  id: `s${i}`,
  created_at: `2026-09-${String(10 + i).padStart(2, '0')}T10:00:00Z`,
  optimization_priority: null,
  initial_instinct: null,
  final_decision_plain: null,
  prediction_matched_final: null,
  ...over,
})

describe('followedInstinct', () => {
  it('accept followed when final is not a no', () => {
    expect(followedInstinct('accept', 'Take the offer')).toBe(true)
    expect(followedInstinct('accept', 'No, I will decline')).toBe(false)
  })
  it('reject followed when final declines', () => {
    expect(followedInstinct('reject', 'I will decline it')).toBe(true)
    expect(followedInstinct('reject', 'Go ahead')).toBe(false)
  })
  it('unsure / missing -> null', () => {
    expect(followedInstinct('unsure', 'x')).toBeNull()
    expect(followedInstinct(null, 'x')).toBeNull()
    expect(followedInstinct('accept', null)).toBeNull()
  })
})

describe('computeObservations', () => {
  it('returns nothing for a single decision', () => {
    expect(computeObservations([row(1, { optimization_priority: 'money' })])).toEqual([])
  })

  it('both times same priority at D2', () => {
    const obs = computeObservations(
      [row(1, { optimization_priority: 'money' }), row(2, { optimization_priority: 'money' })],
      { focusId: 's2' },
    )
    const p = obs.find(o => o.kind === 'priority_repeat')!
    expect(p.line).toBe('Both times, you put money first.')
  })

  it('does not invent a repeat when priorities differ at D2', () => {
    const obs = computeObservations(
      [row(1, { optimization_priority: 'money' }), row(2, { optimization_priority: 'family' })],
      { focusId: 's2' },
    )
    expect(obs.find(o => o.kind === 'priority_repeat')).toBeUndefined()
  })

  it('"other" priority is ignored', () => {
    const obs = computeObservations([
      row(1, { optimization_priority: 'other' }), row(2, { optimization_priority: 'other' }),
    ])
    expect(obs.find(o => o.kind === 'priority_repeat')).toBeUndefined()
  })

  it('counts k of n for repeated priority across 4', () => {
    const obs = computeObservations([
      row(1, { optimization_priority: 'security' }), row(2, { optimization_priority: 'security' }),
      row(3, { optimization_priority: 'money' }),    row(4, { optimization_priority: 'security' }),
    ])
    expect(obs.find(o => o.kind === 'priority_repeat')!.line).toBe('You put security first in 3 of your last 4 decisions.')
  })

  it('instinct followed all the time vs overridden', () => {
    const all = computeObservations([
      row(1, { initial_instinct: 'accept', final_decision_plain: 'Yes, take it' }),
      row(2, { initial_instinct: 'reject', final_decision_plain: 'No, decline' }),
    ])
    expect(all.find(o => o.kind === 'instinct_follow')!.line).toBe('You went with your first instinct both times.')

    const none = computeObservations([
      row(1, { initial_instinct: 'accept', final_decision_plain: 'No, decline' }),
      row(2, { initial_instinct: 'reject', final_decision_plain: 'Yes, take it' }),
      row(3, { initial_instinct: 'accept', final_decision_plain: 'reject it' }),
    ])
    expect(none.find(o => o.kind === 'instinct_follow')!.line).toBe('You overrode your first instinct in all 3 decisions.')
  })

  it('prediction record needs 2+ outcomes', () => {
    expect(computeObservations([row(1, { prediction_matched_final: true })])).toEqual([])
    const obs = computeObservations([
      row(1, { prediction_matched_final: true }), row(2, { prediction_matched_final: false }),
    ])
    expect(obs.find(o => o.kind === 'prediction')!.line).toBe('Quorum has guessed right 1 of 2.')
  })

  it('only looks at the most recent window', () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(i + 1, { optimization_priority: i < 4 ? 'family' : 'money' }))
    const obs = computeObservations(rows, { window: 8 })
    expect(obs.find(o => o.kind === 'priority_repeat')!.line).toContain('money')
  })
})

describe('pickObservation', () => {
  it('falls back to an honest no-overlap line', () => {
    expect(pickObservation([], { n: 2, seed: 'x' })).toBe(NO_OVERLAP)
  })
  it('respects exclude and is deterministic', () => {
    const obs = computeObservations([
      row(1, { optimization_priority: 'money', prediction_matched_final: true }),
      row(2, { optimization_priority: 'money', prediction_matched_final: false }),
    ])
    const a = pickObservation(obs, { n: 2, seed: 'abc', exclude: ['prediction'] })
    const b = pickObservation(obs, { n: 2, seed: 'abc', exclude: ['prediction'] })
    expect(a).toEqual(b)
    expect(a.kind).not.toBe('prediction')
  })
})
