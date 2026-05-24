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

export function useSonioxTTS(): SonioxTTSHook {
  const [isSpeaking,      setIsSpeaking]      = useState(false)
  const [isLoading,       setIsLoading]       = useState(false)
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null)
  const [rate,            setRateState]       = useState(1)

  const audioRef     = useRef<HTMLAudioElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const abortRef     = useRef<AbortController | null>(null)
  const rateRef      = useRef(1)   // keeps rate accessible inside async callbacks

  const setRate = (r: number) => {
    rateRef.current = r
    setRateState(r)
    if (audioRef.current) audioRef.current.playbackRate = r
  }

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

  const speak = (text: string, speakerId: string) => {
    // Stop any currently playing audio first
    stopInternal()

    setIsLoading(true)
    setActiveSpeakerId(speakerId)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    fetch('/api/voice/tts', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text }),
      signal:  ctrl.signal,
    })
      .then(res => {
        if (!res.ok) throw new Error('TTS_FAILED')
        return res.blob()
      })
      .then(blob => {
        if (ctrl.signal.aborted) return
        const url   = URL.createObjectURL(blob)
        objectUrlRef.current = url
        const audio = new Audio(url)
        audioRef.current = audio
        audio.onended = () => {
          URL.revokeObjectURL(url)
          objectUrlRef.current = null
          audioRef.current     = null
          setIsSpeaking(false)
          setActiveSpeakerId(null)
        }
        setIsLoading(false)
        setIsSpeaking(true)
        audio.playbackRate = rateRef.current
        audio.play().catch(() => {
          // Browser autoplay blocked — fail silently
          stopInternal()
        })
      })
      .catch(e => {
        if (e?.name === 'AbortError') return
        // TTS is enhancement not core — silent fail
        setIsLoading(false)
        setIsSpeaking(false)
        setActiveSpeakerId(null)
      })
  }

  const stop = () => { stopInternal() }

  // Cleanup on unmount
  useEffect(() => {
    return () => { stopInternal() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { speak, stop, isSpeaking, isLoading, activeSpeakerId, rate, setRate }
}
