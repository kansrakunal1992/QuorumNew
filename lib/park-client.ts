// lib/park-client.ts
//
// "Park it for later" from anywhere on the client — the same two-path logic
// components/NextDecisionPrompt.tsx uses (signed-in → /api/watchlist; anonymous → held locally
// and filed by /auth/callback once they link an email), extracted so the chat's dependency gate
// (lib/chat-intake-gates.ts) can park a decision without duplicating it.

import { getAuthHeaders } from '@/lib/auth-headers'
import { addPendingPark } from '@/lib/pending-park'

export type ParkResult = 'saved' | 'pending' | 'error'

export async function parkText(text: string): Promise<ParkResult> {
  const t = text.trim().slice(0, 500)
  if (!t) return 'error'
  try {
    const auth = await getAuthHeaders()
    if (auth.Authorization) {
      const res = await fetch('/api/watchlist', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body:    JSON.stringify({ text: t }),
      })
      return res.ok ? 'saved' : 'error'
    }
  } catch { /* fall through to the local hold */ }
  addPendingPark(t)
  return 'pending'
}

/** What gets parked when the person chooses "park this until I've decided that". */
export function dependencyParkText(decisionStatement: string | null | undefined, dependsOn: string): string {
  const base = (decisionStatement ?? '').replace(/\s+/g, ' ').trim()
  const head = base || 'A decision I was working through'
  return `${head} \u2014 on hold until I decide: ${dependsOn}`
}
