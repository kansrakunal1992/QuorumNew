// tests/intake-sprint2.test.ts
// ── Natural Intake v9 / Sprint 2 — analytics privacy guard + small helpers ────
import { describe, it, expect } from 'vitest'
import { isIntakeEvent, sanitizeIntakeProps } from '../lib/event-props'
import { buildCardGroup, cardAnsweredProps, cardShownProps, metaFor, viewportBucket } from '../lib/chat-intake-cards'
import { slotSpec } from '../lib/chat-intake-brief'

const group = () => buildCardGroup({ kind: 'career_exit', slot: slotSpec('career_exit', 'why_now')!, question: 'Q?', modelChips: ['Burnout or unhappiness', 'My manager Priya left', 'A new idea'] })!

describe('server-side allowlist for intake events', () => {
  it('keeps every prop the real builders emit (so the guard cannot silently blind the funnel)', () => {
    const g = group()
    const shown = cardShownProps(g, 2)
    const answered = cardAnsweredProps(g, metaFor(g, { selectedIds: ['why_now.burnout', 'why_now.a1'], freeText: 'secret', special: null }), 2, 4200)
    expect(Object.keys(sanitizeIntakeProps('intake_card_group_shown', shown))).toEqual(Object.keys(shown))
    expect(Object.keys(sanitizeIntakeProps('intake_card_answered', answered))).toEqual(Object.keys(answered))
  })
  it('drops free text, labels, names and unknown keys even if a caller passes them', () => {
    const out = sanitizeIntakeProps('intake_card_answered', {
      question_id: 'career_exit.why_now', selected_count: 2,
      free_text: 'my employer is Acme Corp', label: 'Burnout or unhappiness', note: 'x',
      reason: 'I want to quit because my boss yelled at me',      // allowed KEY, but a sentence -> dropped
      option_ids: 'why_now.burnout,why_now.adaptive',
    })
    expect(out).toEqual({ question_id: 'career_exit.why_now', selected_count: 2, option_ids: 'why_now.burnout,why_now.adaptive' })
  })
  it('leaves other events (and their existing props) untouched', () => {
    const props = { signed_in: true, anything: 'with spaces is fine here' }
    expect(isIntakeEvent('decision_checkpointed')).toBe(false)
    expect(sanitizeIntakeProps('decision_checkpointed', props)).toBe(props)
  })
  it('covers the launch-requested / execution-started pair and the feedback event', () => {
    expect(isIntakeEvent('council_launch_requested')).toBe(true)
    expect(isIntakeEvent('council_execution_started')).toBe(true)
    expect(sanitizeIntakeProps('intake_summary_feedback', { captured: 'partly', text: 'because...' })).toEqual({ captured: 'partly' })
  })
})

describe('viewport bucket', () => {
  it('is "unknown" outside a browser (never throws on the server)', () => { expect(viewportBucket()).toBe('unknown') })
})
