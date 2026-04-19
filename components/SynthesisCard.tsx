'use client'

import { useEffect, useState, useRef } from 'react'

interface Props {
  sessionId: string
  decisionText: string
  contextText?: string
  personaResponses: Record<string, string>
  totalPersonas: number
  version: number
}

type State = 'waiting' | 'streaming' | 'done' | 'error'

export default function SynthesisCard({
  sessionId, decisionText, contextText,
  personaResponses, totalPersonas, version,
}: Props) {
  const [synthesis, setSynthesis] = useState('')
  const [state, setState]         = useState<State>('waiting')

  const completedCount = Object.keys(personaResponses).length
  const allDone        = completedCount >= totalPersonas

  // AbortController ref — lets cleanup cancel the fetch without touching state
  const abortRef    = useRef<AbortController | null>(null)
  // Refs for values needed inside async function (avoids stale closures)
  const responsesRef    = useRef(personaResponses)
  const decisionRef     = useRef(decisionText)
  const contextRef      = useRef(contextText)
  const sessionIdRef    = useRef(sessionId)

  useEffect(() => { responsesRef.current   = personaResponses }, [personaResponses])
  useEffect(() => { decisionRef.current    = decisionText     }, [decisionText])
  useEffect(() => { contextRef.current     = contextText      }, [contextText])
  useEffect(() => { sessionIdRef.current   = sessionId        }, [sessionId])

  // Reset and re-run when version bumps (pushback) or when allDone first becomes true
  // state is NOT a dep — changing state from inside run() would trigger cleanup+cancel
  useEffect(() => {
    if (!allDone) return

    // Cancel any in-flight request
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setSynthesis('')
    setState('streaming')

    const run = async () => {
      const latestResponses = responsesRef.current
      const personaBlock = Object.entries(latestResponses)
        .map(([key, content]) => {
          // Trim each response to first 800 chars to keep payload lean
          const trimmed = content.length > 800 ? content.slice(0, 800) + '…' : content
          return `[${key.toUpperCase().replace(/_/g, ' ')}]\n${trimmed}`
        })
        .join('\n\n---\n\n')

      const contextBlock = contextRef.current
        ? `\nCONTEXT:\n${contextRef.current}\n`
        : ''
      const userMessage =
        `DECISION: ${decisionRef.current}${contextBlock}\n\n` +
        `ADVISOR RESPONSES:\n\n${personaBlock}\n\n` +
        `Now produce the council synthesis.`

      try {
        const res = await fetch('/api/persona', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            sessionId: sessionIdRef.current,
            personaKey: 'synthesis',
            messages: [{ role: 'user', content: userMessage }],
            decisionText: decisionRef.current,
            contextText:  contextRef.current,
            rawMessages:  true,
          }),
        })

        if (!res.ok || !res.body) { setState('error'); return }

        const reader  = res.body.getReader()
        const decoder = new TextDecoder()
        let acc = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (controller.signal.aborted) return
          acc += decoder.decode(value, { stream: true })
          setSynthesis(acc)
        }
        setState('done')
      } catch (err: unknown) {
        // AbortError is expected when component unmounts or version changes — not an error
        if (err instanceof Error && err.name === 'AbortError') return
        setState('error')
      }
    }

    run()

    return () => { controller.abort() }
    // version in deps: re-fires when a pushback changes the council's position
    // allDone in deps: fires when the 6th persona completes
    // state deliberately NOT in deps to avoid the cancel-on-setState race condition
  }, [allDone, version]) // eslint-disable-line react-hooks/exhaustive-deps

  const isRecalibrating = state === 'streaming' && version > 0

  return (
    <div style={{
      gridColumn: '1 / -1',
      background: 'var(--bg-card)',
      border: `1px solid ${
        state === 'done'
          ? '#2a4a2e'
          : state === 'streaming'
          ? 'var(--gold-dim)'
          : 'var(--border-dim)'
      }`,
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
                : state === 'streaming' && isRecalibrating
                ? 'Recalibrating after pushback…'
                : state === 'streaming'
                ? 'Synthesising across all perspectives…'
                : 'What the council collectively surfaced'}
            </p>
          </div>
        </div>

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
            {isRecalibrating ? 'Recalibrating' : 'Synthesising'}
          </span>
        )}
        {state === 'done'  && <span style={{ fontSize: 11, color: '#4ade80' }}>✓ Complete</span>}
        {state === 'error' && <span style={{ fontSize: 11, color: '#e05050' }}>✗ Error</span>}
      </div>

      {/* Body */}
      <div style={{ padding: '18px 20px' }}>
        {state === 'waiting' && (
          <p style={{ fontSize: 13, color: 'var(--text-4)', fontStyle: 'italic' }}>
            Synthesis will appear once all six advisors complete their assessment.
          </p>
        )}
        {(state === 'streaming' || state === 'done') && synthesis && (
          <p
            style={{ fontSize: 14, lineHeight: 1.85, color: 'var(--text-1)', whiteSpace: 'pre-wrap', letterSpacing: '0.01em' }}
            className={state === 'streaming' ? 'cursor' : ''}
          >
            {synthesis}
          </p>
        )}
        {state === 'streaming' && !synthesis && (
          <p style={{ fontSize: 13, color: 'var(--text-4)', fontStyle: 'italic' }}>
            Reading all perspectives…
          </p>
        )}
        {state === 'error' && (
          <p style={{ fontSize: 13, color: '#e05050' }}>Synthesis failed. Advisor responses are still available below.</p>
        )}
      </div>
    </div>
  )
}
