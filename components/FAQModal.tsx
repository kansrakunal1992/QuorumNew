// components/FAQModal.tsx
// ── FAQ, reachable from the Natural Intake chat screen ──────────────────────
// Item: "There should be some way on first page chatbot UI whereby user can
// see FAQs." Same content as components/FAQSection.tsx (both read from the
// shared lib/faq-content.ts so they can't drift apart) — just shown as a
// dismissible overlay instead of an in-page accordion, since ChatIntake has
// no long scrolling page to append a FAQ section to.
//
// The chatbot itself can also answer these questions inline (see the FAQ
// reference block wired into lib/chat-intake-reply.ts) — this modal is for
// the person who'd rather scan everything at once than ask one at a time.
//
// Item 6 plan, Phase 4 ("make FAQ modal richer"): two changes from the
// original version —
//   1. A search box filters the list as you type. Reachable mid-conversation
//      rather than at the end of a long page, so scanning-by-scrolling is a
//      worse fit here than it is for FAQSection's in-page accordion; typing
//      a keyword ("privacy", "cancel", "price") gets to the answer faster.
//   2. Rows toggle independently (FAQSection.tsx's own pattern) instead of
//      a strict one-open-at-a-time accordion — useful once filtering means
//      the visible set is already short, and someone comparing two answers
//      (e.g. Elite vs. Private) shouldn't have opening the second collapse
//      the first.

'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { FAQS } from '@/lib/faq-content'

interface Props {
  onClose: () => void
}

export default function FAQModal({ onClose }: Props) {
  const [query, setQuery]             = useState('')
  const [openQuestions, setOpenQuestions] = useState<Set<string>>(() => new Set([FAQS[0]?.q].filter(Boolean) as string[]))

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return FAQS
    return FAQS.filter(item => item.q.toLowerCase().includes(q) || item.a.toLowerCase().includes(q))
  }, [query])

  function toggle(question: string) {
    setOpenQuestions(prev => {
      const next = new Set(prev)
      if (next.has(question)) next.delete(question)
      else next.add(question)
      return next
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Frequently asked questions"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9200,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 560, maxHeight: '82vh', overflowY: 'auto',
          background: 'var(--bg-void)', borderRadius: '18px 18px 0 0',
          border: '1px solid var(--border-mid)', borderBottom: 'none',
          padding: '18px 20px calc(24px + env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: 'var(--text-3)', margin: 0,
          }}>
            Frequently asked
          </p>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 30, height: 30, borderRadius: 999, border: '1px solid var(--border-mid)',
              background: 'var(--bg-card)', color: 'var(--text-3)', cursor: 'pointer',
              fontSize: 16, lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search — privacy, pricing, cancel…"
          style={{
            width: '100%', boxSizing: 'border-box', fontSize: 14, padding: '10px 12px',
            borderRadius: 10, border: '1px solid var(--border-mid)',
            background: 'var(--bg-inset)', color: 'var(--text-1)',
            fontFamily: 'inherit', marginBottom: 8,
          }}
        />

        {filtered.length === 0 ? (
          <p style={{ fontSize: 12.5, color: 'var(--text-4)', textAlign: 'center', padding: '20px 0' }}>
            Nothing matches "{query}" — try a different word, or just ask Quorum directly below.
          </p>
        ) : (
          <div>
            {filtered.map((item) => {
              const open = openQuestions.has(item.q)
              return (
                <div key={item.q} style={{ borderBottom: '1px solid var(--border-dim)' }}>
                  <button
                    onClick={() => toggle(item.q)}
                    aria-expanded={open}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: 14, padding: '14px 2px', background: 'transparent', border: 'none', cursor: 'pointer',
                      fontFamily: 'inherit', textAlign: 'left',
                    }}
                  >
                    <span style={{ fontSize: 13.5, color: 'var(--text-1)' }}>{item.q}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      style={{ color: 'var(--text-4)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {open && (
                    <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.6, paddingRight: 26 }}>
                      {item.a}
                      {item.link && (
                        <>
                          {' '}
                          <Link href={item.link.href} style={{ color: 'var(--gold)', textDecoration: 'none' }}>
                            {item.link.label} →
                          </Link>
                        </>
                      )}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <p style={{ fontSize: 11.5, color: 'var(--text-4)', margin: '14px 0 0', textAlign: 'center' }}>
          Something else? Just ask Quorum directly — it can answer most of this mid-conversation.
        </p>
      </div>
    </div>
  )
}
