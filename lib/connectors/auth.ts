import 'server-only'

// lib/connectors/auth.ts
// Same Bearer-token resolution app/api/chat-intake/route.ts already inlines
// (resolveUserId) — factored out here since v2 adds several more routes
// that need it (connectors, stakeholder outreach/input). Not a behavior
// change to chat-intake's own copy, which is left as-is rather than risk
// an unrelated refactor of a file already reviewed and shipped.

import { createClient } from '@/lib/supabase'

export async function resolveUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7).trim()
  if (!token) return null
  try {
    const anonClient = createClient()
    const { data: { user } } = await anonClient.auth.getUser(token)
    return user?.id ?? null
  } catch {
    return null
  }
}
