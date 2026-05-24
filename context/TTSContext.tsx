'use client'

import { createContext, useContext } from 'react'
import { useSonioxTTS } from '@/hooks/useSonioxTTS'
import type { SonioxTTSHook } from '@/hooks/useSonioxTTS'

// ─── Context ──────────────────────────────────────────────────────────────────

const TTSContext = createContext<SonioxTTSHook | null>(null)

// ─── Provider — mount once in app/session/[id]/page.tsx ───────────────────────
// Do NOT mount at app layout level — TTS is council-screen only.

export function TTSProvider({ children }: { children: React.ReactNode }) {
  const tts = useSonioxTTS()
  return <TTSContext.Provider value={tts}>{children}</TTSContext.Provider>
}

// ─── Hook — use in SynthesisCard and PersonaPanel ─────────────────────────────

export function useTTSContext(): SonioxTTSHook {
  const ctx = useContext(TTSContext)
  if (!ctx) throw new Error('useTTSContext must be used inside <TTSProvider>')
  return ctx
}
