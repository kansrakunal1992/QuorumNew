'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import PersonaPanel from './PersonaPanel'
import { PERSONAS, PERSONA_ORDER } from '@/lib/personas'
import type { Session } from '@/lib/types'

interface Props {
  session: Session
}

export default function SessionView({ session }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)

  const handleSaveRecord = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id }),
      })
      if (!res.ok) throw new Error()
      router.push(`/record/${session.id}`)
    } catch {
      setSaving(false)
      alert('Could not save record. Please try again.')
    }
  }

  return (
    <div className="min-h-screen px-4 py-8">
      {/* Header */}
      <div className="max-w-7xl mx-auto mb-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <span
                className="text-lg font-semibold tracking-widest uppercase"
                style={{ color: 'var(--gold)', letterSpacing: '0.2em' }}
              >
                Quorum
              </span>
              <span
                className="text-xs px-2 py-1 rounded"
                style={{ background: 'var(--bg-inset)', color: 'var(--text-4)', border: '1px solid var(--border-dim)' }}
              >
                Session active
              </span>
            </div>
            <p className="text-sm font-medium mb-1" style={{ color: '#e8eaf0' }}>
              The Decision
            </p>
            <p
              className="text-sm leading-relaxed"
              style={{
                color: '#8892a4',
                maxWidth: '680px',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {session.decision_text}
            </p>
          </div>
          <button
            className="btn-primary flex-shrink-0"
            style={{ padding: '10px 20px', fontSize: '13px' }}
            onClick={handleSaveRecord}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save Decision Record'}
          </button>
        </div>

        {session.context_text && (
          <div
            className="mt-4 px-4 py-3 rounded-lg text-xs"
            style={{ background: '#080d1a', border: '1px solid #131d36', color: '#4a5568' }}
          >
            <span style={{ color: '#2a3a5c' }}>Context provided · </span>
            <span
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 1,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {session.context_text}
            </span>
          </div>
        )}
      </div>

      {/* 6-panel grid */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {PERSONA_ORDER.map((key) => (
          <PersonaPanel
            key={key}
            persona={PERSONAS[key]}
            sessionId={session.id}
            decisionText={session.decision_text}
            contextText={session.context_text ?? undefined}
          />
        ))}
      </div>

      {/* Save footer */}
      <div className="max-w-7xl mx-auto mt-8 flex justify-center">
        <button
          className="btn-primary"
          onClick={handleSaveRecord}
          disabled={saving}
        >
          {saving ? 'Saving Decision Record…' : 'Save Decision Record → Export PDF'}
        </button>
      </div>
    </div>
  )
}
