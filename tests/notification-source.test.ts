import { describe, it, expect } from 'vitest'
import { parseNotificationSource, NOTIFICATION_SOURCES } from '../lib/notification-source'

describe('parseNotificationSource', () => {
  it('accepts every allow-listed source', () => {
    NOTIFICATION_SOURCES.forEach(s => expect(parseNotificationSource(s)).toBe(s))
  })
  it('is case/whitespace tolerant', () => {
    expect(parseNotificationSource('  Weekly_Brief ')).toBe('weekly_brief')
  })
  it('rejects anything else', () => {
    expect(parseNotificationSource('daily_nudge')).toBeNull()
    expect(parseNotificationSource('<script>')).toBeNull()
    expect(parseNotificationSource(null)).toBeNull()
    expect(parseNotificationSource(42)).toBeNull()
  })
})
