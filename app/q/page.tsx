// app/q/page.tsx
// -- Phase 3/4 (retention work): a short, bookmarkable "bring me a decision" door --
// /q opens the home screen with the chat input focused (ChatIntake reads ?q=1).
// Meant for the home-screen icon, a bookmark, or a link in a weekly email --
// somewhere the person lands because they have something on their mind right now.
//
// Phase 4: forwards ?n=<source> (our email links add it) so
// NotificationLandingTracker still sees which email brought the person here.
// Only allow-listed values are forwarded.

import { redirect } from 'next/navigation'
import { parseNotificationSource } from '@/lib/notification-source'

export default async function QuickEntry({ searchParams }: { searchParams: Promise<{ n?: string | string[] }> }) {
  const { n } = await searchParams
  const source = parseNotificationSource(Array.isArray(n) ? n[0] : n)
  redirect(source ? `/?q=1&n=${source}` : '/?q=1')
}
