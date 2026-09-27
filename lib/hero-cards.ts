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
// (same gating conditions HomeClient already uses), then show only the top
// two, rotating which two on each fresh visit so nothing is permanently
// buried and the choice doesn't need per-card weighting logic to feel fair.
//
// Known tradeoff: PatternSurfaceCard and CalibrationRevealCard each also
// have their own internal secondary gate (a fired rule, ≥3 paired outcome
// points) and silently render null if that isn't met yet — same
// self-gating pattern used throughout this codebase. If one of those two
// is rotated into a slot but has nothing to show, that slot is empty for
// this visit rather than backfilled with a third card. Acceptable for v1;
// a fast-follow would have each card report back via an onEmpty callback
// so the picker can promote the next-eligible card into that slot instead.

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
