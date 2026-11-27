// lib/founder-starters.ts
// ── v18: the founder-first starting points (data) ────────────────────────────────────────────────────────────────────
//
// The commercial message is consequential business decisions; the product stays broad. These are the six decisions a founder or
// owner-operator most often faces alone, in the wording the team chose, shown first on the first-visit screen (components/
// FounderStarters.tsx). The existing category pills remain underneath as "Something else", reordered and none removed.
//
// WHY EACH ONE CARRIES A PLAYBOOK ID. A tap sends the sentence as the first message, and the intake then picks the playbook
// (the question set and decision-specific slots) by keyword. On 25 Nov 2026 the keyword classifier matched only four of these six
// sentences: "hire a senior leader" and "bring on a co-founder" matched nothing, so those two would have been asked generic
// questions although team.hire and business.cofounder exist. A starter therefore says which playbook it is, and the server
// uses it for a NEW chat only (app/api/chat-intake/route.ts), after checking it is a real playbook id.
//
// Wording rules (tests/v18-founder-positioning.test.ts): the sentence is the person's own question, no invented facts, no
// claims about price, sign-up or time. The longer, fact-bearing versions live in lib/post-scenarios.ts for campaign links.

import type { PlaybookId } from '@/lib/types'

export interface FounderStarter {
  /** Stable id, sent with starter_picked as `example` (placement: 'founder_starter'). */
  id:       string
  /** The row shown, and the first message sent. */
  label:    string
  text:     string
  /** The playbook this decision belongs to. Validated server-side. */
  playbook: PlaybookId
}

export const FOUNDER_STARTERS: readonly FounderStarter[] = [
  { id: 'fs_raise',       label: 'Should we raise funding now or continue bootstrapping?',               text: 'Should we raise funding now or continue bootstrapping?',               playbook: 'business.raise_funding' },
  { id: 'fs_hire_leader', label: 'Should I hire a senior leader or continue managing this function myself?', text: 'Should I hire a senior leader or continue managing this function myself?', playbook: 'team.hire' },
  { id: 'fs_new_market',  label: 'Should we enter a new market or focus on our existing market?',        text: 'Should we enter a new market or focus on our existing market?',        playbook: 'business.expand' },
  { id: 'fs_cofounder',   label: 'Should I bring on a co-founder or continue independently?',            text: 'Should I bring on a co-founder or continue independently?',            playbook: 'business.cofounder' },
  { id: 'fs_pricing',     label: 'Should we change our pricing or packaging?',                           text: 'Should we change our pricing or packaging?',                           playbook: 'product.pricing' },
  { id: 'fs_sell',        label: 'Should I sell the company or continue scaling it?',                    text: 'Should I sell the company or continue scaling it?',                    playbook: 'business.sell' },
]

/**
 * The feeder: someone who may become a founder. Shown as a quieter seventh line, never as one of the six. It uses the earlier,
 * richer example text because "I want to leave my job" alone gives the intake nothing concrete to work with.
 */
export const FEEDER_STARTER: FounderStarter = {
  id: 'fs_start_own',
  label: 'Thinking of leaving a job to start something of your own?',
  text: 'I\u2019m thinking of leaving my job to start something of my own.',
  playbook: 'business.start',
}
