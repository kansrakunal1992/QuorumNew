// hooks/useSoniox.ts
// Sprint 22a — real-time STT via SSE + chunked audio POST
// ─────────────────────────────────────────────────────────────────────────────
// State machine:
//   idle → requesting → ready → recording → finalizing → done | error
//
// Token handling (corrected per Soniox docs):
//   finalText   — accumulated final tokens (is_final: true), shown in textarea
//   partialText — REPLACED on every batch response (never accumulated)
//
// Fixes vs earlier draft:
//   • 'batch' event type (not 'token') — aligns with batch SSE from server
//   • partialText replaced per batch (Soniox docs: "reset on every response")
//   • errorType strings match Soniox's actual error_type field
// ─────────────────────────────────────────────────────────────────────────────

'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

export type VoiceState =
  | 'idle'
  | 'requesting'   // awaiting mic permission
  | 'ready'        // SSE open + Soniox WS connected
  | 'recording'    // audio streaming
  | 'finalizing'   // MediaRecorder stopped, awaiting remaining final tokens
  | 'done'
  | 'error'

export type VoiceErrorCode =
  | 'PERMISSION_DENIED'
  | 'NO_MICROPHONE'
  | 'BROWSER_UNSUPPORTED'
  | 'NETWORK_ERROR'
  | 'SESSION_NOT_FOUND'
  | 'STT_NOT_CONFIGURED'
  | 'STT_QUOTA_EXCEEDED'
  | 'STT_PROVIDER_DOWN'
  | 'EMPTY_TRANSCRIPT'
  | 'UNKNOWN'

export interface UseSonioxReturn {
  state:        VoiceState
  finalText:    string
  partialText:  string
  errorCode:    VoiceErrorCode | null
  amplitudeRef: React.MutableRefObject<number>
  start:        () => Promise<void>
  stop:         () => void
  reset:        () => void
}

// Map Soniox error_type strings (stable) to typed VoiceErrorCode
function mapErrorType(errorType: string): VoiceErrorCode {
  switch (errorType) {
    case 'authentication_error':
    case 'invalid_api_key':
    case 'STT_NOT_CONFIGURED':
      return 'STT_NOT_CONFIGURED'
    case 'quota_exceeded':
    case 'rate_limit_exceeded':
      return 'STT_QUOTA_EXCEEDED'
    case 'service_unavailable':
    case 'model_not_available':
    case 'ws_error':
      return 'STT_PROVIDER_DOWN'
    case 'SESSION_NOT_FOUND':
      return 'SESSION_NOT_FOUND'
    case 'NETWORK_ERROR':
      return 'NETWORK_ERROR'
    default:
      return 'UNKNOWN'
  }
}

