'use client'

import { useEffect, useState, useCallback } from 'react'
import type { PersonaMeta, Message } from '@/lib/types'

interface Props {
  persona: PersonaMeta
  sessionId: string
  decisionText: string
  contextText?: string
}

type PanelState = 'idle' | 'streaming' | 'done' | 'error'

export default function PersonaPanel({
  persona,
  sessionId,
  decisionText,
  contextText,
}: Props) {
  const [response, setResponse] = useState('')
  const [panelState, setPanelState] = useState<PanelState>('idle')
  const [messages, setMessages] = useState<Message[]>([])
  const [pushback, setPushback] = useState('')
  const [showPushback, setShowPushback] = useState(false)
  const [isPushingBack, setIsPushingBack] = useState(false)
  const [pushbackHistory, setPushbackHistory] = useState<
    { user: string; reply: string }[]
  >([])

  const streamResponse = useCallback(
    async (msgs: Message[], isFirstLoad: boolean) => {
      setPanelState('streaming')
      if (isFirstLoad) setResponse('')

      try {
        const res = await fetch('/api/persona', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            personaKey: persona.key,
            messages: msgs,
            decisionText,
            contextText,
          }),
        })

        if (!res.ok || !res.body) {
          setPanelState('error')
          setResponse('Failed to load response. Check your API key.')
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let accumulated = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          accumulated += chunk
          if (isFirstLoad) {
            setResponse(accumulated)
          }
        }

        if (!isFirstLoad) {
          setPushbackHistory((prev) => [
            ...prev,
            { user: msgs[msgs.length - 1].content, reply: accumulated },
          ])
          setIsPushingBack(false)
        }

        setPanelState('done')
      } catch {
        setPanelState('error')
        setResponse('Connection error. Please try again.')
      }
    },
    [sessionId, persona.key, decisionText, contextText]
  )

  useEffect(() => {
    streamResponse([], true)
  }, [streamResponse])

  const handlePushback = async () => {
    if (!pushback.trim()) return
    const userMsg: Message = {
      persona: persona.key,
      role: 'user',
      content: pushback.trim(),
    }
    const updatedMessages = [...messages, userMsg]
    setMessages(updatedMessages)
    setPushback('')
    setShowPushback(false)
    setIsPushingBack(true)
    await streamResponse(updatedMessages, false)
  }

  const cardClass = `persona-card ${
    panelState === 'streaming' ? 'streaming' : panelState === 'done' ? 'done' : ''
  } flex flex-col h-full`

  return (
    <div className={cardClass}>
      {/* Header */}
      <div
        className="px-4 py-3 flex items-center justify-between"
        style={{ borderBottom: '1px solid #131d36' }}
      >
        <div>
          <p className="text-sm font-semibold" style={{ color: '#d4a843' }}>
            {persona.label}
          </p>
          <p className="text-xs" style={{ color: '#4a5568' }}>
            {persona.tagline}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {panelState === 'streaming' && (
            <span className="text-xs" style={{ color: '#d4a843' }}>
              ▸ reading
            </span>
          )}
          {panelState === 'done' && (
            <span className="text-xs" style={{ color: '#2a5c3a' }}>
              ✓ done
            </span>
          )}
          {panelState === 'error' && (
            <span className="text-xs" style={{ color: '#e05050' }}>
              ✗ error
            </span>
          )}
        </div>
      </div>

      {/* Response body */}
      <div className="flex-1 px-4 py-4 overflow-y-auto" style={{ maxHeight: '360px' }}>
        {/* Initial response */}
        {response && (
          <p
            className={`persona-response ${
              panelState === 'streaming' ? 'cursor' : ''
            }`}
          >
            {response}
          </p>
        )}

        {/* Pushback exchange history */}
        {pushbackHistory.map((exchange, i) => (
          <div key={i} className="mt-4">
            <div
              className="rounded-lg px-3 py-2 mb-2"
              style={{ background: '#080d1a', border: '1px solid #131d36' }}
            >
              <p className="text-xs mb-1" style={{ color: '#4a5568' }}>
                Your pushback
              </p>
              <p className="text-sm" style={{ color: '#8892a4' }}>
                {exchange.user}
              </p>
            </div>
            <p className="persona-response">{exchange.reply}</p>
          </div>
        ))}

        {/* Live pushback streaming */}
        {isPushingBack && (
          <div className="mt-4">
            <p className="text-xs mb-2" style={{ color: '#4a5568' }}>
              Responding to your pushback…
            </p>
          </div>
        )}

        {/* Empty state */}
        {panelState === 'idle' && (
          <div className="flex items-center justify-center h-full py-8">
            <div
              className="w-4 h-4 rounded-full animate-pulse"
              style={{ background: '#1a2645' }}
            />
          </div>
        )}
      </div>

      {/* Footer — pushback */}
      {panelState === 'done' && !isPushingBack && (
        <div
          className="px-4 pb-4 pt-2"
          style={{ borderTop: '1px solid #0d1426' }}
        >
          {!showPushback ? (
            <button
              className="btn-pushback"
              onClick={() => setShowPushback(true)}
            >
              ↩ Push back
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <textarea
                rows={2}
                placeholder="Challenge this or add information…"
                value={pushback}
                onChange={(e) => setPushback(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    handlePushback()
                  }
                }}
              />
              <div className="flex gap-2">
                <button className="btn-primary" style={{ padding: '6px 16px', fontSize: '12px' }} onClick={handlePushback}>
                  Send
                </button>
                <button
                  className="btn-ghost"
                  onClick={() => {
                    setShowPushback(false)
                    setPushback('')
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
