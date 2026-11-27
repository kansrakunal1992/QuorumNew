'use client'

// components/FrontDoorExplainer.tsx
// ── v15 Phase 3: the first-visit screen says what Quorum is, before anyone has typed ──────────────────────────────────
//
// Until now the front door was a box, a headline and a few pills; the Council was not named anywhere a first-time visitor
// would look, and the copy rules for the chat (docs/COPY_AND_STRUCTURE_LOCK_v1.md) said never to say "Council" or
// "Examiner" in it. A visitor therefore met the thing that makes Quorum different only AFTER a conversation, which is why it
// risked reading as "an AI chatbot with a few personas". This sits BELOW the box (the box stays the first thing on the
// screen, as the round-4 first-screen work established) and does three jobs:
//
//   1. Always visible: what happens when you bring a decision (examined -> decided -> remembered), with the Council named.
//   2. One tap: an illustrative example result, clearly labelled as invented, so the output is not left to the imagination.
//   3. One tap: how the record builds with use, deliberately honest that one or two decisions are not enough to know someone.
//
// Copy rules (enforced by tests/v15-front-door.test.ts): no "free", no sign-up claims, no timings, no "instantly", and
// nothing that says Quorum knows or predicts the person. It says what the product does, and what it needs to do it.
// MeetTheCouncil (the six advisors in detail) is unchanged and remains lower on the page.

import { useState } from 'react'
import { PERSONAS } from '@/lib/personas'
import { isFounderFrontDoorEnabled } from '@/lib/feature-flags'   // v18
import { track } from '@/lib/track'

const ADVISOR_KEYS = ['contrarian', 'risk_architect', 'pattern_analyst', 'stakeholder_mirror', 'elder', 'competitor'] as const

const card: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border-dim)', borderRadius: 12, textAlign: 'left',
}

const STEPS: Array<{ lead: string; text: string }> = [
  {
    lead: 'Examined.',
    text: 'An Examiner finds what your decision is missing. Then six independent advisors, weighted by how relevant each is to your situation, argue it from different angles and show you where they genuinely disagree.',
  },
  {
    lead: 'Decided.',
    text: 'You commit to what you will do and choose a date to check back. Quorum notes what it expected you to choose.',
  },
  {
    lead: 'Remembered.',
    text: 'On that date Quorum asks how it turned out and keeps the answer with the decision. Over time that record is what lets it point to patterns in how you decide.',
  },
]

// v18: the founder variant. A repeatable decision review, not six advisors: structure, challenge, a documented brief, tracking.
// Same rules as above: nothing about price, sign-up or time, and nothing that says Quorum knows or predicts the person.
const FOUNDER_STEPS: Array<{ lead: string; text: string }> = [
  { lead: 'Structured.',  text: 'The Examiner finds what your decision is missing and structures it: the options, the assumptions you are relying on, and what would change the answer.' },
  { lead: 'Challenged.',  text: 'Six independent perspectives, weighted by how relevant each is to your situation, argue it from different angles. You see where they genuinely disagree, and the risks and trade-offs.' },
  { lead: 'Documented.',  text: 'You get a decision brief you can take to a co-founder, your board or your team.' },
  { lead: 'Tracked.',     text: 'You commit, choose a date to check back, and Quorum asks how it turned out and keeps the answer with the decision.' },
]

const STAGES: Array<{ when: string; what: string }> = [
  { when: 'First decision', what: 'A starting point. One decision cannot say how you decide, and Quorum does not pretend it can.' },
  { when: 'Second', what: 'A first comparison: what the two decisions have in common.' },
  { when: 'Third to fifth', what: 'Early signals. Recurring priorities and blind spots begin to show, marked as early.' },
  { when: 'With check-ins', what: 'Once you have recorded how decisions turned out, Quorum can show where your confidence ran ahead of what happened, or behind it.' },
]

function Disclosure({ label, section, children }: { label: string; section: 'example' | 'compounding'; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ ...card, overflow: 'hidden' }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => { if (!open) track('front_door_section_opened', { section }); setOpen(o => !o) }}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '14px 16px', minHeight: 48, background: 'transparent', border: 'none', cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 14, color: 'var(--text-2)', textAlign: 'left',
        }}
      >
        <span>{label}</span>
        <span aria-hidden style={{ color: 'var(--text-4)', fontSize: 18, lineHeight: 1 }}>{open ? '−' : '+'}</span>
      </button>
      {open && <div style={{ padding: '0 16px 16px' }}>{children}</div>}
    </div>
  )
}

