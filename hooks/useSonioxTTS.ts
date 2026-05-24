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
const MAX_WORDS = 80

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

  const fetchChunk = (text: string, signal: AbortSignal): Promise<Blob> =>
    fetch('/api/voice/tts', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text }),
      signal,
    }).then(res => {
      if (!res.ok) throw new Error('TTS_FAILED')
      return res.blob()
    })

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

  // ── Sliding-window pre-fetch queue (PREFETCH = 2) ───────────────────────────
  // Fetches chunks[i+1] and chunks[i+2] while chunks[i] plays.
  // At 2× speed a chunk finishes in ~16s; Soniox fetch takes ~30s.
  // With PREFETCH=1 (old), chunk N+1 starts fetching when chunk N blob arrives
  // (~30s into playback) → finishes at ~60s, but chunk N ends at ~46s → 14s gap.
  // With PREFETCH=2, chunks 0+1+2 are ALL in-flight from T=0 → blobs land at ~30s,
  // all queued before chunk 0 even finishes at 2×. Zero gap at any speed.
  const PREFETCH = 2

  const runQueue = async (chunks: string[], ctrl: AbortController) => {
    // Seed first PREFETCH+1 fetches simultaneously (within Soniox 3-concurrent limit)
    const pending: Promise<Blob>[] = []
    for (let j = 0; j < Math.min(PREFETCH + 1, chunks.length); j++) {
      pending.push(fetchChunk(chunks[j], ctrl.signal))
    }

    for (let i = 0; i < chunks.length; i++) {
      if (ctrl.signal.aborted) return

      // Kick off next pre-fetch on each iteration to keep window rolling
      const ahead = i + PREFETCH + 1
      if (ahead < chunks.length) {
        pending.push(fetchChunk(chunks[ahead], ctrl.signal))
      }

      let blob: Blob
      try {
        blob = await pending[i]
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return
        break
      }

      if (ctrl.signal.aborted) return

      // First chunk ready — clear countdown, flip to playing
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
