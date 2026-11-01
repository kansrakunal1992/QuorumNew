'use client'
// components/RecordViewTracker.tsx
// -- v14: "did they open their Record?" -------------------------------------------------------------------------
// Renders nothing. Logs one `record_viewed` per tab session per record, with whether the visit arrived from one of
// our emails (so the check-in loop can be read end to end: reminder sent -> opened -> record viewed -> outcome).

import { useEffect } from 'react'
import { track } from '@/lib/track'

export default function RecordViewTracker({ sessionId }: { sessionId: string }) {
  useEffect(() => {
    try {
      const key = `quorum_record_viewed_${sessionId}`
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
    } catch { /* storage unavailable: still count the view once per mount */ }
    track('record_viewed', { surface: 'record' }, { sessionId })
  }, [sessionId])
  return null
}
