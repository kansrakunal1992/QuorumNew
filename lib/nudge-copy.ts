/**
 * lib/nudge-copy.ts
 *
 * Daily decision-logging nudge copy bank.
 * 30 variants across 7 judgment themes (A–G).
 * Rotation: deterministic per (userId × day-of-year) — different users,
 * different messages on the same day; same user, full 30-day cycle before repeat.
 *
 * Personalisation tokens (resolved at send time, zero extra AI cost):
 *   {{session_count}}  — user's total logged decisions (always available)
 *   {{bias_label}}     — user's top recurring bias in plain English
 *                        (only injected when bias_library has ≥1 row for user)
 *
 * Variants that require {{bias_label}} are automatically excluded from the
 * eligible pool when the user has no bias data. Selection falls back gracefully.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type NudgeToken = 'session_count' | 'bias_label'

export type NudgeTheme =
  | 'daily_decision'
  | 'judgment_record'
  | 'blind_spots'
  | 'confidence'
  | 'contradictions'
  | 'long_term'
  | 'exec_lens'

export interface NudgeVariant {
  /** Thematic bucket — useful for analytics / future A/B weighting */
  theme: NudgeTheme
  /**
   * Tokens this variant requires. If a required token has no value for a user,
   * the variant is excluded from that user's eligible pool.
   */
  tokens?: NudgeToken[]
  push: {
    /** ≤ ~55 chars — rendered as notification title */
    title: string
    /** ≤ 90 chars — rendered as notification body */
    body: string
  }
  email: {
    /** ≤ 60 chars */
    subject: string
    /** Plain prose, ≤ 120 words. Wrapped in HTML by the cron route. */
    body: string
  }
}

export interface ResolvedNudge {
  push: { title: string; body: string }
  email: { subject: string; body: string }
}

// ─── Copy bank ────────────────────────────────────────────────────────────────

