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

interface FAQItem {
  q: string
  a: string
  link?: { href: string; label: string }
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
    q: "What shouldn't I put into Quorum?",
    a: "Quorum is built to reason about decisions, not to store sensitive data. Please don't paste passwords, PINs, API keys or login credentials, full card or bank account numbers, or government ID numbers (like a passport, SSN, or Aadhaar number). Avoid including other people's personal details without their consent. If a decision genuinely involves this kind of detail, describe it in general terms — \"a five-figure investment,\" not the account number — Quorum's reasoning works from the shape of the decision, not the sensitive data itself.",
  },
  {
    q: 'Who is Quorum actually built for?',
    a: "Founders, CXOs, and family office principals — people making decisions where being wrong is expensive. It isn't built for everyday, low-stakes choices.",
  },
  {
    q: 'What does it cost?',
    a: "The Council — the core six-advisor session — is free. Elite adds Mirror, which compounds insight across your decisions over time, for ₹2,999/mo or ₹29,999/yr. Private is a custom enterprise deployment, starting at ₹9,999/user/month — priced once we understand your organisation's needs.",
  },
  {
    q: "What's the difference between the Council and Mirror?",
    a: 'The Council is the six-advisor session you get on any single decision. Mirror is the layer underneath it that compounds across sessions — your bias fingerprint, calibration over time, recurring patterns — and unlocks once you have enough decision history for it to be meaningful. On Elite, you can also jumpstart it by importing context you\u2019ve already built elsewhere, instead of waiting for it to accumulate from scratch.',
  },
  {
    q: 'Can I import context instead of starting from scratch?',
    a: "Yes, on Elite. Paste a description of yourself or upload a ChatGPT/Claude conversation export, and Quorum extracts a handful of distilled insights \u2014 goals, values, decision patterns \u2014 for you to review before anything is saved. Only those reviewed insights are kept; the raw conversation or text you upload is never stored.",
  },
  {
    q: 'What AI models power Quorum?',
    a: "Quorum uses different models for different plans, matched to what each plan is for. Free runs on GPT-5-mini end-to-end — strong reasoning at a cost that keeps the free tier sustainable for everyone. Elite pairs GPT-5-mini for fast reasoning with Claude Sonnet for Quorum's deepest analysis — Council Synthesis, Mirror, and long-term pattern-reading. Private runs entirely inside your own infrastructure, on either self-hosted Qwen or self-hosted Mistral, whichever you choose.",
  },
  {
    q: 'Where is my data processed?',
    a: "Free and Elite both run on OpenAI and Anthropic infrastructure — no China-based provider is part of either tier. Only what's needed for that specific call is sent, over an encrypted connection. If you need your data to stay entirely on infrastructure you control, Private runs on self-hosted Qwen or Mistral inside your own environment.",
  },
  {
    q: "Why doesn't every plan use the same model?",
    a: "Because each plan optimises for a different goal. Free is built to be accessible to everyone while staying sustainable. Elite is built for the highest-quality personal decision intelligence. Private is built for complete ownership and enterprise deployment. The model each plan runs on follows from that goal — it isn't the goal itself; Quorum's judgment quality is what you're actually buying.",
  },
  {
    q: 'Can I cancel Elite or Private anytime?',
    a: "Elite is a straightforward self-serve monthly or annual subscription — cancel whenever you like, no lock-in. Private is a custom enterprise arrangement, so changes or cancellation go through your account contact rather than a self-service button.",
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
    q: 'If I push back on one advisor, do the others find out?',
    a: "Yes, automatically. A challenge is treated as new information for the whole council, not a private exchange with one advisor — so it reaches all six. Each advisor still reassesses it independently through its own lens and may keep, strengthen, weaken, or reverse its position; sharing the information never means they share a conclusion. The Council synthesizes once, after every advisor has had a chance to weigh in.",
  },
  {
    q: 'Can I use Quorum on my phone?',
    a: "Yes — it's a web app you can install to your home screen directly from your browser. No app-store download needed.",
    link: { href: '/install', label: 'See Android / iPhone steps' },
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
