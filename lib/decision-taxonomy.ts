// lib/decision-taxonomy.ts
// ── Which KIND of decision is this? A deterministic first read of the person's own words (pure) ─────────────────────
//
// WHY THIS EXISTS
// The intake planner (an LLM call) normally picks decisionKind each turn. Two situations it does not cover:
//   1. The planner is down, slow or returns something unusable. Previously the kind then stayed unset and the chat
//      quietly fell back to the generic `other` slots for a decision like "should I buy this flat?".
//   2. Nobody can tell how well the taxonomy covers what people actually type. This module is also the thing the
//      coverage test (tests/decision-taxonomy.test.ts + tests/fixtures/decision-corpus.ts) runs a corpus of real-world
//      decision phrasings against, so "how much falls into `other`?" is a number, not a feeling.
//
// DESIGN
//  - Conservative on purpose. A wrong kind asks the wrong questions, which is worse than the generic `other` ones, so
//    a rule has to clear SCORE_THRESHOLD (one strong signal, or several weak ones) before this returns anything.
//  - It never overrides the planner: it only fills a kind that is missing (see mergeNotes in lib/chat-intake-turn.ts).
//  - Ties are broken by RULE_ORDER, most specific first (a home loan is a housing decision before it is a money one).
//
// GROWING IT: the right source of new rules is the data, not a guess — see docs/DECISION_TAXONOMY.md for the query
// that lists the most common decisions currently landing in `other`.

import type { DecisionKind } from '@/lib/types'

interface Rule {
  kind:   DecisionKind
  /** Each match is worth 3: one is enough on its own. */
  strong: RegExp[]
  /** Each match is worth 1: needs company. */
  weak?:  RegExp[]
}

export const SCORE_THRESHOLD = 3

const HOME = '(?:house|home|flat|apartment|condo|villa|plot|property|bungalow|penthouse|townhouse|farmhouse|studio)'
const WORK_ROLE = '(?:employee|engineer|developer|designer|manager|candidate|intern|contractor|analyst|sales ?rep|cto|cfo|coo|head of \\w+|team lead|direct report|team member|co-?founder|assistant|recruiter|ops)'