interface SampleContent {
  decision: string; examiner: string
  advisors: Array<{ key: (typeof ADVISOR_KEYS)[number]; relevance: string; line: string }>
  split: string; read: string; checkBack: string
}
const SAMPLE_LEGACY: SampleContent = {
  decision: 'Hire a senior engineer now, or wait until the next round closes?',
  examiner: 'How many months of runway do you have if the round slips by a quarter?',
  advisors: [
    { key: 'risk_architect', relevance: 'high relevance',   line: 'A hire you cannot afford in month nine is the failure to plan for. Runway is the constraint, not talent.' },
    { key: 'contrarian',     relevance: 'high relevance',   line: 'You may be hiring to avoid a harder question: does the product need more building, or more selling?' },
    { key: 'elder',          relevance: 'medium relevance', line: 'In two years the quarter you wait matters less than the speed you lose if the product stalls.' },
  ],
  split: 'The Risk Architect and the Elder disagree about whether waiting is the safe choice.',
  read: 'Not yet, but not never. The case for hiring rests on revenue that is not booked. Test it with a contractor first and decide on real numbers.',
  checkBack: 'You commit to the contractor trial. Quorum checks back in eight weeks and records what happened.',
}
// v18: the founder's own decision, so the first thing a founder sees is their situation, not a generic one.
const SAMPLE_FOUNDER: SampleContent = {
  decision: 'Should I hire a senior leader or continue managing this function myself?',
  examiner: 'If this function ran without you for a quarter, what would break first?',
  advisors: [
    { key: 'risk_architect', relevance: 'high relevance',   line: 'A senior hire is hard to reverse. Test whether someone else can run the function before you commit to a seat.' },
    { key: 'contrarian',     relevance: 'high relevance',   line: 'You may be hiring to escape a function you dislike, rather than because it needs a leader.' },
    { key: 'elder',          relevance: 'medium relevance', line: 'The seat you fill now shapes who you can hire next year. Hire for where the company is going, not the last two quarters.' },
  ],
  split: 'The Risk Architect would test the function without a hire first. The Elder would hire for where the company is going.',
  read: 'Not yet. Write down what the leader would own and how you would know in 90 days that it is working. If you cannot, the role is not defined well enough to hire for.',
  checkBack: 'You commit to writing the role first. Quorum checks back in 90 days and records what happened.',
}

/** An invented decision, labelled as such. It shows the shape of a result: the question, the split, the read, the check-back. */
function SampleResult({ content }: { content: SampleContent }) {
  const advisor = (key: (typeof ADVISOR_KEYS)[number], relevance: string, line: string) => (
    <div key={key} style={{ padding: '10px 0', borderTop: '1px solid var(--border-dim)' }}>
      <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--text-1)', fontWeight: 600 }}>
        {PERSONAS[key].label}
        <span style={{ fontWeight: 400, color: 'var(--text-4)' }}> · {relevance}</span>
      </p>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--text-2)' }}>{line}</p>
    </div>
  )

  return (
    <div>
      <p style={{ fontSize: 11.5, color: 'var(--text-4)', margin: '0 0 12px' }}>
        An invented example, to show the shape of a result. Not a real person’s decision.
      </p>
      <p style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--text-1)', margin: '0 0 12px' }}>
        “{content.decision}”
      </p>

      <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 4px' }}>The Examiner first asks</p>
      <p style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--text-2)', margin: '0 0 14px' }}>
        {content.examiner}
      </p>

      <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 2px' }}>Advisors, most relevant first</p>
      {content.advisors.map(a => advisor(a.key, a.relevance, a.line))}

      <div style={{ ...card, padding: '10px 12px', margin: '6px 0 14px', borderColor: 'var(--gold-dim)' }}>
        <p style={{ margin: '0 0 4px', fontSize: 11.5, color: 'var(--text-4)' }}>Where they split</p>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--text-1)' }}>
          {content.split}
        </p>
      </div>

      <div style={{ borderLeft: '2px solid var(--gold)', paddingLeft: 12, margin: '0 0 14px' }}>
        <p style={{ margin: '0 0 4px', fontSize: 11.5, color: 'var(--text-4)' }}>The Council’s read</p>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-1)' }}>
          {content.read}
        </p>
      </div>

      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-3)' }}>
        {content.checkBack}
      </p>
    </div>
  )
}

export default function FrontDoorExplainer() {
  const founder = isFounderFrontDoorEnabled()
  const steps   = founder ? FOUNDER_STEPS : STEPS
  return (
    <section aria-label="What happens when you bring a decision" style={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
      <div style={{ ...card, padding: '16px 16px 6px' }}>
        <p style={{ fontSize: 12.5, color: 'var(--text-3)', margin: '0 0 6px' }}>{founder ? 'How a review works' : 'When you bring a decision'}</p>
        {steps.map((s, i) => (
          <p key={s.lead} style={{ margin: 0, padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid var(--border-dim)', fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-2)' }}>
            <strong style={{ color: 'var(--text-1)', fontWeight: 600 }}>{s.lead}</strong> {s.text}
          </p>
        ))}
      </div>

      <Disclosure label="See an example result" section="example">
        <SampleResult content={founder ? SAMPLE_FOUNDER : SAMPLE_LEGACY} />
      </Disclosure>

      <Disclosure label="How it builds as you use it" section="compounding">
        <div>
          {STAGES.map((st, i) => (
            <div key={st.when} style={{ padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid var(--border-dim)' }}>
              <p style={{ margin: '0 0 3px', fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{st.when}</p>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--text-2)' }}>{st.what}</p>
            </div>
          ))}
          <p style={{ margin: '8px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--text-4)' }}>
            Quorum calls an observation early when the evidence is thin, and does not claim to know you from one or two decisions.
          </p>
        </div>
      </Disclosure>
    </section>
  )
}