export const NUDGE_VARIANTS: NudgeVariant[] = [
  // ── A: Daily Decision ───────────────────────────────────────────────────────

  {
    theme: 'daily_decision',
    push: {
      title: "What's sitting unresolved today?",
      body: "The decision you're circling is usually the right one to log.",
    },
    email: {
      subject: "The decision you haven't named yet",
      body: "There's usually one decision hovering at the edge of your attention today. Not the calendar item — the real one. The one you've been weighing between calls, in transit, at the margins of everything else. Most executives don't lose on the announced decisions. They lose on the ones they never quite examined. Log it.",
    },
  },

  {
    theme: 'daily_decision',
    tokens: ['session_count'],
    push: {
      title: 'Add to your record today.',
      body: '{{session_count}} decisions logged. What belongs in there next?',
    },
    email: {
      subject: 'Your record: {{session_count}} entries',
      body: "You've logged {{session_count}} decisions. Each one preserved what you actually thought before the outcome revised your memory. The record only compounds if it keeps growing. What belongs in it today?",
    },
  },

  {
    theme: 'daily_decision',
    push: {
      title: 'The avoided decision is the interesting one.',
      body: "What are you circling but not quite committing to today?",
    },
    email: {
      subject: "What you're not quite deciding yet",
      body: "The decisions that get logged are rarely the hard ones. The hard ones get circled, revisited, set aside, and circled again. They're avoided precisely because they involve something real — a commitment you're not ready to name, a change that actually matters, a relationship that complicates things. That's usually the one worth logging. What's yours today?",
    },
  },

  {
    theme: 'daily_decision',
    push: {
      title: 'Capture it before it becomes a memory.',
      body: 'A decision recorded now is different from one remembered later.',
    },
    email: {
      subject: 'Before this becomes a memory',
      body: "There's a difference between a decision and a memory of one. In memory, you were confident for the right reasons. The doubts were smaller than they were. The reasoning was cleaner than it was. The only honest account is the one you record before the outcome arrives. What are you deciding today?",
    },
  },

  {
    theme: 'daily_decision',
    push: {
      title: "Name what's actually on your mind.",
      body: 'The clearest thinking happens before a decision is final.',
    },
    email: {
      subject: "What's occupying you right now",
      body: "Not every decision requires a full examination. Some just need to be named — stated plainly, with your actual reasoning attached. There's value in the articulation alone: it surfaces what you're really weighing and what you're avoiding. What's taking up real estate in your thinking today? Put it on the record.",
    },
  },

  // ── B: Judgment Record ──────────────────────────────────────────────────────

  {
    theme: 'judgment_record',
    push: {
      title: "Judgment compounds only when it's recorded.",
      body: 'What did you decide today?',
    },
    email: {
      subject: "Judgment that isn't recorded, fades",
      body: 'Experience accumulates automatically. Judgment — the ability to read a situation accurately and act well under uncertainty — only compounds if it has been examined. You cannot learn from a decision you cannot remember clearly. Every entry in your record is an investment in the quality of your future thinking. What belongs in there today?',
    },
  },

  {
    theme: 'judgment_record',
    push: {
      title: 'Decisions become lessons only when captured.',
      body: 'The pattern requires data. Log one today.',
    },
    email: {
      subject: "Decisions that don't get examined, repeat",
      body: "The same mistake rarely arrives wearing the same costume. It returns dressed differently — different sector, different relationship, different stakes. The only reliable way to recognise a recurring pattern in your thinking is to have kept a record of the earlier instances. What are you deciding today?",
    },
  },

  {
    theme: 'judgment_record',
    push: {
      title: "Your future self will want today's record.",
      body: 'What decision is worth logging right now?',
    },
    email: {
      subject: 'A record your future self will use',
      body: "You'll be making decisions in five years that depend on understanding how you think today — your assumptions, your confidence levels, your reasoning under pressure. The record you build now is data for the future version of you. What belongs in it today?",
    },
  },

  {
    theme: 'judgment_record',
    push: {
      title: 'An unrecorded decision is just an opinion.',
      body: 'Make it a data point instead.',
    },
    email: {
      subject: 'Opinion, or record — which is it?',
      body: 'Memory is confident about things it was never certain of. It edits reasoning to fit outcomes, rounds off the uncomfortable parts, makes the call look cleaner or messier than it was. The record preserves the decision as it actually stood — before the outcome did its editing. What are you deciding today?',
    },
  },

  {
    theme: 'judgment_record',
    tokens: ['session_count'],
    push: {
      title: 'Your record grows one decision at a time.',
      body: '{{session_count}} entries in. What belongs there next?',
    },
    email: {
      subject: '{{session_count}} decisions and counting',
      body: "You've captured {{session_count}} decisions. Each one is a data point on how you reason under uncertainty — what you weight, what you avoid, where your confidence tends to land. The picture sharpens with every entry. What belongs in there today?",
    },
  },

  // ── C: Blind Spots ──────────────────────────────────────────────────────────

  {
    theme: 'blind_spots',
    push: {
      title: 'Every decision hides an assumption.',
      body: "What are you treating as fact today?",
    },
    email: {
      subject: "The assumption in today's decision",
      body: "Every decision contains at least one assumption operating as a fact. It's not deliberate — it just never got examined. Before you move on something today, ask: what is this decision actually resting on? Which part of the logic collapses if the assumption beneath it turns out to be wrong?",
    },
  },

  {
    theme: 'blind_spots',
    push: {
      title: 'What are you treating as certain today?',
      body: 'It might be a guess dressed as data.',
    },
    email: {
      subject: 'Fact, or assumption dressed as one?',
      body: "High-stakes decisions rarely fail because of bad data. They fail because of assumptions that were never tested — treated as established fact, never examined. Before you commit to something today, name the assumption your reasoning is most dependent on. Then ask when you last actually verified it.",
    },
  },

  {
    theme: 'blind_spots',
    push: {
      title: "The question you haven't asked yet.",
      body: 'Log the decision. Find out what it is.',
    },
    email: {
      subject: "The question you haven't asked",
      body: "Most decisions that go wrong weren't obviously wrong at the time. They were made with incomplete information that felt complete. The critical question was somewhere in the room — it just wasn't asked. What's the one question that would change your thinking on today's decision if you let yourself ask it?",
    },
  },

  {
    theme: 'blind_spots',
    tokens: ['bias_label'],
    push: {
      title: 'Your blind spot has a pattern.',
      body: '{{bias_label}} showed up in your record. Is it in play today?',
    },
    email: {
      subject: 'A pattern your record already surfaced',
      body: "Blind spots aren't random. They cluster around the same conditions — your signature pressures, your preferred framings, the narratives you return to under uncertainty. Your record has already surfaced {{bias_label}} as a recurring tendency. Worth asking whether it's active in whatever you're deciding today.",
    },
  },

  {
    theme: 'blind_spots',
    tokens: ['bias_label'],
    push: {
      title: 'Every decision hides an assumption.',
      body: 'Your record flagged {{bias_label}}. Is it running today?',
    },
    email: {
      subject: 'The assumption your record already knows',
      body: "Your record has already surfaced a recurring pattern: {{bias_label}}. Not as a judgment — as a data point on how you tend to reason under specific conditions. It's worth asking whether that same pattern is present in today's decision, before you find out the hard way that it was.",
    },
  },

  // ── D: Confidence Calibration ───────────────────────────────────────────────

  {
    theme: 'confidence',
    push: {
      title: 'How confident are you, exactly?',
      body: 'Record it now. Reality votes later.',
    },
    email: {
      subject: 'Your confidence before reality votes',
      body: "The most useful thing you can record about a decision isn't the reasoning — it's your confidence level at the moment you made it. Before the outcome edits your memory. Before hindsight makes the call look easier or harder than it was. How certain are you today?",
    },
  },

  {
    theme: 'confidence',
    push: {
      title: "Record today's certainty before it shifts.",
      body: 'Your future self will want to know.',
    },
    email: {
      subject: 'Certainty is hardest to measure after',
      body: "You'll remember the decision. You probably won't remember accurately how certain you felt going in. Memory rounds it to fit the outcome. The only way to preserve an honest confidence reading is to record it before you know how it ends. What are you deciding today, and how certain are you?",
    },
  },

  {
    theme: 'confidence',
    push: {
      title: 'You have an honest confidence reading right now.',
      body: 'Lock it in before the outcome arrives.',
    },
    email: {
      subject: 'A reading worth taking now',
      body: "Before the outcome is known, you have something rare: an unrevised read on your own certainty. Once the result lands, that reading is gone — overwritten by what you now know happened. Your record is the only place it survives intact. What are you deciding today, and what's your honest confidence level?",
    },
  },

  {
    theme: 'confidence',
    push: {
      title: 'When did you last misjudge your confidence?',
      body: "Today's decision is a chance to track it.",
    },
    email: {
      subject: 'Tracking confidence before it rewrites',
      body: "Calibration isn't about being right or wrong. It's about understanding whether your certainty levels are systematically high or low — and in which conditions. You can only build that picture by recording what you actually believed before each decision resolved. What's on your mind today?",
    },
  },

  // ── E: Contradictions ───────────────────────────────────────────────────────

  {
    theme: 'contradictions',
    push: {
      title: 'Are your decisions matching your principles?',
      body: "Log today's. Your record can tell you.",
    },
    email: {
      subject: 'Do your decisions match your principles?',
      body: "It's easy to articulate values. It's harder to notice when a specific decision quietly violates one. Not dramatically — just a small compromise, a reasonable exception, a practical concession. Over time, those accumulate into a gap between stated principle and actual behaviour. Your record is where that gap becomes visible. What are you deciding today?",
    },
  },

  {
    theme: 'contradictions',
    push: {
      title: 'What would your past self think of this?',
      body: "Log today's decision and compare.",
    },
    email: {
      subject: 'What your past self would think',
      body: "The version of you making decisions two years ago had a particular set of convictions. Some were right. Some have been quietly revised. The interesting question isn't whether you've changed — it's whether you know which of your current positions would surprise your earlier self, and whether that's deliberate. What are you deciding today?",
    },
  },

  {
    theme: 'contradictions',
    push: {
      title: 'Consistency is a choice you make daily.',
      body: "Is today's decision consistent with what you've committed to?",
    },
    email: {
      subject: 'The consistency question',
      body: "Principles are easy to hold in the abstract. The test is in the specific — a real decision, under actual pressure, with genuine trade-offs. Where do your decisions consistently align with your stated commitments, and where do they consistently diverge? The record is the audit that runs continuously. What belongs in yours today?",
    },
  },

  {
    theme: 'contradictions',
    push: {
      title: "Your record knows things your memory doesn't.",
      body: 'Log today. Let the pattern speak.',
    },
    email: {
      subject: 'What your record knows about you',
      body: "Memory is a curated version of events. It edits for coherence, softens the uncomfortable details, makes the reasoning look cleaner than it was. Your record, when it's honest, preserves the version before the editing. That's where contradictions become visible — not as accusations, but as data. What are you deciding today?",
    },
  },

  // ── F: Long-Term Perspective ─────────────────────────────────────────────────

  {
    theme: 'long_term',
    push: {
      title: "Which of today's decisions matters in 5 years?",
      body: "Probably the one you're not logging.",
    },
    email: {
      subject: 'The decision that will matter in 5 years',
      body: "Most of what feels urgent today won't register in five years. And at least one thing that feels routine today will turn out to have mattered significantly. The difficulty is that it's hard to tell which is which in the moment. That's what a record is for — not to sort them in advance, but to capture them while they're live. What's on your mind today?",
    },
  },

  {
    theme: 'long_term',
    push: {
      title: 'Future-you already knows how this ends.',
      body: 'Record what present-you actually thinks.',
    },
    email: {
      subject: 'A note to the version of you who knows',
      body: "In five years, you'll have a clear view of how today's decisions played out. That version of you knows which assumptions held and which didn't. Present-you doesn't have that view. Recording what you actually think right now — before the verdict — is the only honest account that future-you will trust.",
    },
  },

  {
    theme: 'long_term',
    push: {
      title: 'Short-term logic, long-term consequences.',
      body: "What's the 5-year read on today's decision?",
    },
    email: {
      subject: "The 5-year read on today's decision",
      body: "Most decisions are evaluated on a timeline shorter than their actual consequence window. A decision that looks clean at 90 days can look different at three years. Asking — before deciding — what this looks like on a longer horizon doesn't slow things down. It changes what you're optimising for. What are you working through today?",
    },
  },

  {
    theme: 'long_term',
    push: {
      title: "What's the compounding decision today?",
      body: 'The small ones accumulate. Log it.',
    },
    email: {
      subject: 'The ones that compound quietly',
      body: "Not every consequential decision arrives with a flag on it. Some of the most significant ones look like minor adjustments — a relationship weighted differently, a policy set quietly, a commitment made without announcement. The compounding ones are often the routine ones. What are you deciding today that might be larger than it appears?",
    },
  },

  // ── G: Founder / Executive Lens ─────────────────────────────────────────────

  {
    theme: 'exec_lens',
    push: {
      title: 'Most business problems are judgment problems.',
      body: 'Log one today. Build the record.',
    },
    email: {
      subject: 'Most business problems are judgment problems',
      body: "Strategy failures, hiring mistakes, capital misallocations — they rarely trace back to information gaps. They trace back to how that information was weighted, filtered, and acted on. You can't improve judgment by reading about it. You improve it by examining your own decisions, systematically, over time. What's on your mind today?",
    },
  },

  {
    theme: 'exec_lens',
    push: {
      title: 'The expensive mistake rarely starts as one.',
      body: 'What are you rationalising today?',
    },
    email: {
      subject: 'The expensive mistake rarely looks like one',
      body: "The decisions that end up costing the most rarely felt wrong at the time. They felt reasonable — consistent with past experience, supported by available information, validated by people you trusted. That's precisely what makes them worth examining before they resolve, not after. What are you moving on today?",
    },
  },

  {
    theme: 'exec_lens',
    tokens: ['session_count'],
    push: {
      title: '{{session_count}} decisions on record.',
      body: "Each is a read on how you think. What's today's?",
    },
    email: {
      subject: '{{session_count}} decisions — what they reveal',
      body: "Your record has {{session_count}} decisions in it. That's {{session_count}} data points on how you reason under real pressure — what you weight, what you avoid, where your certainty tends to cluster. The picture only sharpens if you keep building it. What belongs in there today?",
    },
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a raw BIAS_PARAMETERS label to an inline-readable string.
 *
 * "FOMO / Manufactured Urgency"     → "manufactured urgency"
 * "Overconfidence"                  → "overconfidence"
 * "Attribution Asymmetry"           → "attribution asymmetry"
 */
export function toInlineBiasLabel(rawLabel: string): string {
  const parts = rawLabel.split(' / ')
  return (parts.length > 1 ? parts[1] : parts[0]).toLowerCase()
}

/**
 * Stable numeric hash of a UUID string (used for per-user variant offset).
 * Different users get different variants on the same calendar day.
 */
function userIdHash(userId: string): number {
  let h = 0
  for (let i = 0; i < userId.length; i++) {
    h = (Math.imul(31, h) + userId.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

/** Day-of-year (1–366) — provides the daily rotation axis. */
function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0)
  return Math.floor((d.getTime() - start.getTime()) / 86_400_000)
}

/**
 * Deterministically select a nudge variant for a given user on a given date.
 *
 * @param userId        Supabase auth user UUID
 * @param now           Current date (UTC)
 * @param hasBiasLabel  True only when user has ≥1 row in bias_library
 *
 * Variants requiring {{bias_label}} are excluded when hasBiasLabel is false,
 * so the eligible pool is always safe to resolve without a missing token.
 */
export function selectNudgeVariant(
  userId: string,
  now: Date,
  hasBiasLabel: boolean,
): NudgeVariant {
  const eligible = hasBiasLabel
    ? NUDGE_VARIANTS
    : NUDGE_VARIANTS.filter(v => !v.tokens?.includes('bias_label'))

  const index = (dayOfYear(now) + userIdHash(userId)) % eligible.length
  return eligible[index]
}

/**
 * Replace {{token}} placeholders with resolved values.
 * Returns copy-ready push and email objects.
 *
 * @param variant        Raw variant from NUDGE_VARIANTS
 * @param sessionCount   User's total session count
 * @param biasLabel      Already converted via toInlineBiasLabel() — or ''
 */
export function resolveVariantTokens(
  variant: NudgeVariant,
  sessionCount: number,
  biasLabel: string,
): ResolvedNudge {
  const sub = (str: string) =>
    str
      .replace(/\{\{session_count\}\}/g, String(sessionCount))
      .replace(/\{\{bias_label\}\}/g, biasLabel)

  return {
    push: {
      title: sub(variant.push.title),
      body: sub(variant.push.body),
    },
    email: {
      subject: sub(variant.email.subject),
      body: sub(variant.email.body),
    },
  }
}
