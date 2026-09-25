'use client'

// app/NaturalIntakeClient.tsx
// ── Natural Intake (v1) — the new front door ──────────────────────────────────
//
// Rendered by app/page.tsx instead of HomeClient when
// NEXT_PUBLIC_NATURAL_INTAKE_ENABLED is on. HomeClient.tsx is not imported
// or modified here — the two are fully independent, so nothing in the
// classic form's 2,000+ lines is at risk from this addition.
//
// Owns only the phase transition (chat → checkpoint) and the identity bits
// every session needs (device id, optional email) — reusing the same
// storage helpers HomeClient.tsx already uses, not a second implementation.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getOrCreateDeviceId } from '@/lib/storage'
import ChatIntake from '@/components/ChatIntake'
import DecisionCheckpoint from '@/components/DecisionCheckpoint'

type Phase = 'chat' | 'checkpoint'

export default function NaturalIntakeClient() {
  const router = useRouter()
  const [phase, setPhase]               = useState<Phase>('chat')
  const [chatIntakeId, setChatIntakeId] = useState<string | null>(null)
  const [grantExtra, setGrantExtra]     = useState(false)

  const deviceId = typeof window !== 'undefined' ? getOrCreateDeviceId() : ''

  function handleReadyToReflect(id: string) {
    setChatIntakeId(id)
    setPhase('checkpoint')
  }

  function handleBackToChat() {
    // "Let me add more" — same chat_intake, a few extra exchanges (plan
    // section 4E's "Keep thinking", scoped in v1 to the pre-session
    // reflection step — see docs/CHANGELOG_v1.md for why).
    setGrantExtra(true)
    setPhase('chat')
  }

  function handleSessionCreated(sessionId: string) {
    router.push(`/session/${sessionId}`)
  }

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-void)',
        color: 'var(--text-1)',
        fontFamily: 'var(--font-body)',
      }}
    >
      {phase === 'chat' && (
        <ChatIntake
          chatIntakeId={chatIntakeId}
          deviceId={deviceId}
          grantExtraExchanges={grantExtra}
          onChatIntakeId={setChatIntakeId}
          onReadyToReflect={handleReadyToReflect}
        />
      )}
      {phase === 'checkpoint' && chatIntakeId && (
        <DecisionCheckpoint
          chatIntakeId={chatIntakeId}
          onBackToChat={handleBackToChat}
          onSessionCreated={handleSessionCreated}
        />
      )}
    </main>
  )
}
