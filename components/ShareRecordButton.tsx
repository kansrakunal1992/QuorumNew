'use client'
// components/ShareRecordButton.tsx
// "Share my decision" — generates a public read-only link for this record
// (app/share/[token]/page.tsx) and surfaces it via WhatsApp/LinkedIn/Reddit
// share intents plus a copy-link fallback. Off by default per session —
// this component is the only thing that flips is_shared to true, and it
// only does so on an explicit click, never on mount.

import { useState } from 'react'
import { getStoredDeviceId } from '@/lib/storage'

interface Props {
  sessionId:    string
  decisionText: string
}

export default function ShareRecordButton({ sessionId, decisionText }: Props) {
  const [open,          setOpen]          = useState(false)
  const [loading,       setLoading]       = useState(false)
  const [shareUrl,      setShareUrl]      = useState<string | null>(null)
  const [shareMessage,  setShareMessage]  = useState<string | null>(null)
  const [error,         setError]         = useState('')
  const [copied,        setCopied]        = useState(false)
  const [messageCopied, setMessageCopied] = useState(false)

  const identityQuery = () => {
    const deviceId = getStoredDeviceId()
    const params = new URLSearchParams()
    if (deviceId) params.set('device_id', deviceId)
    return params.toString()
  }

  // The route derives identity itself from the Bearer token below or the
  // device_id query param — same as every other ownership-gated session route.
  const authHeaders = async (): Promise<HeadersInit> => {
    try {
      const { createClient } = await import('@/lib/supabase')
      const sb = createClient()
      const { data: { session } } = await sb.auth.getSession()
      return session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {}
    } catch {
      return {}
    }
  }

  const handleOpen = async () => {
    setOpen(true)
    if (shareUrl) return // already generated this visit
    setLoading(true)
    setError('')
    try {
      const headers = await authHeaders()
      const qs = identityQuery()
      const res = await fetch(`/api/record/${sessionId}/share${qs ? `?${qs}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
      })
      const data = await res.json()
      if (!res.ok || !data.url) throw new Error(data.error ?? 'Could not create share link')
      setShareUrl(data.url)
      setShareMessage(typeof data.message === 'string' ? data.message : null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not create share link')
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard unavailable — link is still visible to select manually */ }
  }

  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(whatsappText)
      setMessageCopied(true)
      setTimeout(() => setMessageCopied(false), 2000)
    } catch { /* clipboard unavailable */ }
  }

  // Falls back to a decision-only line if the message wasn't returned for
  // some reason (e.g. an older cached response) — still shareable, just
  // without the verdict/worth-confirming line.
  const fallbackText = `A decision I ran through Quorum: "${decisionText.slice(0, 140)}${decisionText.length > 140 ? '…' : ''}"`
  const whatsappText = shareMessage ?? `${fallbackText}\n${shareUrl ?? ''}`
  // Reddit's title field is a single-line headline, not a place for the
  // full multi-paragraph message — use just the decision quote there.
  const redditTitle = fallbackText

  const links = shareUrl ? {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(whatsappText)}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`,
    reddit:   `https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(redditTitle)}`,
  } : null

  return (
    <>
      <button
        className="btn-ghost"
        style={{ padding: '10px 18px', fontSize: 13, minHeight: 44 }}
        onClick={handleOpen}
      >
        Share
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(6,13,28,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9000, padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)', border: '1px solid var(--border-mid)',
              borderRadius: 16, padding: 24, maxWidth: 400, width: '100%',
            }}
          >
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', margin: '0 0 4px' }}>
              Share this decision
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-4)', margin: '0 0 16px', lineHeight: 1.5 }}>
              Anyone with the link can see the decision, context, and the Council&apos;s verdict —
              nothing else on your account.
            </p>

            {loading && <p style={{ fontSize: 12, color: 'var(--text-4)' }}>Generating link…</p>}
            {error && <p style={{ fontSize: 12, color: 'var(--error)' }}>{error}</p>}

            {shareUrl && (
              <>
                <div style={{
                  display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16,
                  border: '1px solid var(--border-dim)', borderRadius: 8, padding: '8px 10px',
                }}>
                  <span style={{
                    flex: 1, fontSize: 12, color: 'var(--text-3)', overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {shareUrl}
                  </span>
                  <button
                    onClick={handleCopy}
                    className="btn-ghost"
                    style={{ padding: '4px 10px', fontSize: 11, flexShrink: 0 }}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>

                {shareMessage && (
                  <div style={{
                    marginBottom: 16, border: '1px solid var(--border-dim)', borderRadius: 8,
                    padding: '10px 12px', background: 'var(--bg-inset)',
                  }}>
                    <p style={{
                      fontSize: 11.5, color: 'var(--text-3)', margin: '0 0 8px', lineHeight: 1.55,
                      whiteSpace: 'pre-wrap',
                    }}>
                      {shareMessage}
                    </p>
                    <button
                      onClick={handleCopyMessage}
                      className="btn-ghost"
                      style={{ padding: '4px 10px', fontSize: 11 }}
                    >
                      {messageCopied ? 'Copied' : 'Copy message'}
                    </button>
                  </div>
                )}

                {links && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <a href={links.whatsapp} target="_blank" rel="noopener noreferrer" className="btn-ghost"
                       style={{ padding: '8px 14px', fontSize: 12, textDecoration: 'none' }}>
                      WhatsApp
                    </a>
                    <a href={links.linkedin} target="_blank" rel="noopener noreferrer" className="btn-ghost"
                       style={{ padding: '8px 14px', fontSize: 12, textDecoration: 'none' }}>
                      LinkedIn
                    </a>
                    <a href={links.reddit} target="_blank" rel="noopener noreferrer" className="btn-ghost"
                       style={{ padding: '8px 14px', fontSize: 12, textDecoration: 'none' }}>
                      Reddit
                    </a>
                  </div>
                )}
              </>
            )}

            <button
              onClick={() => setOpen(false)}
              style={{
                marginTop: 18, display: 'block', width: '100%', textAlign: 'center',
                background: 'none', border: 'none', fontSize: 12, color: 'var(--text-4)',
                cursor: 'pointer', padding: '6px 0',
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  )
}
