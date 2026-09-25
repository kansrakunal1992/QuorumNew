'use client'

// components/ChatIntake.tsx
// ── Natural Intake (v1) — the chat screen ─────────────────────────────────────
//
// Design rules locked in docs/COPY_AND_STRUCTURE_LOCK_v1.md:
//   - No setup screen: cursor active in the input the instant this mounts.
//   - One decision on screen at a time — a single input, a single send action.
//   - No internal jargon ever reaches this component's copy.
//   - Progress is a quiet, non-numeric dot trail — never "3 of 6".
//   - Replies arrive as a brief typewriter reveal, not a spinner-then-block —
//     true token streaming is a fast-follow (see docs/CHANGELOG_v1.md); this
//     is the visual approximation for v1.
//
// A brand-new file — HomeClient.tsx and SessionView.tsx are not touched.

import { useEffect, useRef, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
const VoiceInput = dynamic(() => import('@/components/VoiceInput'), { ssr: false })

interface ChatBubble {
  role:    'user' | 'quorum'
  content: string
}

interface ChatIntakeProps {
  chatIntakeId:          string | null
  deviceId:              string
  grantExtraExchanges:   boolean
  onChatIntakeId:        (id: string) => void
  onReadyToReflect:      (chatIntakeId: string) => void
}

function TypewriterLine({ text }: { text: string }) {
  const [shown, setShown] = useState('')
  useEffect(() => {
    setShown('')
    let i = 0
    const id = setInterval(() => {
      i += 2
      setShown(text.slice(0, i))
      if (i >= text.length) clearInterval(id)
    }, 14)
    return () => clearInterval(id)
  }, [text])
  return <>{shown}</>
}

export default function ChatIntake({
  chatIntakeId,
  deviceId,
  grantExtraExchanges,
  onChatIntakeId,
  onReadyToReflect,
}: ChatIntakeProps) {
  const [bubbles, setBubbles]   = useState<ChatBubble[]>([])
  const [input, setInput]       = useState('')
  const [sending, setSending]   = useState(false)
  const [exchangeCount, setExchangeCount] = useState(0)
  const inputRef  = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // ── Opening line — no chat exists yet, no DB round trip needed ────────────
  useEffect(() => {
    if (chatIntakeId) return
    fetch('/api/chat-intake')
      .then(r => r.json())
      .then(d => setBubbles([{ role: 'quorum', content: d.openingLine }]))
      .catch(() => setBubbles([{ role: 'quorum', content: "What's going on?" }]))
    inputRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [bubbles, sending])

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || sending) return

    setBubbles(prev => [...prev, { role: 'user', content: trimmed }])
    setInput('')
    setSending(true)

    try {
      const res = await fetch('/api/chat-intake', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatIntakeId,
          message:        trimmed,
          deviceId,
          extraExchanges: grantExtraExchanges,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Chat failed')

      if (!chatIntakeId) onChatIntakeId(data.chatIntakeId)
      setExchangeCount(data.exchangeCount)
      setBubbles(prev => [...prev, { role: 'quorum', content: data.quorumReply }])

      if (data.readyToReflect) {
        // Small pause so the closing line is readable before the screen
        // transitions — this isn't a dead end, it's a handoff.
        setTimeout(() => onReadyToReflect(data.chatIntakeId ?? chatIntakeId!), 900)
      }
    } catch (err) {
      console.error('[ChatIntake] send failed:', err)
      setBubbles(prev => [...prev, { role: 'quorum', content: "Sorry — something slipped. Try that again?" }])
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }, [chatIntakeId, deviceId, grantExtraExchanges, sending, onChatIntakeId, onReadyToReflect])

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        maxWidth: 640,
        margin: '0 auto',
        width: '100%',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {/* Quiet, non-numeric progress — a dot trail, never "3 of 6" */}
      <div style={{ display: 'flex', gap: 5, justifyContent: 'center', padding: '18px 0 4px' }}>
        {Array.from({ length: Math.min(exchangeCount + 1, 6) }).map((_, i) => (
          <div
            key={i}
            style={{
              width: 5, height: 5, borderRadius: 999,
              background: i <= exchangeCount ? 'var(--gold)' : 'var(--border-dim)',
              transition: 'background 0.4s ease',
            }}
          />
        ))}
      </div>

      <div
        ref={scrollRef}
        style={{ flex: 1, overflowY: 'auto', padding: '12px 20px 8px', display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        {bubbles.map((b, i) => (
          <div
            key={i}
            style={{
              alignSelf:  b.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth:   '82%',
              padding:    '11px 15px',
              borderRadius: 16,
              fontSize:   15.5,
              lineHeight: 1.5,
              background: b.role === 'user' ? 'var(--gold-dim)' : 'var(--bg-card)',
              color:      'var(--text-1)',
              border:     b.role === 'quorum' ? '1px solid var(--border-dim)' : 'none',
            }}
          >
            {b.role === 'quorum' && i === bubbles.length - 1 && !sending
              ? <TypewriterLine text={b.content} />
              : b.content}
          </div>
        ))}
        {sending && (
          <div style={{ alignSelf: 'flex-start', display: 'flex', gap: 4, padding: '11px 15px' }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                width: 6, height: 6, borderRadius: 999, background: 'var(--text-4)',
                animation: `chatDotPulse 1.1s ${i * 0.15}s infinite ease-in-out`,
              }} />
            ))}
          </div>
        )}
      </div>

      <form
        onSubmit={e => { e.preventDefault(); send(input) }}
        style={{
          display: 'flex', gap: 8, alignItems: 'flex-end',
          padding: '10px 16px calc(14px + env(safe-area-inset-bottom, 0px))',
          borderTop: '1px solid var(--border-dim)',
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
          }}
          placeholder="Type here…"
          rows={1}
          style={{
            flex: 1, resize: 'none', maxHeight: 120, padding: '11px 14px',
            borderRadius: 14, border: '1px solid var(--border-mid)',
            background: 'var(--bg-inset)', color: 'var(--text-1)',
            fontSize: 16, fontFamily: 'var(--font-body)',
          }}
        />
        <VoiceInput onTranscript={(t: string) => setInput(prev => (prev ? `${prev} ${t}` : t))} />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          style={{
            padding: '11px 18px', borderRadius: 14, border: 'none',
            background: input.trim() ? 'var(--gold)' : 'var(--border-dim)',
            color: input.trim() ? 'var(--bg-void)' : 'var(--text-4)',
            fontWeight: 600, fontSize: 15, cursor: input.trim() ? 'pointer' : 'default',
          }}
        >
          Send
        </button>
      </form>

      <style jsx>{`
        @keyframes chatDotPulse {
          0%, 60%, 100% { opacity: 0.25; transform: translateY(0); }
          30% { opacity: 1; transform: translateY(-2px); }
        }
      `}</style>
    </div>
  )
}
