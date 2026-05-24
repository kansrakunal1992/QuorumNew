'use client'

import { useState, useRef, useEffect } from 'react'

export interface SonioxTTSHook {
  speak:           (text: string, speakerId: string) => void
  stop:            () => void
  isSpeaking:      boolean
  isLoading:       boolean
  activeSpeakerId: string | null
  rate:            number
  setRate:         (r: number) => void
  countdown:       number | null
}

// ─── Chunk splitter ────────────────────────────────────────────────────────────
const MAX_WORDS = 40

function chunkText(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+[\s]*/g) ?? [text]
  const chunks: string[] = []
  let current = ''
  let wordCount = 0

  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/).length
    if (wordCount + words > MAX_WORDS && current.trim()) {
      chunks.push(current.trim())
      current   = sentence
      wordCount = words
    } else {
      current   += sentence
      wordCount += words
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks.filter(c => c.length > 0)
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSonioxTTS(): SonioxTTSHook {
  const [isSpeaking,      setIsSpeaking]      = useState(false)
  const [isLoading,       setIsLoading]       = useState(false)
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null)
  const [rate,            setRateState]       = useState(1)
  const [countdown,       setCountdown]       = useState<number | null>(null)

  const audioRef            = useRef<HTMLAudioElement | null>(null)
  const objectUrlRef        = useRef<string | null>(null)
  const abortRef            = useRef<AbortController | null>(null)
  const rateRef             = useRef(1)
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Rate control ────────────────────────────────────────────────────────────
  const setRate = (r: number) => {
    rateRef.current = r
    setRateState(r)
    if (audioRef.current) audioRef.current.playbackRate = r
  }

  // ── Internals ───────────────────────────────────────────────────────────────
  const clearCountdown = () => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current)
      countdownIntervalRef.current = null
    }
    setCountdown(null)
  }

  const stopInternal = () => {
    abortRef.current?.abort()
    abortRef.current = null
    clearCountdown()
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.onended = null
      audioRef.current = null
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
    setIsSpeaking(false)
    setIsLoading(false)
    setActiveSpeakerId(null)
  }

  // Retries once after 1.5s — handles Railway cold starts & transient Soniox blips.
  const fetchChunkWithRetry = async (text: string, signal: AbortSignal): Promise<Blob> => {
    const attempt = async (): Promise<Blob> => {
      const res = await fetch('/api/voice/tts', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text }),
        signal,
      })
      if (!res.ok) throw new Error(`TTS_FAILED:${res.status}`)
      return res.blob()
    }
    try {
      return await attempt()
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e
      // Wait then retry once
      await new Promise(r => setTimeout(r, 1500))
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      return attempt()
    }
  }

  const playBlob = (blob: Blob): Promise<void> => {
    const url   = URL.createObjectURL(blob)
    const audio = new Audio(url)
    objectUrlRef.current = url
    audioRef.current     = audio
    audio.playbackRate   = rateRef.current

    return new Promise((resolve, reject) => {
      audio.onended = () => {
        URL.revokeObjectURL(url)
        objectUrlRef.current = null
        audioRef.current     = null
        resolve()
      }
      audio.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('Audio error'))
      }
      audio.play().catch(reject)
    })
  }

  // ── Pre-fetch queue (PREFETCH = 1) ──────────────────────────────────────────
  // PREFETCH=1 keeps max 2 concurrent Soniox requests (safely under the 3-limit).
  // PREFETCH=2 was firing 3 simultaneously → any transient error stopped the queue.
  // Retry in fetchChunkWithRetry covers the 2× pace gap (tech debt) adequately.
  const PREFETCH = 1

  const runQueue = async (chunks: string[], ctrl: AbortController) => {
    const pending: Promise<Blob>[] = []
    for (let j = 0; j < Math.min(PREFETCH + 1, chunks.length); j++) {
      pending.push(fetchChunkWithRetry(chunks[j], ctrl.signal))
    }

    for (let i = 0; i < chunks.length; i++) {
      if (ctrl.signal.aborted) return

      const ahead = i + PREFETCH + 1
      if (ahead < chunks.length) {
        pending.push(fetchChunkWithRetry(chunks[ahead], ctrl.signal))
      }

      let blob: Blob
      try {
        blob = await pending[i]
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return
        // Retry exhausted — clear loading state and stop cleanly
        clearCountdown()
        break
      }

      if (ctrl.signal.aborted) return

      if (i === 0) {
        clearCountdown()
        setIsLoading(false)
        setIsSpeaking(true)
      }

      try {
        await playBlob(blob)
      } catch {
        break
      }

      if (ctrl.signal.aborted) return
    }

    // Always fires — whether loop completed normally or broke early
    setIsLoading(false)
    if (!ctrl.signal.aborted) {
      setIsSpeaking(false)
      setActiveSpeakerId(null)
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  const speak = (text: string, speakerId: string) => {
    stopInternal()
    setIsLoading(true)
    setActiveSpeakerId(speakerId)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    const chunks = chunkText(text)

    // Estimate first-chunk fetch time: words / 150wpm * 60s ≈ Soniox generation time
    const firstWords    = chunks[0]?.trim().split(/\s+/).length ?? MAX_WORDS
    const estimatedSec  = Math.round((firstWords / 150) * 60)
    setCountdown(estimatedSec)

    countdownIntervalRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev === null) return null
        if (prev <= 1) return 0   // hold at 0 rather than going negative
        return prev - 1
      })
    }, 1000)

    runQueue(chunks, ctrl).catch(() => {
      if (!ctrl.signal.aborted) stopInternal()
    })
  }

  const stop = () => { stopInternal() }

  useEffect(() => {
    return () => { stopInternal() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { speak, stop, isSpeaking, isLoading, activeSpeakerId, rate, setRate, countdown }
}
