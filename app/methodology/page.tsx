// app/methodology/page.tsx
// Items #18/19 — richer documentation beyond the homepage's brief "How it
// thinks" section, for the more analytical HNI/CXO buyer who wants to
// understand the rigor before trusting the product with a high-stakes
// decision.
//
// Written at the same disclosure level established for the homepage (item
// #25): explains what happens and why it's rigorous, never the actual
// mechanism — no ontology dimension weights, no bias-parameter counts, no
// retrieval scoring internals. If you're ever unsure whether a sentence
// belongs here, the test is: would this sentence still be true and useful
// with the specific numbers/weights removed? If not, it's mechanism, not
// outcome — leave it out.
//
// Server component — static, same convention as app/security/page.tsx.

import Link from 'next/link'
import MethodologyExplainerVideo from '@/components/MethodologyExplainerVideo'

export const metadata = {
  title: 'How Quorum Works — Quorum',
  description: 'How a session works, what makes it different from a chatbot, and what compounds over time.',
}

const SESSION_STEPS: { label: string; detail: string }[] = [
  {
    label: 'Your decision is read structurally, first',
    detail:
      "Before any advisor responds, your decision is read for what kind of decision it actually is — not just the words you used. A financing decision and a co-founder split can share the same underlying structure even though nothing about the topics overlaps. This structural read is what everything after it is built on.",
  },
  {
    label: 'Six advisors respond from that read',
    detail:
      'The Contrarian, the Risk Architect, the Pattern Analyst, the Stakeholder Mirror, the Elder, and the Competitor each respond from their own angle on the same structural read — not six calls to the same generic model with different personas bolted on.',
  },
  {
    label: 'The Council synthesizes, it doesn\u2019t vote',
    detail:
      'Where the six perspectives agree, that gets weight. Where they genuinely conflict, the synthesis says so directly rather than averaging it away — a decision that six advisors are split on is different from one they agree on, and you should be able to tell the difference.',
  },
  {
    label: 'Challenging one advisor reaches all six',
    detail:
      "If you push back on an advisor or add context they missed, that's treated as new information for the whole council, not a private exchange with one advisor — it reaches every advisor automatically. Each one reassesses independently through its own lens and may keep, strengthen, weaken, or reverse its position; being told the same thing never means reaching the same conclusion. The Council synthesizes once, after every advisor has had the chance to weigh in.",
  },
]

const MIRROR_ITEMS: { label: string; detail: string }[] = [
  {
    label: 'Patterns are only surfaced once they\u2019re earned',
    detail:
      'A single decision can\u2019t tell you much about a recurring pattern. Mirror only surfaces a pattern once there\u2019s enough evidence across your own decisions to support it — and only from things you actually wrote, not from the Council\u2019s own responses reflected back at you.',
  },
  {
    label: 'Structurally similar decisions, cited, not invented',
    detail:
      'When a current decision structurally resembles one you\u2019ve made before, that gets cited directly — which past decision, not a generic "you tend to do X." You can always open the original.',
  },
  {
    label: 'Confidence compounds, it doesn\u2019t appear instantly',
    detail:
      'Anything Mirror shows you carries an implicit confidence level based on how much evidence supports it. Early on, that means Mirror says less. That\u2019s deliberate — a false pattern shown with confidence is worse than no pattern at all.',
  },
]

