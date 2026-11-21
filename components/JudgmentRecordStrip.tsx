'use client'

// components/JudgmentRecordStrip.tsx
// ── Judgment Record, ported to the flag-on landing page ──────────────────────
//
// Same data and same tab/filter logic as the "Your judgment record" block in
// app/HomeClient.tsx (All / Open / Logged, outcome dot, snippet, date,
// status badge, click-through to /record/[id]) — but deliberately NOT
// components/HeroCardCollapsible.tsx's look. The hero cards above this are
// one-line-summary status tiles people expand to read; this is a short log
// of actual past decisions people scan and click into, so it keeps
// HomeClient's own per-row card treatment (bordered row, not a collapsible
// single wrapper) to read as a different *kind* of thing, not a sixth hero
// card.
//
// Difference from HomeClient's version: shows the latest 3 by default
// (HomeClient's shows 5) — this page's hero section is already dense, so
// the preview stays shorter; "Show N more" still reveals the rest.
//
// Delete + Share (Nov 2026): each row has the same two small icon buttons the classic home page's record had. Delete is
// one tap followed by a few seconds to Undo, not a confirm dialog: the row turns into a quiet "Decision deleted. Undo"
// line in the same spot, and only when those seconds pass is anything actually deleted (the parent's onDeleteSession
// removes it from the list, from this device and from the server). Leaving the page during that window counts as
// "yes, delete": the pending ones are committed right away (the parent's request uses keepalive so it survives the
// navigation). It works for every decision, including ones with a logged outcome, as on the classic page.
//
// Theming: every color below is one of this app's existing CSS custom
// properties (same tokens HomeClient.tsx's own version uses) — nothing
// hardcoded, so this follows light/dark automatically via
// app/globals.css's [data-theme] rules, exactly like every other component
// in this codebase.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import ShareRecordButton from '@/components/ShareRecordButton'

export interface JudgmentRecordSession {
  id:            string
  decision_text: string
  created_at:    string
  outcome?: {
    council_helped: string
    what_decided:   string
  } | null
  // v15: carried through from /api/history for the Decision Desk (lib/desk.ts). Optional; this strip does not read them.
  status?:                   'active' | 'completed' | null
  session_depth?:            'checkpoint' | 'council' | null
  final_decision_locked_at?: string | null
  commitment_review_date?:   string | null
}

const PREVIEW_COUNT = 3

/** How long the "Undo" stays before the decision is really deleted. */
export const UNDO_WINDOW_MS = 6000

const IconClock = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
  </svg>
)
const IconCheck = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)
const IconDot = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="12" r="6" />
  </svg>
)

const IconTrash = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4h6v2" />
  </svg>
)

const HELPED_COLOR: Record<string, string> = {
  yes:       'var(--outcome-yes)',
  partially: 'var(--outcome-partial)',
  no:        'var(--outcome-no)',
}
const HELPED_LABEL: Record<string, string> = {
  yes:       'Changed thinking',
  partially: 'New angles surfaced',
  no:        'Not helpful',
}

type Tab = 'all' | 'pending' | 'decided'

interface StripProps {
  sessions: JudgmentRecordSession[]
  /** Called when a delete is final (the Undo window passed, or the person left the page). Removes it everywhere. */
  onDeleteSession?: (sessionId: string) => void
}