// Order = tie-break priority AND the order rules are evaluated in.
const RULES: Rule[] = [
  {
    kind: 'housing',
    strong: [
      new RegExp(`\\b(?:buy|buying|purchase|purchasing|sell|selling|rent|renting|lease|leasing|renovat\\w*|remodel\\w*|rebuild\\w*|downsiz\\w*|upsiz\\w*)\\b.{0,40}\\b${HOME}\\b`, 'i'),
      new RegExp(`\\b${HOME}\\b.{0,30}\\b(?:purchase|sale|renovation|remodel\\w*|loan|mortgage)\\b`, 'i'),
      /\b(?:renovat\w*|remodel\w*|refurbish\w*|redo|redoing)\b.{0,30}\b(?:kitchen|bathroom|bedroom|living room|roof|basement|garage|terrace|balcony|interiors?)\b/i,
      /\b(?:mortgage|home loan|housing loan|down ?payment|stamp duty|under[- ]construction|ready[- ]to[- ]move)\b/i,
      /\b(?:rent (?:vs\.?|or|versus) buy|buy (?:vs\.?|or|versus) rent|renew (?:my|the|our) lease|break (?:my|the|our) lease)\b/i,
    ],
    weak: [/\b(?:landlord|tenant|broker|realtor|builder|possession|registry|carpet area|emi|real estate)\b/i],
  },
  {
    kind: 'health',
    strong: [
      /\b(?:surgery|operation|chemo\w*|radiation|biopsy|dialysis|transplant|ivf|angioplasty|bypass|c-?section|knee replacement|hip replacement|lasik|vaccin\w*|medication|prescription|diagnos\w+)\b/i,
      /\b(?:treatment|therapy|procedure|scan|test results?)\b.{0,40}\b(?:doctor|specialist|surgeon|hospital|clinic|diagnos\w+|symptoms?)\b/i,
      /\b(?:second opinion|my doctor|the doctor|a doctor|the surgeon|my surgeon|specialist)\b.{0,50}\b(?:says?|said|recommend\w*|advis\w*|suggest\w*)\b/i,
      /\b(?:go|going|start|starting|stop|stopping|quit|quitting|begin|beginning) (?:on |taking |with )?(?:antidepressants?|statins?|insulin|hormone therapy|trt|ozempic|medication|therapy|counselling|counseling|rehab)\b/i,
    ],
    weak: [/\b(?:doctor|hospital|clinic|symptoms?|pain|health|medical|surgeon|specialist)\b/i],
  },
  {
    kind: 'family',
    strong: [
      /\b(?:have|having|try(?:ing)? for|plan(?:ning)? for) (?:a |another |our first |our second )?(?:baby|child|kid|kids|second child|first child)\b/i,
      /\b(?:start(?:ing)? a family|adopt(?:ing)? (?:a |an |the )?(?:child|baby|kid|son|daughter)|surrogacy|foster(?:ing)? (?:a )?child)\b/i,
      /\b(?:which|what|best|choose|choosing|pick|picking|change|changing|switch|switching) (?:a )?school\b.{0,40}\b(?:my|our|for)\b|\bschool for (?:my|our) (?:son|daughter|kid|kids|child|children)\b/i,
      /\b(?:homeschool\w*|boarding school|daycare|day care|nanny|creche)\b/i,
      /\b(?:assisted living|old age home|nursing home|care home|elder ?care)\b/i,
      /\b(?:care for|caring for|look(?:ing)? after|take care of)\b.{0,30}\b(?:parents?|mother|father|mom|dad|in-laws?|grand\w+)\b/i,
      /\b(?:move|moving|bring|bringing) (?:my|our) (?:parents?|mother|father|mom|dad|in-laws?)\b.{0,15}\b(?:in|home|over)\b/i,
    ],
    weak: [/\b(?:my|our) (?:son|daughter|kids?|child|children|toddler|newborn|parents?|in-laws?)\b/i],
  },
  {
    kind: 'team',
    strong: [
      new RegExp(`\\b(?:hire|hiring|fire|firing|lay ?off|laying off|promote|promoting|demote|demoting|replace|replacing|onboard\\w*)\\b.{0,40}\\b${WORK_ROLE}\\b`, 'i'),
      new RegExp(`\\b${WORK_ROLE}\\b.{0,40}\\b(?:underperform\\w*|not performing|not delivering|missing deadlines|keeps? missing|poor performance|performance (?:issue|problem|review)|toxic|disruptive|resign\\w*|poach\\w*)\\b`, 'i'),
      /\b(?:let (?:him|her|them|someone|\w+) go|let go of|on a pip|\bpip\b|performance improvement plan|reorg\w*|restructur\w+ (?:the |my |our )?(?:\w+ )?(?:team|org|department|company)|lay ?offs?|laying off)\b/i,
    ],
    weak: [/\b(?:my team|direct reports?|headcount|hiring plan|org chart)\b/i],
  },
  {
    kind: 'product',
    strong: [
      /\b(?:graphql|rest api|grpc|kubernetes|serverless|react native|flutter|open[- ]sourc\w+|sdk|roadmap|backlog|sprint|mvp|tech stack|build (?:vs\.?|or|versus) buy|microservices?|monolith|go-to-market|gtm|product[- ]market fit|feature flag|api design|re-?platform\w*|rewrite (?:the |our |my )?(?:app|codebase|backend|frontend|platform|service)|migrat\w+ (?:to|from) (?:aws|gcp|azure|kubernetes|postgres|mongodb|react|next|a new))\b/i,
      /\b(?:ship|shipping|launch|launching|deprecat\w+|sunset\w*|prioriti[sz]\w+|descop\w+)\b.{0,40}\b(?:feature|release|version|product|module|integration|v\d|beta)\b/i,
      /\b(?:pricing (?:model|tier|plan|page)|freemium|usage[- ]based pricing|raise (?:our |my |the )?prices?|change (?:our |my |the )?pricing)\b/i,
    ],
    weak: [/\b(?:saas|customers?|users?|engineering|developers?|codebase|api|startup|product)\b/i],
  },
  {
    kind: 'career_exit',
    strong: [
      /\b(?:quit|quitting|resign\w*|leave|leaving|walk away from|step down from|exit)\b.{0,25}\b(?:my |the |this |current )?(?:job|work|company|role|career|position|employer|firm|corporate|9[- ]?to[- ]?5)\b/i,
      /\b(?:sabbatical|burn(?:ed|t)? ?out|career break|notice period|resignation)\b/i,
      /\b(?:take|taking) (?:a )?(?:break|gap year|year off)\b.{0,30}\b(?:work|career|job)\b/i,
    ],
  },
  {
    kind: 'job_offer',
    strong: [
      /\b(?:job offer|offer letter|counter-?offer|counter an offer|accept(?:ing)? (?:the|this|an?|that) (?:offer|job|role|position)|decline (?:the|this|an?) offer|competing offers?|two offers?|offer from)\b/i,
      /\b(?:ctc|esops?|equity (?:package|offer)|compensation package|joining bonus|notice buyout)\b/i,
    ],
    weak: [/\b(?:offer|offered|recruiter|hr)\b/i, /\b(?:package|salary|raise)\b/i],
  },
  {
    kind: 'relocation',
    strong: [
      /\b(?:move|moving|relocat\w+|shift|shifting|migrat\w+|emigrat\w+|immigrat\w+|settle|settling)\s+(?:(?:back|over|out)\s+)?(?:to|abroad|overseas|out of|another (?:city|country|state))\b/i,
      /\b(?:move|moving|relocat\w+|shift|shifting)\s+from\s+[A-Z][\w-]+(?:\s[A-Z][\w-]+)?\s+to\s+[A-Z][\w-]+/,
      /\b(?:move abroad|move overseas|move back home|move back to|leave (?:the )?(?:country|city)|work permit|green card|pr visa|h-?1b|blue card|skilled worker visa)\b/i,
    ],
    weak: [/\b(?:visa|abroad|overseas|new city|expat)\b/i],
  },
  {
    kind: 'education',
    strong: [
      /\b(?:mba|m\.?tech|m\.?s\.?|masters?|phd|doctorate|degree|bootcamp|certification|diploma|gmat|gre|cat exam|upsc|ielts|toefl|post-?grad\w*|undergrad\w*|executive (?:mba|program)|study abroad|online course|part-?time (?:degree|mba|masters?))\b/i,
      /\b(?:fund|funding|finance|financing|pay for|afford)\b.{0,25}\b(?:masters?|mba|degree|phd|college|university|studies|tuition|bootcamp)\b/i,
      /\bwhich (?:college|university|course|stream|degree|program(?:me)?)\b/i,
      /\b(?:go back to|return to|enroll(?:ing)? (?:in|for)|apply(?:ing)? (?:to|for)) (?:school|college|university|a university|grad school|a program|a course)\b/i,
    ],
    weak: [/\b(?:course|university|college|tuition|scholarship|student loan|semester|curriculum)\b/i],
  },
  {
    kind: 'business',
    strong: [
      /\b(?:start(?:ing)?|launch(?:ing)?|open(?:ing)?|found(?:ing)?|build(?:ing)?|begin(?:ning)?) (?:a |my |our |an? own )?(?:own )?(?:business|company|startup|start-up|venture|agency|firm|shop|store|restaurant|cafe|franchise|side hustle|consultancy|clinic)\b/i,
      /\b(?:raise (?:funding|money|capital|a round|a seed|a series)|take (?:vc|investor|outside) (?:money|funding)|bootstrap\w*|term sheet|valuation|cap table|acqui(?:re|sition)|sell (?:my|the|our) (?:company|business|startup)|buy out|buyout|shut ?(?:ting)? down (?:my|the|our) (?:company|business|startup)|wind ?(?:ing)? down (?:my|the|our) (?:company|business|startup))\b/i,
      /\bfranchise\b/i,
      /\b(?:co-?founders?|business partner)\b.{0,30}\b(?:split|exit|leave|equity|dispute|conflict|buy ?out|fight)\b/i,
    ],
    weak: [/\b(?:investors?|runway|revenue|profit|my business|my company|my startup|clients?)\b/i],
  },
  {
    kind: 'purchase',
    strong: [
      /\b(?:buy|buying|purchase|purchasing|upgrade|upgrading|get|getting|replace|replacing|lease|leasing|finance|financing)\b.{0,40}\b(?:car|suv|sedan|hatchback|bike|motorcycle|scooter|ev|electric (?:car|vehicle)|tesla|phone|iphone|android|laptop|macbook|tablet|ipad|tv|camera|watch|sofa|furniture|mattress|wardrobe|ring|jewel\w*|gold|piano|guitar|drone|console|ps5|treadmill|bicycle|boat|caravan|rv)\b/i,
      /\b(?:worth (?:buying|it to buy)|should i (?:buy|splurge on)|is it worth (?:the )?(?:price|cost|money))\b/i,
    ],
  },
  {
    kind: 'relationship',
    strong: [
      /\b(?:break ?up|breaking up|divorce|divorcing|separat\w+|get(?:ting)? married|marry(?:ing)?|marriage|propose|proposing|engagement|get(?:ting)? back together|ex-?(?:boyfriend|girlfriend|husband|wife|partner)|move in together|living together|long[- ]distance|cheat\w*|infidelity|affair|toxic (?:friend|relationship|partner|boss|family)|cut (?:off|ties with)|stay(?:ing)? (?:in|with) (?:my |the |this )?(?:marriage|relationship)|leave (?:my |him|her|them)\b.{0,10}(?:husband|wife|partner|boyfriend|girlfriend))\b/i,
      /\b(?:end|ending|save|saving|lose|losing) (?:the |our |my )?(?:friendship|marriage|relationship)\b/i,
      /\b(?:forgive|forgiving|reconcile|reconciling|apologi[sz]e|confront(?:ing)?|fall(?:ing)? out)\b.{0,30}\b(?:friend|brother|sister|mother|father|mom|dad|husband|wife|partner|boyfriend|girlfriend|colleague)\b/i,
    ],
    weak: [/\b(?:boyfriend|girlfriend|husband|wife|partner|spouse|fianc\w+|dating|relationship)\b/i],
  },
  {
    kind: 'money',
    strong: [
      /\b(?:invest\w*|stocks?|equities|mutual funds?|index funds?|etfs?|sips?|crypto\w*|bitcoin|ethereum|bonds?|gold etf|portfolio|asset allocation|nifty|sensex|s&p|ppf|nps|401\(?k\)?|ira|roth|fd|fixed deposit|annuity|pension|fire number|retire(?:ment)?|retire early|early retirement)\b/i,
      /\b(?:pay (?:off|down)|prepay\w*|clear)\b.{0,25}\b(?:loan|debt|mortgage|credit card|emi)\b|\b(?:take|taking|get|getting|apply for) (?:a |an )?(?:personal |business |education |car )?loan\b/i,
      /\b(?:lend|lending|borrow|borrowing|lump ?sum|windfall|inheritance|bonus money|emergency fund|savings? (?:rate|account|goal)|tax (?:saving|planning|regime)|insurance (?:policy|plan|cover)|term insurance|health insurance|life insurance)\b/i,
    ],
    weak: [/\b(?:money|savings?|debt|loan|interest|returns?|rupees?|dollars?|lakhs?|crores?|salary)\b/i],
  },
]

export const RULE_ORDER: readonly DecisionKind[] = RULES.map(r => r.kind)

const count = (res: RegExp[] | undefined, text: string): number => (res ?? []).reduce((n, re) => n + (re.test(text) ? 1 : 0), 0)

export interface KindGuess {
  kind:  DecisionKind
  score: number
}

/** Scores every rule against the text. Highest wins; ties go to the earlier (more specific) rule. Null when nothing clears the bar. */
export function classifyDecisionText(raw: string | null | undefined): KindGuess | null {
  const text = (raw ?? '').replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim()
  if (text.length < 8) return null
  let best: KindGuess | null = null
  for (const rule of RULES) {
    const score = count(rule.strong, text) * 3 + count(rule.weak, text)
    if (score >= SCORE_THRESHOLD && (!best || score > best.score)) best = { kind: rule.kind, score }
  }
  return best
}

export function classifyKind(raw: string | null | undefined): DecisionKind | null {
  return classifyDecisionText(raw)?.kind ?? null
}
