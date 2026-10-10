'use client'

// components/NotificationLandingTracker.tsx
// -- Phase 4 (retention work): "did the email actually bring them back?" -------
// Mounted once in app/layout.tsx. When a visit arrives with ?n=<source> (our
// email links add it -- see lib/notification-source.ts):
//   1. logs `notification_opened` (once per tab session per source),
//   2. remembers the source for the tab session so ChatIntake can log
//      `notification_to_decision` if this visit goes on to start a decision,
//   3. strips ?n= from the address bar so a refresh/share does not repeat it.
// Renders nothing. Never affects the page.

import { useEffect } from 'react'
import { parseNotificationSource } from '@/lib/notification-source'
import { track } from '@/lib/track'

export const FROM_NOTIFICATION_KEY = 'quorum_from_notification'

export default function NotificationLandingTracker() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const raw = params.get('n')
      if (raw === null) return
      const source = parseNotificationSource(raw)

      params.delete('n')
      const qs = params.toString()
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash)

      if (!source) return
      sessionStorage.setItem(FROM_NOTIFICATION_KEY, source)
      const seenKey = `quorum_notif_opened_${source}`
      if (sessionStorage.getItem(seenKey)) return
      sessionStorage.setItem(seenKey, '1')
      track('notification_opened', { source })
    } catch { /* analytics only */ }
  }, [])
  return null
}