export default function JudgmentRecordStrip({ sessions, onDeleteSession }: StripProps) {
  const router = useRouter()
  const [tab, setTab]           = useState<Tab>('all')
  const [showAll, setShowAll]   = useState(false)
  // Rows in their "Decision deleted. Undo" window. They stay in `sessions` (so the line sits in the same spot) until
  // the parent really removes them.
  const [deletingIds, setDeletingIds] = useState<string[]>([])
  const timers        = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const onDeleteRef   = useRef(onDeleteSession)
  useEffect(() => { onDeleteRef.current = onDeleteSession }, [onDeleteSession])

  // Leaving the page (route change, tab closed, app backgrounded to a different page) with an Undo still showing = commit.
  useEffect(() => {
    const flush = () => {
      for (const [id, t] of Array.from(timers.current.entries())) {
        clearTimeout(t)
        timers.current.delete(id)
        onDeleteRef.current?.(id)
      }
    }
    window.addEventListener('pagehide', flush)
    return () => { window.removeEventListener('pagehide', flush); flush() }
  }, [])

  function startDelete(id: string) {
    if (timers.current.has(id)) return
    setDeletingIds(prev => [...prev, id])
    timers.current.set(id, setTimeout(() => {
      timers.current.delete(id)
      setDeletingIds(prev => prev.filter(x => x !== id))
      onDeleteRef.current?.(id)
    }, UNDO_WINDOW_MS))
  }

  function undoDelete(id: string) {
    const t = timers.current.get(id)
    if (t) clearTimeout(t)
    timers.current.delete(id)
    setDeletingIds(prev => prev.filter(x => x !== id))
  }

  if (!sessions.length) return null

  // Counts ignore rows that are being deleted; the list itself keeps them so the Undo line holds the row's place.
  const live     = sessions.filter(s => !deletingIds.includes(s.id))
  const pending  = live.filter(s => !s.outcome)
  const decided  = live.filter(s =>  s.outcome)
  const filtered = tab === 'all'
    ? sessions
    : sessions.filter(s => (tab === 'pending' ? !s.outcome : !!s.outcome))
  const shown    = showAll ? filtered : filtered.slice(0, PREVIEW_COUNT)

  function selectTab(t: Tab) {
    setTab(t)
    setShowAll(false)
  }

  return (
    <div style={{ width: '100%', maxWidth: 440, marginTop: 28, textAlign: 'left' }}>
      {/* Header + tabs — same micro-label styling as the flag-off strip's
          "Your judgment record" for continuity across the two experiences. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <p style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--text-4)', margin: 0,
        }}>
          Your judgment record
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['all', 'pending', 'decided'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => selectTab(t)}
              style={{
                fontSize: 11, padding: '4px 11px', borderRadius: 20,
                border: '1px solid',
                borderColor: tab === t ? 'var(--gold-dim)' : 'var(--border-dim)',
                background:  tab === t ? 'rgba(201,168,76,0.1)' : 'transparent',
                color:       tab === t ? 'var(--gold)' : 'var(--text-4)',
                cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
              }}
            >
              {t === 'all'     ? `All ${live.length}` : null}
              {t === 'pending' ? `Open ${pending.length}` : null}
              {t === 'decided' ? `Logged ${decided.length}` : null}
            </button>
          ))}
        </div>
      </div>

      {/* Row list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {shown.map(s => {
          if (deletingIds.includes(s.id)) {
            return (
              <div
                key={s.id}
                role="status"
                aria-live="polite"
                style={{
                  border: '1px dashed var(--border-mid)', borderRadius: 12, padding: '10px 15px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                }}
              >
                <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>Decision deleted.</span>
                <button
                  type="button"
                  onClick={() => undoDelete(s.id)}
                  style={{
                    fontSize: 12, padding: '4px 13px', borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit',
                    border: '1px solid var(--gold-dim)', background: 'rgba(201,168,76,0.1)', color: 'var(--gold)',
                  }}
                >
                  Undo
                </button>
              </div>
            )
          }
          const date    = new Date(s.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
          const snippet = s.decision_text.length > 110 ? s.decision_text.slice(0, 110) + '…' : s.decision_text
          return (
            <div
              key={s.id}
              onClick={() => router.push(`/record/${s.id}`)}
              style={{
                background: 'var(--bg-card)', border: '1px solid var(--border-dim)',
                borderRadius: 12, padding: '13px 15px', cursor: 'pointer',
                transition: 'border-color 0.2s', display: 'flex', alignItems: 'flex-start', gap: 11,
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-hi)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-dim)')}
            >
              <div style={{ flexShrink: 0, marginTop: 3 }}>
                {s.outcome ? (
                  <div style={{
                    width: 18, height: 18, borderRadius: '50%',
                    background: HELPED_COLOR[s.outcome.council_helped] || 'var(--outcome-yes)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--green-text)',
                  }}>
                    <IconCheck />
                  </div>
                ) : (
                  <div style={{
                    width: 18, height: 18, borderRadius: '50%', background: 'var(--bg-inset)',
                    border: '1px solid var(--border-mid)', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', color: 'var(--text-4)',
                  }}>
                    <IconDot />
                  </div>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 12.5, color: 'var(--text-1)', lineHeight: 1.5, margin: '0 0 5px' }}>{snippet}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10.5, color: 'var(--text-4)', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <IconClock /> {date}
                  </span>
                  {s.outcome ? (
                    <span style={{
                      fontSize: 10.5, padding: '2px 9px', borderRadius: 20,
                      background: HELPED_COLOR[s.outcome.council_helped] || 'var(--outcome-yes)',
                      color: 'var(--text-2)', flexShrink: 0,
                    }}>
                      {HELPED_LABEL[s.outcome.council_helped] || 'Decided'}
                    </span>
                  ) : (
                    <span style={{
                      fontSize: 10.5, color: '#c9a84c', padding: '2px 9px', borderRadius: 20,
                      background: 'rgba(201,168,76,0.08)', border: '1px solid var(--gold-dim)', flexShrink: 0,
                    }}>
                      Outcome pending
                    </span>
                  )}
                </div>
              </div>
              {/* Share + Delete, as on the classic page. The wrapper stops the row's own click (open the record), which
                  also covers the share dialog, since React bubbles from it through here. */}
              <div
                onClick={e => e.stopPropagation()}
                style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, margin: '-4px -6px 0 0' }}
              >
                <ShareRecordButton sessionId={s.id} decisionText={s.decision_text} compact />
                {onDeleteSession && (
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); startDelete(s.id) }}
                    title="Delete this decision"
                    aria-label="Delete this decision"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 30, height: 30, borderRadius: 6,
                      border: '1px solid transparent', background: 'transparent',
                      color: 'var(--text-4)', cursor: 'pointer', transition: 'all 0.15s',
                      flexShrink: 0, padding: 0,
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.color = '#c04040'
                      e.currentTarget.style.borderColor = 'rgba(192,64,64,0.3)'
                      e.currentTarget.style.background = 'rgba(192,64,64,0.07)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.color = 'var(--text-4)'
                      e.currentTarget.style.borderColor = 'transparent'
                      e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    <IconTrash />
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {!shown.length && (
          <p style={{ fontSize: 12, color: 'var(--text-4)', textAlign: 'center', padding: '10px 0' }}>
            {tab === 'pending' ? 'No open outcomes — all decisions logged.' : 'No decisions in this category yet.'}
          </p>
        )}
      </div>

      {filtered.length > PREVIEW_COUNT && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          style={{
            marginTop: 10, width: '100%', padding: '9px', fontSize: 11.5,
            background: 'transparent', border: '1px solid var(--border-dim)', borderRadius: 10,
            color: 'var(--text-3)', cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Show {filtered.length - PREVIEW_COUNT} more decision{filtered.length - PREVIEW_COUNT !== 1 ? 's' : ''}
        </button>
      )}
    </div>
  )
}
