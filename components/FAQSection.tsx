// components/FAQSection.tsx
// Item #10: a curated FAQ for the end of the home page — deliberately short
// (not an exhaustive help-center) and targeted at the actual objections
// raised in feedback: privacy, "is this a chatbot," and pricing/value.
// Copy reuses figures already published on the marketing site (Council
// free, Elite [Mirror] ₹2,999/mo · ₹29,999/yr, Private custom starting at
// ₹9,999/user/month) rather than inventing new claims. Advisory tier
// retired (Phase 6) — its five feature advantages folded into Elite; no
// longer a distinct customer-facing tier, so no FAQ entry for it below.
//
// Each question is its own accordion row, collapsed by default — this is
// deliberately a *different* interaction pattern from MeetTheCouncil's
// single top-level toggle: FAQ readers scan questions and open only the
// ones relevant to them, one at a time.

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { FAQS, faqStructuredData, type FAQItem } from '@/lib/faq-content'

function FAQRow({ item }: { item: FAQItem }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ borderBottom: '1px solid var(--border-dim)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 14, padding: '15px 2px', background: 'transparent', border: 'none', cursor: 'pointer',
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
}

export default function FAQSection() {
  return (
    <div id="faq" style={{ marginTop: 28 }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqStructuredData(FAQS)) }}
      />
      <p style={{
        fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em',
        textTransform: 'uppercase', color: 'var(--text-3)', margin: '0 0 6px',
      }}>
        Frequently asked
      </p>
      <div>
        {FAQS.map((item, i) => <FAQRow key={i} item={item} />)}
      </div>
    </div>
  )
}
