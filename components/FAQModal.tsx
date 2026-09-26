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

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { FAQS } from '@/lib/faq-content'

interface Props {
  onClose: () => void
}

export default function FAQModal({ onClose }: Props) {
  const [openIndex, setOpenIndex] = useState<number | null>(0)

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

        <div>
          {FAQS.map((item, i) => {
            const open = openIndex === i
            return (
              <div key={i} style={{ borderBottom: '1px solid var(--border-dim)' }}>
                <button
                  onClick={() => setOpenIndex(open ? null : i)}
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

        <p style={{ fontSize: 11.5, color: 'var(--text-4)', margin: '14px 0 0', textAlign: 'center' }}>
          Something else? Just ask Quorum directly — it can answer most of this mid-conversation.
        </p>
      </div>
    </div>
  )
}
