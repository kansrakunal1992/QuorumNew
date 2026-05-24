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
}

// ─── Chunk splitter ────────────────────────────────────────────────────────────
// Splits on sentence boundaries, targeting ~80 words per chunk.
// 80 words ≈ 32s of audio at 150wpm → ~3-5s fetch from Soniox REST.
// First chunk starts playing in ~4s; subsequent chunks pre-fetch during playback.

const MAX_WORDS = 80

function chunkText(text: string): string[] {
  // Split on sentence-ending punctuation followed by whitespace or end-of-string
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

  const audioRef     = useRef<HTMLAudioElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const abortRef     = useRef<AbortController | null>(null)
  const rateRef      = useRef(1) // stays accurate inside async callbacks

  // ── Rate control ────────────────────────────────────────────────────────────
  const setRate = (r: number) => {
    rateRef.current = r
    setRateState(r)
    if (audioRef.current) audioRef.current.playbackRate = r // live update
  }

  // ── Internals ───────────────────────────────────────────────────────────────
  const stopInternal = () => {
    abortRef.current?.abort()
    abortRef.current = null
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

  // Plays a blob; resolves when audio ends; rejects on error
  const playBlob = (blob: Blob): Promise<void> => {
    const url   = URL.createObjectURL(blob)
    const audio = new Audio(url)
    objectUrlRef.current = url
    audioRef.current     = audio
    audio.playbackRate   = rateRef.current  // apply current pace on every chunk

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

  // ── Sequential pre-fetch queue ──────────────────────────────────────────────
  // Fetches chunk N+1 while chunk N is playing → seamless joins, no gaps.
  const runQueue = async (chunks: string[], ctrl: AbortController) => {
    // Start fetching chunk 0 immediately
    let nextFetch: Promise<Blob> = fetchChunk(chunks[0], ctrl.signal)

    for (let i = 0; i < chunks.length; i++) {
      if (ctrl.signal.aborted) return

      let blob: Blob
      try {
        blob = await nextFetch
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return
        break // silent fail on chunk error — stop queue
      }

      if (ctrl.signal.aborted) return

      // Pre-fetch next chunk in background while we play current
      if (i + 1 < chunks.length) {
        nextFetch = fetchChunk(chunks[i + 1], ctrl.signal)
      }

      // First chunk ready — transition loading → speaking
      if (i === 0) {
        setIsLoading(false)
        setIsSpeaking(true)
      }

      try {
        await playBlob(blob)
      } catch {
        break // audio error — stop queue silently
      }

      if (ctrl.signal.aborted) return
    }

    // All chunks done (or bailed early)
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
    runQueue(chunks, ctrl).catch(() => {
      if (!ctrl.signal.aborted) stopInternal()
    })
  }

  const stop = () => { stopInternal() }

  useEffect(() => {
    return () => { stopInternal() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { speak, stop, isSpeaking, isLoading, activeSpeakerId, rate, setRate }
}
