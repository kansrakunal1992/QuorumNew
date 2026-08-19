// tests/readiness-gate.test.ts
//
// Unit tests for lib/readiness.ts — the PR3 deterministic readiness gate.
// Same convention as tests/examiner-golden-suite.test.ts: computeReadiness()
// is pure and synchronous, so every case here is a real behavioral guarantee.

import { describe, it, expect } from 'vitest'
import { computeReadiness, formatUnresolvedForCouncil } from '../lib/readiness'
import type { ExaminerResponseForReadiness } from '../lib/readiness'

function q(
  criticality: 'critical' | 'important' | 'optional' | null,
  answered: boolean,
  text = 'fixture question',
): ExaminerResponseForReadiness {
  return {
    question_text: text,
    response_text: answered ? 'a real answer' : null,
    criticality,
  }
}

describe('computeReadiness', () => {
  it('all answered → READY', () => {
    const result = computeReadiness([q('critical', true), q('important', true), q('optional', true)])
    expect(result.readiness).toBe('READY')
    expect(result.unresolvedCritical).toHaveLength(0)
    expect(result.unresolvedImportant).toHaveLength(0)
  })

  it('unresolved optional only → READY (optional never affects readiness)', () => {
    const result = computeReadiness([q('critical', true), q('important', true), q('optional', false)])
    expect(result.readiness).toBe('READY')
  })

  it('unresolved important, no critical → READY_WITH_CAVEATS', () => {
    const result = computeReadiness([q('critical', true), q('important', false)])
    expect(result.readiness).toBe('READY_WITH_CAVEATS')
    expect(result.unresolvedImportant).toHaveLength(1)
  })

  it('unresolved critical → NOT_READY, regardless of the others', () => {
    const result = computeReadiness([q('critical', false), q('important', true), q('optional', false)])
    expect(result.readiness).toBe('NOT_READY')
    expect(result.unresolvedCritical).toHaveLength(1)
  })

  it('critical AND important both unresolved → NOT_READY wins (critical takes priority)', () => {
    const result = computeReadiness([q('critical', false), q('important', false)])
    expect(result.readiness).toBe('NOT_READY')
    expect(result.unresolvedCritical).toHaveLength(1)
    expect(result.unresolvedImportant).toHaveLength(1)   // still reported, just not the deciding factor
  })

  it('whitespace-only response_text counts as unresolved, not answered', () => {
    const result = computeReadiness([{ question_text: 'x', response_text: '   ', criticality: 'critical' }])
    expect(result.readiness).toBe('NOT_READY')
  })

  it('null criticality (legacy rows predating PR1) never blocks — treated as optional', () => {
    const result = computeReadiness([q(null, false)])
    expect(result.readiness).toBe('READY')
  })

  it('empty responses array → READY (no questions were ever shown, e.g. REDIRECT path)', () => {
    const result = computeReadiness([])
    expect(result.readiness).toBe('READY')
  })
})

describe('formatUnresolvedForCouncil', () => {
  it('extracts question_text only, in order', () => {
    const unresolved = [q('important', false, 'What matters most here?'), q('important', false, 'Who else is affected?')]
    expect(formatUnresolvedForCouncil(unresolved)).toEqual([
      'What matters most here?',
      'Who else is affected?',
    ])
  })

  it('empty input → empty output', () => {
    expect(formatUnresolvedForCouncil([])).toEqual([])
  })
})
