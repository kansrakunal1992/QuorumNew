'use client'

import { useEffect, useState } from 'react'

interface Props {
  sessionId: string
  decisionText: string
  contextText?: string
  personaResponses: Record<string, string>  // key → completed response text
  totalPersonas: number
}

type State = 'waiting' | 'streaming' | 'done' | 'error'

export default function SynthesisCard({ sessionId, decisionText, contextText, personaResponses, totalPersonas }: Props) {
  const [synthesis, setSynthesis] = useState('')
  const [state, setState]         = useState<State>('waiting')
  const completedCount = Object.keys(personaResponses).length
  const allDone = completedCount >= totalPersonas

  useEffect(() => {
    if (!allDone || state !== 'waiting') return

    const run = async () => {
      setState('streaming')

      // Build the user message: decision + all 6 persona outputs
      const personaBlock = Object.entries(personaResponses)
        .map(([key, content]) => `[${key.toUpperCase().replace('_', ' ')}]\n${content}`)
        .join('\n\n---\n\n')

      const contextBlock = contextText ? `\nCONTEXT:\n${contextText}\n` : ''

      const userMessage =
        `DECISION: ${decisionText}${contextBlock}\n\n` +
        `ADVISOR RESPONSES:\n\n${personaBlock}\n\n` +
        `Now produce the council synthesis.`

      try {
        const res = await fetch('/api/persona', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            personaKey: 'synthesis',
            messages: [{ role: 'user', content: userMessage }],
            decisionText,
            contextText,
            // Signal to API that messages[0] IS the full user turn (don't rebuild)
            rawMessages: true,
          }),
        })

        if (!res.ok || !res.body) { setState('error'); return }

        const reader  = res.body.getReader()
        const decoder = new TextDecoder()
        let acc = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          acc += decoder.decode(value, { stream: true })
          setSynthesis(acc)
        }
        setState('done')
      } catch {
        setState('error')
      }
    }

    run()
  }, [allDone, state, sessionId, decisionText, contextText, personaResponses])

  return (
    <div style={{
      gridColumn: '1 / -1',  // full width across the grid
      background: 'var(--bg-card)',
      border: `1px solid ${state === 'done' ? '#2a4a2e' : state === 'streaming' ? 'var(--gold-dim)' : 'var(--border-dim)'}`,
      borderRadius: 14,
      marginBottom: 4,
      overflow: 'hidden',
      transition: 'border-color 0.3s',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px 12px',
        borderBottom: '1px solid var(--border-dim)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: state === 'done' ? 'rgba(26,58,34,0.5)' : 'rgba(201,168,76,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Scale icon */}
          <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gold)', flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v18M3 9l9-6 9 6M5 12l-2 5h4L5 12zM19 12l-2 5h4l-2-5zM3 21h18"/>
            </svg>
          </div>
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--gold)', lineHeight: 1.2, letterSpacing: '0.04em' }}>
              Council Synthesis
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>
              {state === 'waiting'
                ? `Waiting for advisors — ${completedCount} of ${totalPersonas} complete`
                : state === 'streaming'
                ? 'Synthesising across all perspectives…'
                : 'What the council collectively surfaced'}
            </p>
          </div>
        </div>

        {/* Status */}
        {state === 'waiting' && (
          <div style={{ display: 'flex', gap: 4 }}>
            {Array.from({ length: totalPersonas }).map((_, i) => (
              <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: i < completedCount ? 'var(--gold)' : 'var(--border-mid)', transition: 'background 0.3s' }} />
            ))}
          </div>
        )}
        {state === 'streaming' && (
          <span style={{ fontSize: 11, color: 'var(--gold)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)', display: 'inline-block', animation: 'blink 1s step-end infinite' }} />
            Synthesising
          </span>
        )}
        {state === 'done' && <span style={{ fontSize: 11, color: '#4ade80' }}>✓ Complete</span>}
        {state === 'error' && <span style={{ fontSize: 11, color: '#e05050' }}>✗ Error</span>}
      </div>

      {/* Body */}
      <div style={{ padding: '18px 20px' }}>
        {state === 'waiting' && (
          <p style={{ fontSize: 13, color: 'var(--text-4)', fontStyle: 'italic' }}>
            Synthesis will appear here once all six advisors have completed their assessment.
          </p>
        )}
        {(state === 'streaming' || state === 'done') && synthesis && (
          <p style={{ fontSize: 14, lineHeight: 1.85, color: 'var(--text-1)', whiteSpace: 'pre-wrap', letterSpacing: '0.01em' }}
            className={state === 'streaming' ? 'cursor' : ''}>
            {synthesis}
          </p>
        )}
        {state === 'error' && (
          <p style={{ fontSize: 13, color: '#e05050' }}>Synthesis failed. The advisor responses are still available below.</p>
        )}
      </div>
    </div>
  )
}
