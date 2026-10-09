// lib/auth-headers.ts
// -- Phase 0 (retention work) -------------------------------------------------
// Returns { Authorization: 'Bearer <token>' } for the current Supabase session,
// or {} when there is none.
//
// Why this exists: components/ChatIntake.tsx and components/DecisionCheckpoint.tsx
// previously called /api/chat-intake and /api/chat-intake/checkpoint without an
// Authorization header, so chat_intakes and sessions were created with
// user_id = null even for signed-in people (only the prediction call sent the
// token). Reading the token fresh at call time (instead of from React state)
// also avoids a race where a prop/state value has not populated yet.

import { createClient } from '@/lib/supabase'

export async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
  } catch {
    return {}
  }
}
