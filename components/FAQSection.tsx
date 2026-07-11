// components/FAQSection.tsx
// Item #10: a curated FAQ for the end of the home page — deliberately short
// (not an exhaustive help-center) and targeted at the actual objections
// raised in feedback: privacy, "is this a chatbot," and pricing/value.
// Copy reuses figures already published on the marketing site (Council
// free, Mirror ₹3,999/mo · ₹39,999/yr, Advisory unpublished/by application)
// rather than inventing new claims.
//
// Each question is its own accordion row, collapsed by default — this is
// deliberately a *different* interaction pattern from MeetTheCouncil's
// single top-level toggle: FAQ readers scan questions and open only the
// ones relevant to them, one at a time.

'use client'

import { useState } from 'react'

interface FAQItem {
  q: string
  a: string
}

const FAQS: FAQItem[] = [
  {
    q: 'Is Quorum just a chatbot?',
    a: "No. Before any advisor responds, your decision is read at a structural level — what kind of decision this actually is, not just what you typed. A chatbot routes your text straight to a model; Quorum doesn't.",
  },
  {
    q: 'How private is my data?',
    a: 'Your raw inputs are encrypted at the field level. You can export or delete your full data on request at any time. Nothing about your decisions is used in a case study or shared externally without your explicit, opt-in consent.',
  },
  {
    q: 'Who is Quorum actually built for?',
    a: "Founders, CXOs, and family office principals — people making decisions where being wrong is expensive. It isn't built for everyday, low-stakes choices.",
  },
  {
    q: 'What does it cost?',
    a: "The Council — the core six-advisor session — is free. Mirror, which compounds insight across your decisions over time, is ₹3,999/mo or ₹39,999/yr. Advisory is a founder-led, capped, standing relationship priced once we understand the decision — not published here.",
  },
  {
    q: "What's the difference between the Council and Mirror?",
    a: 'The Council is the six-advisor session you get on any single decision. Mirror is the layer underneath it that compounds across sessions — your bias fingerprint, calibration over time, recurring patterns — and unlocks once you have enough decision history for it to be meaningful.',
  },
  {
    q: 'Can I cancel Mirror anytime?',
    a: "Yes. It's a straightforward monthly or annual subscription — cancel whenever you like, no lock-in.",
  },
  {
    q: 'Does Quorum give financial or legal advice?',
    a: "No. Quorum is a decision intelligence tool, not a licensed financial or legal advisor. The final call — and any financial or legal decision — is always yours; consult a qualified professional for those specifically.",
  },
  {
    q: 'What happens to my data if I stop using Quorum?',
    a: 'You can export everything tied to your account or request full deletion at any time from account settings.',
  },
  {
    q: 'How does the Council actually decide what each advisor says?',
    a: 'Your decision is first tagged structurally — the kind of decision it is, what it structurally resembles from your own history — and each of the six advisors responds from that read, not from a single generic model pass.',
  },
  {
    q: "What's the Advisory tier?",
    a: "A founder-led, capped relationship for decisions where the cost of being wrong is measured in crores, not lakhs. Pricing is shared once we've understood the decision, not published upfront.",
  },
  {
    q: 'Can I use Quorum on my phone?',
    a: "Yes — it's a web app you can install to your home screen directly from your browser. No app-store download needed.",
  },
]

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
        </p>
      )}
    </div>
  )
}

export default function FAQSection() {
  return (
    <div id="faq" style={{ marginTop: 28 }}>
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