export default function MethodologyPage() {
  return (
    <main style={{
      minHeight: '100vh',
      background: 'var(--bg-void)',
      padding: '48px 20px 96px',
    }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>

        {/* Back link */}
        <Link href="/" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 11, color: 'var(--text-4)',
          fontFamily: 'var(--font-mono)', letterSpacing: '0.08em',
          textDecoration: 'none', marginBottom: 36,
        }}>
          ← Back to Quorum
        </Link>

        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            letterSpacing: '0.18em', textTransform: 'uppercase',
            color: 'var(--text-4)', margin: '0 0 12px',
          }}>
            Methodology
          </p>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(28px, 4vw, 42px)',
            fontWeight: 400, letterSpacing: '-0.02em',
            color: 'var(--text-1)', margin: '0 0 12px', lineHeight: 1.15,
          }}>
            How Quorum works
          </h1>
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            color: 'var(--text-4)', letterSpacing: '0.06em', margin: 0,
          }}>
            What happens in a session, and what compounds over time
          </p>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--border-dim)', marginBottom: 40 }} />

        <div style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.85, fontFamily: 'var(--font-body)' }}>

          <p style={{
            fontSize: 15, color: 'var(--text-2)', lineHeight: 1.8, marginBottom: 40,
            borderLeft: '2px solid var(--gold-dim)', paddingLeft: 16,
          }}>
            Every business process has been systematized. Judgment is the last one.
            Quorum exists to make judgment — not just intelligence — something that
            compounds the more you use it.
          </p>

          <MethodologyExplainerVideo />

          {/* What happens in a session */}
          <section style={{ marginBottom: 44 }}>
            <h2 style={{
              fontSize: 13, fontWeight: 600, color: 'var(--text-1)',
              fontFamily: 'var(--font-body)', margin: '0 0 16px', paddingBottom: 8,
              borderBottom: '1px solid var(--border-dim)',
            }}>
              What happens in a session
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {SESSION_STEPS.map((item, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 14, alignItems: 'flex-start',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-dim)',
                  borderRadius: 10, padding: '14px 16px',
                }}>
                  <span style={{
                    flexShrink: 0, marginTop: 2,
                    width: 20, height: 20, borderRadius: '50%',
                    background: 'rgba(201,168,76,0.12)',
                    border: '1px solid var(--gold-dim)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 600, color: 'var(--gold)',
                  }}>
                    {i + 1}
                  </span>
                  <div>
                    <p style={{
                      margin: '0 0 4px', fontSize: 13, fontWeight: 600,
                      color: 'var(--text-1)',
                    }}>
                      {item.label}
                    </p>
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)', lineHeight: 1.65 }}>
                      {item.detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Why this isn't a chatbot */}
          <section style={{ marginBottom: 44 }}>
            <h2 style={{
              fontSize: 13, fontWeight: 600, color: 'var(--text-1)',
              fontFamily: 'var(--font-body)', margin: '0 0 16px', paddingBottom: 8,
              borderBottom: '1px solid var(--border-dim)',
            }}>
              Why this isn&apos;t a chatbot
            </h2>
            <p>
              A chatbot routes your text straight to a model and returns whatever comes
              back. Quorum reads the structure of your decision first, and that
              structural read is what determines which advisors weigh in and how they
              relate your decision to your own history — a step a chatbot has no
              equivalent of. The six-advisor format isn&apos;t a stylistic choice either:
              disagreement between advisors is information. A single model answering as
              itself can&apos;t tell you that a decision is genuinely contested.
            </p>
          </section>

          {/* What Mirror adds over time */}
          <section style={{ marginBottom: 44 }}>
            <h2 style={{
              fontSize: 13, fontWeight: 600, color: 'var(--text-1)',
              fontFamily: 'var(--font-body)', margin: '0 0 16px', paddingBottom: 8,
              borderBottom: '1px solid var(--border-dim)',
            }}>
              What Mirror adds over time
            </h2>
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-dim)',
              borderRadius: 10, overflow: 'hidden',
            }}>
              {MIRROR_ITEMS.map((item, i) => (
                <div key={i} style={{
                  padding: '14px 16px',
                  borderTop: i > 0 ? '1px solid var(--border-dim)' : 'none',
                }}>
                  <p style={{
                    margin: '0 0 4px', fontSize: 13, fontWeight: 600,
                    color: 'var(--text-1)',
                  }}>
                    {item.label}
                  </p>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)', lineHeight: 1.65 }}>
                    {item.detail}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Data handling */}
          <section style={{ marginBottom: 8 }}>
            <h2 style={{
              fontSize: 13, fontWeight: 600, color: 'var(--text-1)',
              fontFamily: 'var(--font-body)', margin: '0 0 16px', paddingBottom: 8,
              borderBottom: '1px solid var(--border-dim)',
            }}>
              Data handling
            </h2>
            <p style={{ marginBottom: 8 }}>
              Your decisions are encrypted at the field level, and nothing is ever used
              as a case study or shared externally without your explicit, opt-in
              consent. Full detail on what&apos;s implemented today is at{' '}
              <Link href="/security" style={{ color: 'var(--gold)', textDecoration: 'underline', textUnderlineOffset: 2 }}>
                Security &amp; Trust
              </Link>
              , and our data practices are covered in the{' '}
              <Link href="/privacy" style={{ color: 'var(--gold)', textDecoration: 'underline', textUnderlineOffset: 2 }}>
                Privacy Policy
              </Link>
              .
            </p>
            <p style={{ margin: 0 }}>
              Have a more specific question? The{' '}
              <Link href="/#faq" style={{ color: 'var(--gold)', textDecoration: 'underline', textUnderlineOffset: 2 }}>
                FAQ
              </Link>{' '}
              on the home page covers the most common ones directly.
            </p>
          </section>

        </div>
      </div>
    </main>
  )
}
