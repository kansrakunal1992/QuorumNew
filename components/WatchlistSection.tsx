// components/WatchlistSection.tsx
// Sprint W1 — home page Watchlist section.
//
// Deliberately plain: one text box, an optional tag, a list of open items,
// each with Archive and "Convene the Council" actions. No register-mode
// choice, no setup — capture should take under 10 seconds, that's the whole
// point (see the Watchlist design discussion: this exists to lower
// perceived friction, not to become a second, lighter ritual).
//
// The "not analyzed" messaging is deliberately explicit and permanent, not a
// one-time tooltip — every item carries the label, so the boundary stays
// visible for as long as the item sits here ungraduated.
//
// Gating: the caller (app/page.tsx) decides whether to render this at all,
// via isWatchlistEnabled() — this component assumes it's already been
// cleared to render and does no flag-checking itself.

import { useState, useEffect, useCallback } from 'react'

const TAG_OPTIONS = [
  { value: '',             label: 'No tag' },
  { value: 'business',     label: 'Business' },
  { value: 'wealth',       label: 'Wealth' },
  { value: 'career',       label: 'Career' },
  { value: 'family',       label: 'Family' },
  { value: 'relationship', label: 'Relationship' },
  { value: 'other',        label: 'Other' },
] as const

const SOFT_CAP = 5

interface WatchlistItem {
  id:         string
  text:       string
  tag:        string | null
  created_at: string
}

interface WatchlistSectionProps {
  authToken: string | null
  /** Called with the item's text when the person chooses to convene the
   * Council on it — the parent (home page) owns setDecision()/focus, this
   * component only hands back the text and marks the item graduated. */
  onGraduate: (text: string) => void
}

export default function WatchlistSection({ authToken, onGraduate }: WatchlistSectionProps) {
  const [items,    setItems]    = useState<WatchlistItem[]>([])
  const [loaded,   setLoaded]   = useState(false)
  const [newText,  setNewText]  = useState('')
  const [newTag,   setNewTag]   = useState('')
  const [adding,   setAdding]   = useState(false)
  const [expanded, setExpanded] = useState(false)

  const fetchItems = useCallback(() => {
    if (!authToken) return
    fetch('/api/watchlist', { headers: { Authorization: `Bearer ${authToken}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.items) setItems(data.items); setLoaded(true) })
      .catch(() => setLoaded(true))
  }, [authToken])

  useEffect(() => { fetchItems() }, [fetchItems])

  const handleAdd = async () => {
    const text = newText.trim()
    if (!text || !authToken) return
    setAdding(true)
    try {
      const res = await fetch('/api/watchlist', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body:    JSON.stringify({ text, tag: newTag || undefined }),
      })
      if (res.ok) {
        setNewText('')
        setNewTag('')
        fetchItems()
      }
    } finally {
      setAdding(false)
    }
  }

  const handleArchive = async (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id)) // optimistic
    if (!authToken) return
    fetch(`/api/watchlist/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body:    JSON.stringify({ status: 'archived' }),
    }).catch(() => {})
  }

  const handleGraduate = async (item: WatchlistItem) => {
    setItems(prev => prev.filter(i => i.id !== item.id)) // optimistic
    onGraduate(item.text)
    if (!authToken) return
    fetch(`/api/watchlist/${item.id}/graduate`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${authToken}` },
    }).catch(() => {})
  }

  if (!authToken) return null // Watchlist requires a signed-in user — no anonymous path

  return (
    <div
      data-tour-id="home-watchlist"
      style={{
      background:   'var(--bg-card)',
      border:       '1px solid var(--border-mid)',
      borderRadius: 13,
      padding:      '18px 20px 20px',
      marginTop:    24,
    }}>
      <div
        onClick={() => setExpanded(v => !v)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
      >
        <p style={{
          fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
          letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-4)', margin: 0,
        }}>
          Watchlist {items.length > 0 && `(${items.length})`}
        </p>
        <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{expanded ? '▴' : '▾'}</span>
      </div>

      {expanded && (
        <div style={{ marginTop: 14 }}>
          <p style={{ fontSize: 12, color: 'var(--text-4)', margin: '0 0 14px', lineHeight: 1.6 }}>
            Things you&apos;re keeping an eye on, not ready to convene the Council on yet.
            Watchlist entries are private — not analyzed by the Council, not part of your
            Decision Graph. Convene the Council on an entry whenever you&apos;re ready to make
            it part of your record.
          </p>

          {/* Add new */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <input
              value={newText}
              onChange={e => setNewText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
              placeholder="Something you're keeping an eye on…"
              maxLength={500}
              style={{
                flex: 1, minWidth: 200, fontSize: 13, padding: '9px 12px',
                borderRadius: 8, border: '1px solid var(--border-mid)',
                background: 'var(--bg-inset)', color: 'var(--text-1)',
              }}
            />
            <select
              value={newTag}
              onChange={e => setNewTag(e.target.value)}
              style={{
                fontSize: 12, padding: '9px 10px', borderRadius: 8,
                border: '1px solid var(--border-mid)', background: 'var(--bg-inset)',
                color: 'var(--text-3)',
              }}
            >
              {TAG_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <button
              className="btn-ghost"
              onClick={handleAdd}
              disabled={adding || !newText.trim()}
              style={{ fontSize: 12, padding: '9px 16px' }}
            >
              {adding ? 'Adding…' : 'Add'}
            </button>
          </div>

          {items.length >= SOFT_CAP && (
            <p style={{ fontSize: 11.5, color: 'var(--text-4)', margin: '0 0 12px', fontStyle: 'italic' }}>
              You&apos;ve got {items.length} open — maybe convene the Council on one before adding more.
            </p>
          )}

          {/* List */}
          {loaded && items.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-4)', margin: 0 }}>Nothing on your watchlist right now.</p>
          )}
          {items.map(item => (
            <div
              key={item.id}
              style={{
                display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                gap: 10, padding: '10px 0', borderTop: '1px solid var(--border-dim)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, color: 'var(--text-1)', margin: '0 0 3px', lineHeight: 1.5, wordBreak: 'break-word' }}>
                  {item.text}
                </p>
                <p style={{ fontSize: 10.5, color: 'var(--text-4)', margin: 0, letterSpacing: '0.03em' }}>
                  {item.tag ? `${item.tag} · ` : ''}Not yet in your Decision Record
                </p>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  className="btn-ghost"
                  onClick={() => handleGraduate(item)}
                  style={{ fontSize: 11, padding: '6px 10px', whiteSpace: 'nowrap' }}
                >
                  Convene the Council
                </button>
                <button
                  onClick={() => handleArchive(item.id)}
                  aria-label="Archive"
                  style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: 13, padding: '4px 6px' }}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
