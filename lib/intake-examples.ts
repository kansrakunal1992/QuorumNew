// lib/intake-examples.ts
// -- Landing screen: tappable example openers ---------------------------------------------------------------
// Pure data. components/IntakeExamples.tsx renders it; ChatIntake puts `text` in the box on a tap. It never sends.
//
// Why these are written the way they are:
//   - Each `text` already says what is being chosen between, and gives one concrete fact and one worry or deadline.
//     lib/chat-intake-brief.ts's scoreRichness() grades every one of them at least 'medium', so tapping one does NOT
//     trigger the "Tip: add what you're choosing between" nudge under the box, and the chat asks fewer questions.
//     tests/first-screen-conversion.test.ts keeps it that way.
//   - `label` is the short line shown on the chip; the longer `text` is what lands in the box (editable).
//   - No claims about price, sign-up or time. Copy here must stay true as the product changes.

export interface IntakeExample {
  /** Stable id, sent with starter_picked as `example` (identifier characters only). */
  id:    string
  /** Short line on the chip. */
  label: string
  /** What goes in the box. */
  text:  string
}

export const INTAKE_EXAMPLES: readonly IntakeExample[] = [
  {
    id:    'job_offers',
    label: 'Two job offers: more pay, or a better manager',
    text:  'I have two job offers. One has a higher salary, but the other has a manager I\u2019d learn from. My deadline to answer is Friday.',
  },
  {
    id:    'leave_job',
    label: 'Leaving my job to start something of my own',
    text:  'I want to leave my job and start something of my own. I have about 8 months of savings, and my partner is worried about the risk.',
  },
  {
    id:    'hard_conversation',
    label: 'A hard conversation I keep putting off',
    text:  'I keep putting off a hard conversation with my manager about my workload. Should I raise it now or wait until after the deadline?',
  },
  {
    id:    'loan_or_invest',
    label: 'Pay off a loan early, or invest instead',
    text:  'I can pay off my loan early or invest the money instead. I have 6 months of expenses saved, and I\u2019m not sure which is smarter.',
  },
]

/** Examples after this index are hidden on short screens, so the first three always fit above the fold. */
export const INTAKE_EXAMPLES_SHORT_SCREEN_COUNT = 3

// -- One-tap start ---------------------------------------------------------------------------------------------
// For the visitor who cannot put it into words yet. Tapping one SENDS `text` as the first message, in guided mode
// (ChatIntake: send(..., { walkthrough: true })), and Quorum asks the next small question with tap-answers.
// `text` reads as the person speaking, because it becomes their first chat bubble.
export interface IntakeQuickStart {
  /** Stable id, sent with starter_picked as `example` (placement: 'quick_start'). */
  id:    string
  /** The pill. */
  label: string
  /** The first message. */
  text:  string
}

export const INTAKE_QUICK_STARTS: readonly IntakeQuickStart[] = [
  { id: 'qs_career',        label: 'Career',        text: 'It\u2019s about my career.' },
  { id: 'qs_money',         label: 'Money',         text: 'It\u2019s about money.' },
  { id: 'qs_business',      label: 'Business',      text: 'It\u2019s about my business.' },
  { id: 'qs_relationships', label: 'Relationships', text: 'It\u2019s about a relationship.' },
  { id: 'qs_personal',      label: 'Personal',      text: 'It\u2019s a personal life decision.' },
  { id: 'qs_small',         label: 'Smaller calls', text: 'It\u2019s a smaller, everyday decision.' },
]
