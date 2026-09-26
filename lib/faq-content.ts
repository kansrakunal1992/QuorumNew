// lib/faq-content.ts
// ── Shared FAQ content — single source of truth ─────────────────────────────
// Originally lived inline in components/FAQSection.tsx. Pulled out so three
// consumers can share one list without drifting apart:
//   1. components/FAQSection.tsx   — the accordion at the end of the home page
//   2. components/FAQModal.tsx     — the same content, reachable from the
//                                    Natural Intake chat screen
//   3. lib/chat-intake-reply.ts    — grounds Quorum's in-chat answers to
//                                    FAQ-type questions ("is this just a
//                                    chatbot," "how private is this," "what
//                                    does it cost") in this real copy instead
//                                    of letting the model improvise an answer
//                                    it can't verify.
//
// Item #10 (original FAQSection note): deliberately a short, curated FAQ
// targeted at real objections — privacy, "is this a chatbot," pricing — not
// an exhaustive help center. Copy reuses figures already published on the
// marketing site (Council free, Elite [Mirror] ₹2,999/mo · ₹29,999/yr,
// Private custom starting at ₹9,999/user/month) rather than inventing new
// claims. Advisory tier retired (Phase 6) — folded into Elite, no entry here.

import { isUnifiedSessionEnabled } from '@/lib/feature-flags'

export interface FAQItem {
  q: string
  a: string
  link?: { href: string; label: string }
}

// Unified session, point 1: the two FAQ entries below describe the six-
// named-advisor mechanic directly ("each of the six advisors," "reaches all
// six") — accurate to what's shown by default when the flag is off, but
// actively confusing under the compact-summary Council experience, where a
// first-time reader has no six named advisors in front of them yet to make
// sense of the answer. Swapped for two entries describing what a reader
// actually sees under the flag instead of deleting the space they occupied.
const CLASSIC_MODEL_FAQS: FAQItem[] = [
  {
    q: 'How does the Council actually decide what each advisor says?',
    a: 'Your decision is first tagged structurally — the kind of decision it is, what it structurally resembles from your own history — and each of the six advisors responds from that read, not from a single generic model pass.',
  },
  {
    q: 'If I push back on one advisor, do the others find out?',
    a: "Yes, automatically. A challenge is treated as new information for the whole council, not a private exchange with one advisor — so it reaches all six. Each advisor still reassesses it independently through its own lens and may keep, strengthen, weaken, or reverse its position; sharing the information never means they share a conclusion. The Council synthesizes once, after every advisor has had a chance to weigh in.",
  },
]

const UNIFIED_SESSION_FAQS: FAQItem[] = [
  {
    q: 'Can Quorum actually predict what I\u2019ll choose?',
    a: 'Try it and find out. Before Quorum shows you anything, it locks in your own gut call \u2014 then makes its own guess about where you\u2019ll actually land, and tells you why. Most people check the reveal before they read anything else. It gets sharper the more decisions you bring it, because it starts reading your own patterns instead of guessing cold.',
  },
  {
    q: 'Do I still get all six advisors, or just Quorum\u2019s guess?',
    a: 'Both. The six advisors are doing the real work the moment you bring a decision \u2014 you\u2019ll see each one\u2019s verdict and lean right there, no extra tap needed. Want the full reasoning behind any of them? Tap that card.',
  },
]

export const FAQS: FAQItem[] = [
  {
    q: 'Is Quorum just a chatbot?',
    a: "No. Before any advisor responds, your decision is read at a structural level — what kind of decision this actually is, not just what you typed. A chatbot routes your text straight to a model; Quorum doesn't.",
  },
  // Point 1: moved to position 2, right after the core positioning question —
  // this is the highest-visibility slot in the list besides the first entry,
  // and prediction is the thing this experience most wants a new visitor to
  // notice early rather than discover mid-list.
  ...(isUnifiedSessionEnabled() ? UNIFIED_SESSION_FAQS : CLASSIC_MODEL_FAQS),
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
    q: 'Can I use Quorum on my phone?',
    a: "Yes — it's a web app you can install to your home screen directly from your browser. No app-store download needed.",
    link: { href: '/install', label: 'See Android / iPhone steps' },
  },
]

// FAQPage structured data (schema.org), generated from the same FAQS array
// the accordion renders — so the two can never drift out of sync. This is
// what lets an AI crawler (or a traditional rich-result crawler) read each
// Q&A as a discrete, citable answer instead of one wall of text it has to
// parse out of collapsed accordion markup.
export function faqStructuredData(items: FAQItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.a,
      },
    })),
  }
}

// Compact "Q: ... A: ..." reference block for the chat-intake follow-up
// prompt (lib/chat-intake-reply.ts) — plain text, not JSON, since it's meant
// to be read by the model as reference material, not parsed as data.
export function faqReferenceText(): string {
  return FAQS.map(item => `Q: ${item.q}\nA: ${item.a}`).join('\n\n')
}
