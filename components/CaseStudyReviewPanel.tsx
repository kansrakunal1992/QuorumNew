// components/CaseStudyReviewPanel.tsx
// Item #11 — self-contained review queue for the admin dashboard
// (app/admin/page.tsx). Fetches its own data using the already-authenticated
// admin code passed down as a prop, so it doesn't touch the existing R7/R8
// dashboard fetch/state logic at all.

'use client'

import { useState, useEffect, useCallback } from 'react'

interface Submission {
  id:               string
  session_id:       string
  user_note:        string | null
  anonymized_draft: string | null
  decision_text:    string | null
  context_text:     string | null
  consent_given_at: string
  created_at:       string
}

export default function CaseStudyReviewPanel({ adminCode }: { adminCode: string }) {
  const [items,   setItems]   = useState<Submission[] | null>(null)
  const [error,   setError]   = useState('')
  const [busyId,  setBusyId]  = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/case-studies', {
        headers: { Authorization: `Bearer ${adminCode}` },
      })
      if (!res.ok) { setError(`Server error ${res.status}`); return }
      const json = await res.json()
      setItems(json.submissions ?? [])
    } catch {
      setError('Network error loading case-study submissions')
    }
  }, [adminCode])

  useEffect(() => { void load() }, [load])

  const decide = async (id: string, decision: 'approved' | 'rejected') => {
    setBusyId(id)
    try {
      await fetch('/api/admin/case-studies', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminCode}` },
        body:    JSON.stringify({ id, decision }),
      })
      setItems(prev => (prev ?? []).filter(s => s.id !== id))
    } catch {
      setError('Failed to update — try again')
    } finally {
      setBusyId(null)
    }
  }

  if (error) return <p className="text-red-400 text-xs">{error}</p>
  if (items === null) return <p className="text-zinc-600 text-xs">Loading case studies…</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-zinc-200 text-sm font-medium">
          Case studies pending review
        </h2>
        <span className="text-zinc-600 text-xs">{items.length} pending</span>
      </div>

      {items.length === 0 && (
        <p className="text-zinc-600 text-xs">Nothing waiting on review.</p>
      )}

      {items.map(item => (
        <div key={item.id} className="border border-zinc-800 rounded-lg p-4 space-y-3">
          <div>
            <p className="text-zinc-500 text-[11px] uppercase tracking-wide mb-1">Original decision</p>
            <p className="text-zinc-300 text-xs leading-relaxed">{item.decision_text || '—'}</p>
          </div>

          {item.context_text && (
            <div>
              <p className="text-zinc-500 text-[11px] uppercase tracking-wide mb-1">Context</p>
              <p className="text-zinc-400 text-xs leading-relaxed">{item.context_text}</p>
            </div>
          )}

          {item.user_note && (
            <div>
              <p className="text-zinc-500 text-[11px] uppercase tracking-wide mb-1">User's note</p>
              <p className="text-zinc-400 text-xs leading-relaxed italic">{item.user_note}</p>
            </div>
          )}

          <div>
            <p className="text-zinc-500 text-[11px] uppercase tracking-wide mb-1">
              AI-drafted anonymized starting point — edit before using anywhere
            </p>
            <p className="text-zinc-300 text-xs leading-relaxed bg-zinc-900 rounded p-2">
              {item.anonymized_draft || 'Draft generation failed — write this one by hand.'}
            </p>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => decide(item.id, 'approved')}
              disabled={busyId === item.id}
              className="text-xs px-3 py-1.5 rounded bg-emerald-900/40 text-emerald-300 hover:bg-emerald-900/60 transition-colors disabled:opacity-50"
            >
              Approve
            </button>
            <button
              onClick={() => decide(item.id, 'rejected')}
              disabled={busyId === item.id}
              className="text-xs px-3 py-1.5 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