export function useSoniox(): UseSonioxReturn {
  const [state,       setState]       = useState<VoiceState>('idle')
  const [finalText,   setFinalText]   = useState('')
  const [partialText, setPartialText] = useState('')
  const [errorCode,   setErrorCode]   = useState<VoiceErrorCode | null>(null)

  const sessionIdRef     = useRef<string>('')
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef        = useRef<MediaStream | null>(null)
  const audioCtxRef      = useRef<AudioContext | null>(null)
  const amplitudeRef     = useRef<number>(0)
  const animFrameRef     = useRef<number>(0)
  const eventSourceRef   = useRef<EventSource | null>(null)
  const finalTextRef     = useRef<string>('')
  const mountedRef       = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; teardown() }
  }, [])

  // ── Tear down all infra ─────────────────────────────────────────────────
  const teardown = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    try { audioCtxRef.current?.close() } catch { /* ignore */ }
    streamRef.current   = null
    audioCtxRef.current = null
    amplitudeRef.current = 0
    try {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop()
      }
    } catch { /* ignore */ }
    mediaRecorderRef.current = null
    eventSourceRef.current?.close()
    eventSourceRef.current = null
  }, [])

  // ── Amplitude animation loop ────────────────────────────────────────────
  const startAmplitudeLoop = useCallback((analyser: AnalyserNode) => {
    const buf = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      analyser.getByteTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) {
        const n = (buf[i] - 128) / 128
        sum += n * n
      }
      amplitudeRef.current = Math.min(1, Math.sqrt(sum / buf.length) * 8)
      animFrameRef.current = requestAnimationFrame(tick)
    }
    animFrameRef.current = requestAnimationFrame(tick)
  }, [])

  // ── POST binary audio chunk ─────────────────────────────────────────────
  const postChunk = useCallback(async (blob: Blob, finalize = false) => {
    const id = sessionIdRef.current
    if (!id) return
    const url = `/api/voice/chunk?sessionId=${id}${finalize ? '&finalize=true' : ''}`
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: blob,
      })
    } catch {
      // Individual chunk failures are non-fatal
    }
  }, [])

  // ── Open SSE and wire event handlers ───────────────────────────────────
  const openSSE = useCallback((sessionId: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const es = new EventSource(`/api/voice/stream?sessionId=${sessionId}`)
      eventSourceRef.current = es

      const readyTimer = setTimeout(() => {
        es.close(); reject(new Error('TIMEOUT'))
      }, 6000)

      es.onmessage = (e) => {
        let payload: {
          type:         string
          finalText?:   string
          partialText?: string
          hasEndpoint?: boolean
          errorType?:   string
          msg?:         string
        }
        try { payload = JSON.parse(e.data) } catch { return }

        switch (payload.type) {

          case 'ready':
            clearTimeout(readyTimer)
            resolve()
            break

          case 'batch':
            if (!mountedRef.current) break
            if (payload.finalText) {
              finalTextRef.current += payload.finalText
              setFinalText(finalTextRef.current)
            }
            // REPLACE partial text on every batch — never accumulate
            // Soniox docs: "non-final tokens reset on every response"
            setPartialText(payload.partialText ?? '')
            break

          case 'finished':
            if (!mountedRef.current) break
            setPartialText('')
            if (finalTextRef.current.trim()) {
              setState('done')
            } else {
              setState('error')
              setErrorCode('EMPTY_TRANSCRIPT')
            }
            teardown()
            break

          case 'error':
            if (!mountedRef.current) break
            clearTimeout(readyTimer)
            setState('error')
            setErrorCode(mapErrorType(payload.errorType ?? ''))
            teardown()
            break
        }
      }

      es.onerror = () => {
        clearTimeout(readyTimer)
        if (mountedRef.current) {
          setState('error')
          setErrorCode('NETWORK_ERROR')
        }
        es.close()
      }
    })
  }, [teardown])

  // ── start() ─────────────────────────────────────────────────────────────
  const start = useCallback(async () => {
    if (state !== 'idle' && state !== 'error' && state !== 'done') return

    setFinalText(''); setPartialText(''); setErrorCode('')
    finalTextRef.current = ''

    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setState('error'); setErrorCode('BROWSER_UNSUPPORTED'); return
    }
    if (typeof EventSource === 'undefined') {
      setState('error'); setErrorCode('BROWSER_UNSUPPORTED'); return
    }

    setState('requesting')

    // Mic permission
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : ''
      setState('error')
      setErrorCode(
        name === 'NotAllowedError' || name === 'PermissionDeniedError'
          ? 'PERMISSION_DENIED' : 'NO_MICROPHONE'
      )
      return
    }

    if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return }
    streamRef.current = stream

    // Amplitude loop (non-fatal if unavailable)
    try {
      const ctx      = new AudioContext()
      const src      = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.75
      src.connect(analyser)
      audioCtxRef.current = ctx
      startAmplitudeLoop(analyser)
    } catch {
      console.warn('[useSoniox] AnalyserNode unavailable — amplitude disabled')
    }

    // Session ID
    const sessionId = crypto.randomUUID()
    sessionIdRef.current = sessionId

    // Open SSE → connects Soniox WS on server
    try {
      await openSSE(sessionId)
    } catch {
      teardown(); setState('error'); setErrorCode('NETWORK_ERROR'); return
    }

    if (!mountedRef.current) { teardown(); return }

    // MediaRecorder
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : ''

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    mediaRecorderRef.current = recorder

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) postChunk(e.data)
    }

    recorder.onstop = () => {
      // Stop mic + amplitude but keep SSE open — Soniox still sending final tokens
      cancelAnimationFrame(animFrameRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
      try { audioCtxRef.current?.close() } catch { /* ignore */ }
      amplitudeRef.current = 0
      // Send finalize — flushes remaining non-final tokens from Soniox
      postChunk(new Blob([], { type: mimeType || 'audio/webm' }), true)
    }

    recorder.onerror = () => {
      teardown()
      if (mountedRef.current) { setState('error'); setErrorCode('UNKNOWN') }
    }

    recorder.start(250)
    setState('recording')
  }, [state, openSSE, postChunk, startAmplitudeLoop, teardown])

  // ── stop() ──────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      setState('finalizing')
      mediaRecorderRef.current.stop()
    }
  }, [])

  // ── reset() ─────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    teardown()
    finalTextRef.current = ''
    setFinalText(''); setPartialText(''); setErrorCode(null)
    setState('idle')
  }, [teardown])

  return { state, finalText, partialText, errorCode, amplitudeRef, start, stop, reset }
}
