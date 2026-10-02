// lib/hero-cards.ts
// ── Natural Intake hero card rotation (item 6 plan, Phase 2) ────────────────
//
// The classic home page (app/HomeClient.tsx) renders up to five Mirror/
// status mechanisms in a fixed vertical stack below the input — Memory
// Engine status, the Mirror open-loop teaser, and (once Elite-unlocked)
// Pattern Surface, Calibration Reveal and Recurring Condition. That's fine
// on a long scrolling page; it's crowding on the Natural Intake hero, which
// is meant to read as "one clear next step," not a dashboard.
//
// Fix: compute which of the five are actually *eligible* for this user
// (same gating conditions HomeClient already uses), and show all of them —
// app/NaturalIntakeClient.tsx calls eligibleHeroCards() directly.
//
// UPDATE (Sept 2026, Kunal's call): the original version of this file
// capped display to the top two of those eligible, rotating which two
// showed on each fresh visit. That cap is removed — every eligible card
// shows now. pickTopHeroCards() and getAndAdvanceHeroRotationIndex()
// (lib/storage.ts) are left in place below, unused, rather than deleted,
// in case a cap is wanted again later; nothing currently calls either.
//
// PatternSurfaceCard and CalibrationRevealCard each still have their own
// internal secondary gate (a fired rule, ≥3 paired outcome points) and
// silently render null if that isn't met yet — same self-gating pattern
// used throughout this codebase. With no cap, that just means fewer cards
// render for a given user, not an empty slot to backfill.

export type HeroCardId =
  | 'memory-engine'
  | 'mirror-open-loop'
  | 'pattern-surface'
  | 'calibration-reveal'
  | 'recurring-condition'

// Fixed reference order — mirrors the sequence HomeClient.tsx renders them
// in today. pickTopHeroCards rotates its *starting point* through this
// list; it does not reorder the list itself.
export const HERO_CARD_ORDER: HeroCardId[] = [
  'memory-engine',
  'mirror-open-loop',
  'pattern-surface',
  'calibration-reveal',
  'recurring-condition',
]

export interface HeroCardEligibilityInput {
  sessionCount:           number
  mirrorUnlocked:         boolean
  patternDimensionsCount: number
}

// Same conditions app/HomeClient.tsx already applies at each card's render
// site — kept here as one place so the classic page and the hero rotation
// can't drift out of sync with each other.
export function eligibleHeroCards({
  sessionCount,
  mirrorUnlocked,
  patternDimensionsCount,
}: HeroCardEligibilityInput): HeroCardId[] {
  const eligible: HeroCardId[] = []
  if (sessionCount > 0) eligible.push('memory-engine')
  if (sessionCount > 0 && !mirrorUnlocked) eligible.push('mirror-open-loop')
  if (mirrorUnlocked && sessionCount >= 5) eligible.push('pattern-surface')
  if (mirrorUnlocked) eligible.push('calibration-reveal')
  if (mirrorUnlocked && patternDimensionsCount > 0) eligible.push('recurring-condition')
  return eligible
}

// UNUSED as of Sept 2026 (see file header) — app/NaturalIntakeClient.tsx
// calls eligibleHeroCards() directly now, showing everything eligible with
// no cap. Kept for a possible future reintroduction of a cap.
//
// rotationIndex should advance once per fresh visit (see
// lib/storage.ts's getAndAdvanceHeroRotationIndex), not per render — that's
// what makes this "a different pair each time they log back in" rather
// than a random reshuffle on every re-render within the same visit.
export function pickTopHeroCards(
  eligible: HeroCardId[],
  rotationIndex: number,
  max: number = 2,
): HeroCardId[] {
  if (eligible.length <= max) return eligible
  const ordered = HERO_CARD_ORDER.filter(id => eligible.includes(id))
  const start = ((rotationIndex % ordered.length) + ordered.length) % ordered.length
  const picked: HeroCardId[] = []
  for (let i = 0; i < max; i++) {
    picked.push(ordered[(start + i) % ordered.length])
  }
  return picked
}

// ── Collapsed summary text (round 2 — components/HeroCardCollapsible.tsx) ──
// Feedback: even 2 full-detail cards read as crowded on the hero. Each
// picked card now renders collapsed by default behind one of these summary
// lines, expanding to the real component on tap. Kept deliberately terse —
// this is a teaser for tapping, not a restatement of what's inside.
//
// Per explicit request, Memory Engine's line states Mirror status as a
// plain binary ("active"/"inactive") — the full card's own header still
// shows the richer in-progress states (Recording, Preview, etc.) once
// expanded; this line is just the at-a-glance version.

export interface HeroCardSummaryInput {
  sessionCount:           number
  mirrorUnlocked:         boolean
  patternDimensionsCount: number
}

export interface HeroCardSummary {
  title:      string
  summary:    string
  statusDot:  'active' | 'inactive' | 'gold'
}

export function heroCardSummary(id: HeroCardId, input: HeroCardSummaryInput): HeroCardSummary {
  const { sessionCount, mirrorUnlocked, patternDimensionsCount } = input
  switch (id) {
    case 'memory-engine':
      return {
        title:     'Memory Engine',
        summary:   `${sessionCount} session${sessionCount === 1 ? '' : 's'} · Mirror ${mirrorUnlocked ? 'active' : 'inactive'}`,
        statusDot: mirrorUnlocked ? 'active' : 'inactive',
      }
    case 'mirror-open-loop':
      return {
        title:     'Mirror',
        summary:   mirrorUnlocked ? 'Active' : `Building — ${sessionCount} session${sessionCount === 1 ? '' : 's'} so far`,
        statusDot: mirrorUnlocked ? 'active' : 'gold',
      }
    case 'pattern-surface':
      return { title: 'Pattern', summary: 'A pattern surfaced from your record', statusDot: 'gold' }
    case 'calibration-reveal':
      return { title: 'Calibration', summary: 'Confidence vs. outcome check', statusDot: 'gold' }
    case 'recurring-condition':
      return {
        title:     'Recurring',
        summary:   `${patternDimensionsCount} recurring theme${patternDimensionsCount === 1 ? '' : 's'} in your decisions`,
        statusDot: 'gold',
      }
  }
}
