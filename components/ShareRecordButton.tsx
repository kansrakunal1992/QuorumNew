'use client'
// components/ShareRecordButton.tsx
// "Share my decision" — generates a public read-only link for this record
// (app/share/[token]/page.tsx) and surfaces it via WhatsApp/LinkedIn/Reddit
// share intents plus a copy-link fallback. Off by default per session —
// this component is the only thing that flips is_shared to true, and it
// only does so on an explicit click, never on mount.

import { useState, type MouseEvent } from 'react'
import { getStoredDeviceId } from '@/lib/storage'

// Monochrome, currentColor-based — these inherit whatever text/gold color
// is set on their parent, so they follow the app's existing light/dark
// theming automatically rather than carrying fixed brand colors that
// wouldn't adapt across themes.

const IconShare = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3"/>
    <circle cx="6" cy="12" r="3"/>
    <circle cx="18" cy="19" r="3"/>
    <line x1="8.6" y1="10.6" x2="15.4" y2="6.4"/>
    <line x1="8.6" y1="13.4" x2="15.4" y2="17.6"/>
  </svg>
)

const IconWhatsApp = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.65.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.65-2.05-.17-.3-.02-.46.13-.61.14-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.6-.91-2.2-.24-.58-.49-.5-.67-.5-.17-.01-.37-.01-.57-.01s-.52.07-.79.37c-.27.3-1.04 1.02-1.04 2.47 0 1.46 1.07 2.87 1.22 3.07.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.62.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.42-.07-.12-.27-.2-.57-.35z"/>
    <path d="M12.02 2C6.5 2 2 6.48 2 12c0 1.85.5 3.58 1.38 5.07L2 22l5.06-1.33A9.96 9.96 0 0 0 12.02 22C17.53 22 22 17.52 22 12S17.53 2 12.02 2zm0 18.2c-1.66 0-3.2-.46-4.52-1.26l-.32-.19-3.37.88.9-3.29-.21-.34a8.18 8.18 0 0 1-1.28-4.4c0-4.52 3.68-8.2 8.2-8.2s8.19 3.68 8.19 8.2-3.67 8.2-8.19 8.2z"/>
  </svg>
)

const IconLinkedIn = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.38-1.85 3.61 0 4.28 2.38 4.28 5.47v6.27zM5.34 7.43a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45z"/>
  </svg>
)

const IconReddit = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M22 12.14c0-1.16-.94-2.1-2.1-2.1-.56 0-1.07.22-1.44.58-1.42-.96-3.35-1.58-5.48-1.66l1.05-3.3 2.9.68a1.5 1.5 0 1 0 .17-.86l-3.24-.76a.43.43 0 0 0-.51.29l-1.19 3.74c-2.19.05-4.16.67-5.61 1.64a2.08 2.08 0 0 0-1.44-.57A2.11 2.11 0 0 0 3 12.14c0 .77.41 1.44 1.02 1.83a3.4 3.4 0 0 0-.05.6c0 2.68 3.15 4.86 7.03 4.86s7.03-2.18 7.03-4.86c0-.2-.02-.4-.05-.6A2.1 2.1 0 0 0 22 12.14zM8.5 13.5a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0zm7.44 2.99c-.78.78-2.27.85-2.94.85s-2.16-.07-2.94-.85a.32.32 0 0 1 .45-.45c.5.5 1.55.68 2.49.68s1.98-.18 2.49-.68a.32.32 0 0 1 .45.45zm-.44-1.74a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z"/>
  </svg>
)

interface Props {
  sessionId:    string
  decisionText: string
  // Compact: icon-only trigger for list rows (matches the existing 30x30
  // Delete button on the homepage session list) instead of the full
  // labeled pill used in the record page's action tray.
  compact?:     boolean
}

export default function ShareRecordButton({ sessionId, decisionText, compact = false }: Props) {
  const [open,          setOpen]          = useState(false)
  const [loading,       setLoading]       = useState(false)
  const [shareUrl,      setShareUrl]      = useState<string | null>(null)
  const [shareMessage,  setShareMessage]  = useState<string | null>(null)
  const [error,         setError]         = useState('')
  const [copied,        setCopied]        = useState(false)
  const [messageCopied, setMessageCopied] = useState(false)
  const [linkedinCopied, setLinkedinCopied] = useState(false)

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

  const handleOpen = async (e?: MouseEvent) => {
    e?.stopPropagation()
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

  const handleLinkedInClick = async () => {
    // LinkedIn's share-offsite endpoint only ever accepts `url` — there's no
    // supported param for pre-filled post text (removed platform-wide a few
    // years back). Copying the message here is the only way to get it into
    // the post; generateMetadata on the share page covers the preview card,
    // this covers the actual post body.
    try {
      await navigator.clipboard.writeText(whatsappText)
      setLinkedinCopied(true)
      setTimeout(() => setLinkedinCopied(false), 4000)
    } catch { /* clipboard unavailable — LinkedIn still opens fine either way */ }
  }

  const links = shareUrl ? {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(whatsappText)}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`,
    reddit:   `https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(redditTitle)}`,
  } : null

  return (
    <>
      {compact ? (
        <button
          onClick={handleOpen}
          title="Share this decision"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 30, height: 30, borderRadius: 6,
            border: '1px solid transparent', background: 'transparent',
            color: 'var(--text-4)', cursor: 'pointer', transition: 'all 0.15s',
            flexShrink: 0, padding: 0,
          }}
          onMouseEnter={e => {
            e.currentTarget.style.color = 'var(--gold)'
            e.currentTarget.style.borderColor = 'var(--gold-dim)'
            e.currentTarget.style.background = 'rgba(201,168,76,0.08)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = 'var(--text-4)'
            e.currentTarget.style.borderColor = 'transparent'
            e.currentTarget.style.background = 'transparent'
          }}
        >
          <IconShare />
        </button>
      ) : (
        <button
          className="btn-ghost"
          style={{ padding: '10px 18px', fontSize: 13, minHeight: 44, display: 'flex', alignItems: 'center', gap: 7 }}
          onClick={handleOpen}
        >
          <IconShare />
          Share
        </button>
      )}

      {open && (
        <div
          onClick={e => { e.stopPropagation(); setOpen(false) }}
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
                       style={{ padding: '8px 14px', fontSize: 12, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <IconWhatsApp /> WhatsApp
                    </a>
                    <a href={links.linkedin} target="_blank" rel="noopener noreferrer" className="btn-ghost"
                       onClick={handleLinkedInClick}
                       style={{ padding: '8px 14px', fontSize: 12, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <IconLinkedIn /> LinkedIn
                    </a>
                    <a href={links.reddit} target="_blank" rel="noopener noreferrer" className="btn-ghost"
                       style={{ padding: '8px 14px', fontSize: 12, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <IconReddit /> Reddit
                    </a>
                  </div>
                )}

                {linkedinCopied && (
                  <p style={{ fontSize: 11, color: 'var(--gold)', marginTop: 8, marginBottom: 0, lineHeight: 1.5 }}>
                    Message copied — LinkedIn only takes the link automatically, so paste it into the post.
                  </p>
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
