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
// Theming: every color below is one of this app's existing CSS custom
// properties (same tokens HomeClient.tsx's own version uses) — nothing
// hardcoded, so this follows light/dark automatically via
// app/globals.css's [data-theme] rules, exactly like every other component
// in this codebase.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface JudgmentRecordSession {
  id:            string
  decision_text: string
  created_at:    string
  outcome?: {
    council_helped: string
    what_decided:   string
  } | null
}

const PREVIEW_COUNT = 3

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

export default function JudgmentRecordStrip({ sessions }: { sessions: JudgmentRecordSession[] }) {
  const router = useRouter()
  const [tab, setTab]           = useState<Tab>('all')
  const [showAll, setShowAll]   = useState(false)

  if (!sessions.length) return null

  const pending  = sessions.filter(s => !s.outcome)
  const decided  = sessions.filter(s =>  s.outcome)
  const filtered = tab === 'all' ? sessions : tab === 'pending' ? pending : decided
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
              {t === 'all'     ? `All ${sessions.length}` : null}
              {t === 'pending' ? `Open ${pending.length}` : null}
              {t === 'decided' ? `Logged ${decided.length}` : null}
            </button>
          ))}
        </div>
      </div>

      {/* Row list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {shown.map(s => {
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
