// lib/useTypewriter.ts
// ── Unified session, "worth stealing" pass ──────────────────────────────────
// Not real token streaming — the network wait is unchanged, the full text
// still arrives in one response. What this fixes is the jarring transition
// from spinner to a fully-formed block of text appearing all at once.
// Revealing word-by-word on the client gives the same felt sense of
// "watching it write" that chat streaming has, without needing a streaming
// completion call in lib/ai-client.ts — a real backend change, out of scope
// for this pass. Worth revisiting if the perceived-vs-actual gap still
// matters once this is in front of real users.

import { useEffect, useRef, useState } from 'react'

export function useTypewriter(fullText: string | null, msPerWord = 45): string {
  const [revealed, setRevealed] = useState('')
  const prevText = useRef<string | null>(null)

  useEffect(() => {
    if (!fullText || fullText === prevText.current) return
    prevText.current = fullText
    const words = fullText.split(' ')
    let i = 0
    setRevealed('')
    const interval = setInterval(() => {
      i += 1
      setRevealed(words.slice(0, i).join(' '))
      if (i >= words.length) clearInterval(interval)
    }, msPerWord)
    return () => clearInterval(interval)
  }, [fullText, msPerWord])

  return fullText ? revealed : ''
}
