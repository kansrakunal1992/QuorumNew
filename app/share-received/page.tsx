'use client'

// app/share-received/page.tsx
// ── WhatsApp / share-sheet landing (Phase 4, v3) ──────────────────────────────
//
// Where POST /api/share-target sends the browser after someone shares a
// message into the installed Quorum PWA. Same authenticated path as every
// other stakeholder input — this page just supplies the two things a share
// sheet can't: which decision this belongs to, and who said it.

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

interface SessionSummary { id: string; decision_text: string; created_at: string }

function ShareReceivedInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const sharedText = searchParams.get('text') ?? ''

  const [authToken, setAuthToken] = useState<string | null>(null)
  const [sessions, setSessions]   = useState<SessionSummary[]>([])
  const [sessionId, setSessionId] = useState('')
  const [stakeholderName, setStakeholderName] = useState('')
  const [text, setText]           = useState(sharedText)
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    (async () => {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token ?? null
      setAuthToken(token)

      try {
        const res = await fetch('/api/history', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ ids: [] }),
        })
        const data = await res.json()
        setSessions((data.sessions ?? []).slice(0, 10))
      } catch (err) {
        console.error('[ShareReceived] history fetch failed:', err)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function save() {
    if (!sessionId || !stakeholderName.trim() || !text.trim() || !authToken) return
    setSaving(true)
    try {
      await fetch('/api/stakeholder-input/manual', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          sessionId, stakeholderName: stakeholderName.trim(),
          channel: 'whatsapp', provenance: 'user_pasted', sourceText: text.trim(),
        }),
      })
      setSaved(true)
      setTimeout(() => router.push(`/session/${sessionId}`), 1200)
    } catch (err) {
      console.error('[ShareReceived] save failed:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <main style={{
      minHeight: '100dvh', display: 'flex', flexDirection: 'column', gap: 16,
      maxWidth: 480, margin: '0 auto', width: '100%',
      padding: '28px 20px calc(20px + env(safe-area-inset-bottom, 0px))',
      background: 'var(--bg-void)', color: 'var(--text-1)', fontFamily: 'var(--font-body)',
    }}>
      <div style={{ fontSize: 19, fontFamily: 'var(--font-display)' }}>Bring this into a decision</div>

      {!authToken && !loading && (
        <div style={{ fontSize: 14, color: 'var(--text-3)' }}>Sign in to Quorum first, then share this again.</div>
      )}

      {authToken && (
        saved ? (
          <div style={{ fontSize: 15, color: 'var(--gold-bright)' }}>Saved — taking you there…</div>
        ) : (
          <>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={4}
              style={{ padding: 12, borderRadius: 12, border: '1px solid var(--border-mid)', background: 'var(--bg-inset)', color: 'var(--text-1)', fontSize: 14.5, resize: 'vertical' }}
            />
            <input
              value={stakeholderName}
              onChange={e => setStakeholderName(e.target.value)}
              placeholder="Who said this?"
              style={{ padding: 12, borderRadius: 12, border: '1px solid var(--border-mid)', background: 'var(--bg-inset)', color: 'var(--text-1)', fontSize: 15 }}
            />
            <div style={{ fontSize: 13, color: 'var(--text-4)' }}>Which decision is this for?</div>
            {loading ? (
              <div style={{ fontSize: 13.5, color: 'var(--text-4)' }}>Loading your recent decisions…</div>
            ) : (
              <select
                value={sessionId}
                onChange={e => setSessionId(e.target.value)}
                style={{ padding: 12, borderRadius: 12, border: '1px solid var(--border-mid)', background: 'var(--bg-inset)', color: 'var(--text-1)', fontSize: 15 }}
              >
                <option value="">Choose one…</option>
                {sessions.map(s => (
                  <option key={s.id} value={s.id}>{s.decision_text?.slice(0, 60) ?? 'Untitled decision'}</option>
                ))}
              </select>
            )}
            <button
              onClick={save}
              disabled={!sessionId || !stakeholderName.trim() || !text.trim() || saving}
              style={{
                padding: '13px 20px', borderRadius: 14, border: 'none',
                background: 'var(--gold)', color: 'var(--bg-void)', fontWeight: 600, fontSize: 15.5,
                cursor: 'pointer', opacity: (!sessionId || !stakeholderName.trim() || !text.trim()) ? 0.5 : 1,
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        )
      )}
    </main>
  )
}

export default function ShareReceivedPage() {
  return (
    <Suspense fallback={null}>
      <ShareReceivedInner />
    </Suspense>
  )
}
