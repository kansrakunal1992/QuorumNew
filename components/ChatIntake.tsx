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
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { getStoredUserEmail } from '@/lib/storage'
import DecisionStarters from '@/components/DecisionStarters'
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
  const [hasEmail, setHasEmail] = useState(false)
  const inputRef  = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Top-bar identity affordance only — doesn't gate anything here. "Sign in"
  // for an anonymous visitor, "Mirror" once an email is on file; both just
  // link to /mirror, which already owns its own AuthGate (see docs note in
  // NaturalIntakeClient.tsx about Screen 10 — sign-in stays deferred there).
  useEffect(() => { setHasEmail(!!getStoredUserEmail()) }, [])

  // True once the user has sent at least one message — switches the screen
  // from the branded "front door" hero (headline + example chips) into the
  // scrolling conversation thread. Same underlying bubbles array either way.
  const started = bubbles.some(b => b.role === 'user')

  function handleStarterPick(text: string) {
    setInput(text)
    inputRef.current?.focus()
  }

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
      {/* ── Front door — restrained brand bar, not a marketing header ────
          Both pieces sit left-aligned, deliberately clear of the top-right
          corner: ThemeToggle (globals.css .theme-toggle) is fixed at
          top:18/right:20 across the whole app, so nothing here competes
          with it for that space. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '16px 20px 0',
      }}>
        <span style={{
          fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 500,
          letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--gold)',
        }}>
          Quorum
        </span>
        <span style={{ width: 1, height: 14, background: 'var(--border-dim)' }} />
        <Link href="/mirror" style={{
          fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '0.05em',
          color: 'var(--text-3)', textDecoration: 'none',
        }}>
          {hasEmail ? 'Mirror' : 'Sign in'}
        </Link>
      </div>

      {/* Quiet, non-numeric progress — a dot trail, never "3 of 6". Only
          appears once the conversation is actually under way. */}
      {started && (
        <div style={{ display: 'flex', gap: 5, justifyContent: 'center', padding: '14px 0 4px' }}>
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
      )}

      {started ? (
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
      ) : (
        /* ── Hero — "Quorum is ready to think with me," not a blank chatbot.
            Same opening line as the chat thread, just given real brand
            presence: display type, a kicker, and three example chips
            (never a full product tour). Replaced by the thread above the
            moment the user sends their first message. ── */
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          textAlign: 'center', padding: '24px 28px', gap: 22,
        }}>
          <div>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.16em',
              textTransform: 'uppercase', color: 'var(--text-4)', margin: '0 0 14px',
            }}>
              Private decision intelligence
            </p>
            <h1 style={{
              fontFamily: 'var(--font-display)', fontWeight: 400,
              fontSize: 'clamp(24px, 6vw, 32px)', lineHeight: 1.28,
              color: 'var(--text-1)', margin: 0, maxWidth: 440,
            }}>
              {bubbles[0]?.content || "What's going on?"}
            </h1>
          </div>

          <div style={{ width: '100%', maxWidth: 420 }}>
            <DecisionStarters compact label="Try an example" onPick={handleStarterPick} />
          </div>

          <p style={{ fontSize: 11.5, color: 'var(--text-4)', letterSpacing: '0.02em', margin: 0 }}>
            Private · nothing is shared without your permission
          </p>
        </div>
      )}

      {/* Input — its own row, full width; voice and send sit below it on a
          second row so neither crowds the other on narrow screens. */}
      <form
        onSubmit={e => { e.preventDefault(); send(input) }}
        style={{
          display: 'flex', flexDirection: 'column', gap: 8,
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
            width: '100%', resize: 'none', maxHeight: 120, padding: '11px 14px',
            borderRadius: 14, border: '1px solid var(--border-mid)',
            background: 'var(--bg-inset)', color: 'var(--text-1)',
            fontSize: 16, fontFamily: 'var(--font-body)',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <VoiceInput compact onTranscript={(t: string) => setInput(prev => (prev ? `${prev} ${t}` : t))} />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            style={{
              flex: 1, maxWidth: 140, padding: '11px 18px', borderRadius: 14, border: 'none',
              background: input.trim() ? 'var(--gold)' : 'var(--border-dim)',
              color: input.trim() ? 'var(--bg-void)' : 'var(--text-4)',
              fontWeight: 600, fontSize: 15, cursor: input.trim() ? 'pointer' : 'default',
            }}
          >
            Send
          </button>
        </div>
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
