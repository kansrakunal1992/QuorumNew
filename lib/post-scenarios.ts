// lib/post-scenarios.ts
// -- Campaign scenarios: a short link that opens the front door with a scenario already in the box ---------------
// A post that talks about "two job offers" should land on a page where the box already says something close to it.
// The existing ?decision=<long encoded text> link does that, but the text is baked into every post and cannot be fixed
// after publishing. A scenario link is short and the wording lives here, so it can be improved without touching a post:
//
//   https://<app>/?scenario=job_offers&utm_source=linkedin&utm_medium=post&utm_campaign=nov_gtm&utm_content=li_post_12
//
// Behaviour is exactly that of ?decision=: lib/url-prefill.ts reads it, the text is put in the box, the visitor edits or
// sends it, and nothing is ever sent for them. ?decision= wins if both are present. An unknown slug is ignored.
//
// Writing rule (tests/post-scenarios.test.ts enforces it): every scenario names what is being chosen between and
// gives at least one concrete fact, so it grades 'medium' or better in scoreRichness() and does not trigger the
// "add what you are choosing between" tip. No price, sign-up or time claims, ever.
//
// Generate a link sheet for a content calendar with: node scripts/build-post-links.mjs

import { INTAKE_EXAMPLES } from './intake-examples'

export interface PostScenario {
  /** Lowercase letters, digits and underscores. This is what goes in the link. */
  slug:  string
  /** A short name for the people planning posts (never shown to visitors). */
  title: string
  /** What lands in the box. */
  text:  string
}

export const SCENARIO_PARAM = 'scenario'
export const SCENARIO_SLUG = /^[a-z0-9_]{2,40}$/

const FROM_EXAMPLES: PostScenario[] = INTAKE_EXAMPLES.map(e => ({ slug: e.id, title: e.label, text: e.text }))

export const POST_SCENARIOS: readonly PostScenario[] = [
  ...FROM_EXAMPLES,
  {
    slug: 'move_city', title: 'A promotion that means moving',
    text: 'I\u2019ve been offered a promotion that means moving to another city. The pay is 20% higher, but my partner and family are settled here.',
  },
  {
    slug: 'co_founder', title: 'Co-founding with a friend',
    text: 'A friend asked me to co-found a company with them. I\u2019d have to quit my job, and I have about 10 months of savings. I\u2019m not sure it\u2019s worth the risk.',
  },
  {
    slug: 'ask_for_raise', title: 'Ask for a raise now or later',
    text: 'I think I\u2019m underpaid by about 15% compared to my team. I\u2019m not sure whether to ask for a raise now or wait until my review in March.',
  },
  {
    slug: 'buy_or_rent', title: 'Buy a flat or keep renting',
    text: 'I can afford a down payment on a flat, but I\u2019m not sure I\u2019ll stay in this city. Should I buy now or keep renting for another 2 years?',
  },
  {
    slug: 'side_project', title: 'Side project: go full time?',
    text: 'I\u2019ve been building a side project for 8 months and it has 40 paying users. Should I go full time on it or keep my job and grow it slowly?',
  },
  {
    slug: 'move_in', title: 'Moving in together',
    text: 'My partner and I disagree about moving in together. I\u2019d like to wait another year, but they want to do it in 3 months. I\u2019m not sure how to decide.',
  },
  {
    slug: 'study_abroad', title: 'A degree abroad vs the debt',
    text: 'I got into a master\u2019s program abroad that costs about 25 lakh. I have a stable job and a good salary now, and I\u2019m not sure the degree is worth the debt or the 2 years away.',
  },
  {
    slug: 'hire_first', title: 'Make a first hire',
    text: 'My business has about 6 months of cash and makes enough to hire one person, but that would use most of my profit. Should I hire now or wait 2 more quarters?',
  },
]

/** The scenario text for a slug, or null for anything unknown or malformed (the link then simply opens a blank box). */
export function scenarioText(slug: unknown): string | null {
  if (typeof slug !== 'string') return null
  const s = slug.trim().toLowerCase()
  if (!SCENARIO_SLUG.test(s)) return null
  return POST_SCENARIOS.find(x => x.slug === s)?.text ?? null
}
