// tests/chat-intake-plan-parse.test.ts
// ── Natural Intake v7 — nothing the model returns is trusted until validated ──

import { describe, it, expect } from 'vitest'
import { parsePlannerOutput } from '../lib/chat-intake-plan-parse'

describe('parsePlannerOutput', () => {
  it('reads clean JSON', () => {
    const out = parsePlannerOutput(JSON.stringify({
      notes: { decisionKind: 'relocation', facts: { from_to: 'Pune to Berlin' } },
      answeredPending: true,
      next: { slotKey: 'who_moves', question: 'Would anyone move with you?', chips: ['Just me', 'A partner'] },
      playback: 'Here\u2019s what I\u2019ve got \u2014 Pune to Berlin. Did I get that right?',
      smartFriendQuestion: 'Do you speak German?',
    }))
    expect(out?.notes.decisionKind).toBe('relocation')
    expect(out?.notes.facts).toEqual({ from_to: 'Pune to Berlin' })
    expect(out?.answeredPending).toBe(true)
    expect(out?.next?.slotKey).toBe('who_moves')
    expect(out?.smartFriendQuestion).toMatch(/German/)
  })
  it('survives code fences, preamble and trailing commas (the old bare JSON.parse threw these away)', () => {
    const raw = 'Sure! ```json\n{ "notes": { "facts": { "role": "PM", }, }, "next": null, }\n```'
    expect(parsePlannerOutput(raw)?.notes.facts).toEqual({ role: 'PM' })
  })
  it('drops an invalid decision kind and junk fact keys instead of repairing them', () => {
    const out = parsePlannerOutput(JSON.stringify({ notes: { decisionKind: 'astrology', facts: { 'Bad Key!': 'x', role: 'PM' } } }))
    expect(out?.notes.decisionKind).toBeUndefined()
    expect(out?.notes.facts).toEqual({ role: 'PM' })
  })
  it('needs both a slot and a question for "next"', () => {
    expect(parsePlannerOutput(JSON.stringify({ notes: {}, next: { slotKey: 'role' } }))?.next).toBeNull()
  })
  it('returns null for garbage rather than throwing', () => {
    expect(parsePlannerOutput('I could not do that')).toBeNull()
    expect(parsePlannerOutput('')).toBeNull()
  })
})
