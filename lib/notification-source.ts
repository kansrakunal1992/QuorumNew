// lib/notification-source.ts
// -- Phase 4 (retention work): which email/push brought someone back ----------
// Links in our emails carry ?n=<source>. components/NotificationLandingTracker.tsx
// reads it on arrival to log `notification_opened`, and ChatIntake logs
// `notification_to_decision` if that visit then starts a decision -- the two
// events that turn "emails sent" (from notification_log) into a funnel.
//
// Deliberately NOT utm_*: those feed signup attribution (lib/storage.ts
// captureUtm -> /api/auth), and a returning user clicking an email must not
// overwrite how they were first acquired. Pure + allow-listed so an arbitrary
// ?n= value can never be written into analytics.

export const NOTIFICATION_SOURCES = [
  'weekly_brief',
  'pattern_notice',
  'review_date',
] as const

export type NotificationSource = (typeof NOTIFICATION_SOURCES)[number]

export function parseNotificationSource(raw: unknown): NotificationSource | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase()
  return (NOTIFICATION_SOURCES as readonly string[]).includes(v) ? (v as NotificationSource) : null
}
