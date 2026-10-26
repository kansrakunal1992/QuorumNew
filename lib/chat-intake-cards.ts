// lib/chat-intake-cards.ts
// ── Natural Intake (v8) — dynamic answer cards inside the chat (pure) ────────
//
// The chat already knows WHAT to ask: the decision brief (lib/chat-intake-brief.ts)
// lists the slots each kind of decision needs and ends the chat when they are
// known, unknown, or not applicable. v8 changes HOW an answer is given. Instead
// of one tap-chip = one complete answer, a question can show a small group of
// selectable cards with a selection rule (choose one / at least one / up to N /
// all that apply), "Not sure", "None of these fit", "Prefer not to say",
// "Skip for now", and an always-available free-text box.
//
// Architecture (approved templates + model adaptation + validation):
//   1. Approved templates (CARD_PRESETS below) are keyed by kind of decision and
//      slot. They carry the selection rule, the sensitivity, and a default option
//      list with STABLE ids — the ids analytics uses. The model never invents a
//      rule.
//   2. The planner (lib/chat-intake-planner.ts) is shown the approved options and
//      may keep, drop or reword them and add at most two of its own. Reworded or
//      new options come back as plain strings.
//   3. This module validates them (length, duplicates, unsafe wording, "not sure"
//      lookalikes), re-attaches stable ids where a label matches an approved one,
//      gives the rest ids of the form "<slot>.a1", and falls back to the approved
//      list if too little survives. No usable options at all -> no card group, and
//      the question is asked as plain text exactly as before.
//
// Pure and dependency-light on purpose: imported by server routes, the turn logic
// AND the client component, so it must never pull in lib/ai-client.ts's
// server-only guard (same rule as lib/chat-intake-brief.ts).

import type {
  ChatCardAnswer, ChatCardGroup, ChatCardOption, ChatCardResponseMeta,
  ChatCardResponseType, ChatDecisionState, DecisionKind,
} from '@/lib/types'
import { UNKNOWN_REPLY_TEXT, isKnown, slotSpec } from '@/lib/chat-intake-brief'
import type { SlotSpec } from '@/lib/chat-intake-brief'
import { councilReadiness } from '@/lib/chat-intake-depth'
import type { CouncilReadiness } from '@/lib/chat-intake-depth'

// ── Copy that the UI and the serialiser share ────────────────────────────────

export const NONE_FIT_LABEL      = 'None of these fit'
export const PREFER_NOT_LABEL    = 'Prefer not to say'
export const SKIP_LABEL          = 'Skip for now'
export const NOT_SURE_LABEL      = 'Not sure'
export const ADD_CONTEXT_LABEL   = 'Add context'
export const NONE_FIT_TEXT_LABEL = 'Tell me in your own words'
export const PREFER_NOT_REPLY    = 'Prefer not to say'
export const SKIP_REPLY          = 'Skip for now'

export const FREE_TEXT_MAX       = 400
const MAX_OPTION_CHARS           = 60
const MAX_SINGLE_OPTIONS         = 5
const MAX_MULTI_OPTIONS          = 7
/** Slots whose answer changes the advice this much are "essential": no skip button. */
export const ESSENTIAL_WEIGHT    = 70

// ── Approved templates ───────────────────────────────────────────────────────

interface CardPreset {
  mode:        'single' | 'multi'
  min?:        number              // default 1
  max?:        number | null       // default: single -> 1, multi -> null (no maximum)
  sensitive?:  boolean             // financial / family / health-adjacent: adds "Prefer not to say"
  hint?:       string              // replaces the generated instruction
  options:     Array<[id: string, label: string, exclusive?: boolean]>
}

const WHY_NOW_UNIVERSAL: CardPreset = {
  mode: 'multi', hint: 'Choose at least one. Select as many as apply.',
  options: [
    ['specific_event', 'Something specific happened'],
    ['built_up',       'It built up over time'],
    ['pushed',         'Someone else is pushing it'],
    ['deadline',       'A deadline is getting close'],
    ['circumstances',  'My circumstances changed'],
    ['long_wanted',    'I have wanted this for a long time'],
  ],
}

const TIMELINE: CardPreset = {
  mode: 'single',
  options: [['soon', 'Within 3 months'], ['this_year', 'This year'], ['none', 'No deadline']],
}

/** Kind-specific templates. A slot with no template here falls back to UNIVERSAL_PRESETS, then to the slot's own chips. */
export const CARD_PRESETS: Partial<Record<DecisionKind, Record<string, CardPreset>>> = {
  career_exit: {
    why_now: {
      mode: 'multi', hint: 'Choose at least one. Select as many as apply.',
      options: [
        ['burnout',      'Burnout or unhappiness'],
        ['limited_growth', 'Limited growth in my current role'],
        ['idea',         'I have an idea I believe in'],
        ['work_change',  'Something important changed at work'],
        ['savings',      'I now have enough savings'],
        ['long_wanted',  'I have wanted this for a long time'],
      ],
    },
    next_step: {
      mode: 'single',
      options: [
        ['job_lined_up', 'Another job lined up'],
        ['job_search',   'Look for another job'],
        ['own_thing',    'Start something of my own'],
        ['break',        'Take a proper break'],
        ['freelance',    'Freelance or consult'],
      ],
    },
    runway: {
      mode: 'single', sensitive: true,
      options: [['u3', 'Under 3 months'], ['m3_6', '3\u20136 months'], ['m6_12', '6\u201312 months'], ['o12', 'Over a year']],
    },
    alternatives: {
      mode: 'multi', hint: 'Select every route that could realistically work.',
      options: [
        ['new_role',   'Ask for a new role or team'],
        ['terms',      'Negotiate terms or hours'],
        ['sabbatical', 'Take a sabbatical or long break'],
        ['alongside',  'Build it alongside my job'],
        ['less_demanding', 'Find a less demanding job'],
      ],
    },
    people: {
      mode: 'multi', sensitive: true,
      options: [['just_me', 'Just me', true], ['partner', 'A partner'], ['kids', 'Kids'], ['family', 'Parents or other family']],
    },
    timeline: { mode: 'single', options: [['this_month', 'This month'], ['one_three', 'In 1\u20133 months'], ['none', 'No deadline']] },
    validation: {
      mode: 'single',
      options: [['not_yet', 'Not yet'], ['few_talks', 'A few conversations'], ['early_users', 'Early users or customers']],
    },
  },
  job_offer: {
    hesitation: {
      mode: 'multi', hint: 'Choose at least one. Select as many as apply.',
      options: [
        ['pay',        'The pay or package'],
        ['role',       'The role itself'],
        ['culture',    'Unsure about the team or culture'],
        ['stability',  'Stability or risk at the new place'],
        ['location',   'Location or commute'],
        ['leaving',    'Leaving people or work I like'],
      ],
    },
    deadline: { mode: 'single', options: [['days', 'Within days'], ['week_two', 'In a week or two'], ['none', 'No deadline']] },
    alternatives: {
      mode: 'multi', hint: 'Select everything you could realistically ask for.',
      options: [['neg_pay', 'Negotiate pay'], ['neg_role', 'Negotiate the role'], ['more_time', 'Ask for more time'], ['start_date', 'Change the start date']],
    },
  },
  relocation: {
    work_plan: {
      mode: 'single',
      options: [['same_remote', 'Same job, remote'], ['new_job', 'New job lined up'], ['not_sorted', 'Not sorted yet']],
    },
    who_moves: {
      mode: 'multi', sensitive: true,
      options: [['just_me', 'Just me', true], ['partner', 'A partner'], ['kids', 'Kids'], ['family', 'Parents or other family']],
    },
    alternatives: {
      mode: 'multi', hint: 'Select every route that could realistically work.',
      options: [['trial', 'Trial it for a few months'], ['visit', 'Visit first'], ['closer', 'Move somewhere closer instead'], ['change_else', 'Change something else here']],
    },
    timeline: TIMELINE,
  },
  money: {
    downside: {
      mode: 'single', sensitive: true,
      options: [['absorb', 'Yes, easily'], ['hurt', 'It would hurt'], ['cannot', 'I couldn\u2019t']],
    },
    horizon: { mode: 'single', options: [['u1', 'Under a year'], ['y1_5', '1\u20135 years'], ['y5p', '5+ years']] },
    alternatives: {
      mode: 'multi', hint: 'Select every route that could realistically work.',
      options: [['smaller', 'Start smaller'], ['stages', 'Do it in stages'], ['wait', 'Wait and watch'], ['split', 'Split between the options']],
    },
  },
  business: {
    stage: { mode: 'single', options: [['idea', 'Just an idea'], ['early', 'Early customers'], ['running', 'Already running']] },
    capital: {
      mode: 'single', sensitive: true,
      options: [['few_months', 'A few months\u2019 runway'], ['about_year', 'About a year'], ['over_year', 'More than a year']],
    },
    alternatives: {
      mode: 'multi', hint: 'Select every route that could realistically work.',
      options: [['pilot', 'A small pilot'], ['part_time', 'Part-time first'], ['partner', 'Find a partner'], ['step_back', 'Step back or sell']],
    },
    people: { mode: 'multi', options: [['solo', 'Just me', true], ['cofounder', 'A co-founder'], ['investors', 'Investors'], ['team', 'A team that depends on it']] },
  },
  relationship: {
    who: { mode: 'single', options: [['partner', 'Partner'], ['family', 'Family'], ['friend', 'Friend'], ['colleague', 'Colleague']] },
    tried: {
      mode: 'multi', hint: 'Choose at least one. Select as many as apply.',
      options: [['talked', 'Talked it through directly'], ['boundary', 'Set a boundary'], ['space', 'Took some space'], ['third_party', 'Involved someone else'], ['nothing', 'Haven\u2019t tried anything yet', true]],
    },
    alternatives: {
      mode: 'multi', hint: 'Select every step that could realistically work.',
      options: [['conversation', 'A direct conversation'], ['boundary', 'Set a boundary'], ['space', 'Take some space'], ['mediator', 'Bring in a third person']],
    },
    others: { mode: 'multi', sensitive: true, options: [['kids', 'Kids'], ['friends', 'Shared friends'], ['work', 'Work'], ['family', 'Wider family']] },
  },
  education: {
    outcome: {
      mode: 'multi', hint: 'Choose at least one. Select as many as apply.',
      options: [['career_change', 'A change of career'], ['pay', 'A better-paid role'], ['required', 'A credential I need'], ['interest', 'Something I\u2019m curious about'], ['direction', 'Time to rethink my direction']],
    },
    cost: {
      mode: 'single', sensitive: true,
      options: [['savings', 'My savings'], ['loan', 'A loan'], ['employer', 'My employer pays'], ['scholarship', 'A scholarship'], ['not_worked_out', 'Not worked out yet']],
    },
    alternatives: {
      mode: 'multi', hint: 'Select every route that could realistically work.',
      options: [['short_course', 'A short course'], ['part_time', 'Part-time'], ['self_study', 'Self-study'], ['later', 'Do it later']],
    },
  },
  purchase: {
    budget: {
      mode: 'single', sensitive: true,
      options: [['comfortable', 'Comfortably'], ['stretch', 'A stretch'], ['cannot', 'I can\u2019t really afford it']],
    },
    alternatives: {
      mode: 'multi', hint: 'Select every route you\u2019d consider.',
      options: [['cheaper', 'A cheaper one'], ['wait', 'Wait a while'], ['borrow', 'Rent or borrow'], ['keep', 'Keep what I have']],
    },
    urgency: { mode: 'single', options: [['ends_soon', 'Sale ends soon'], ['no_rush', 'No rush']] },
  },
  other: {
    constraints: {
      mode: 'multi', hint: 'Choose at least one. Select as many as apply.',
      options: [['money', 'Money'], ['time', 'Time'], ['people', 'Other people'], ['unclear', 'Not being sure what I want'], ['nothing', 'Nothing really', true]],
    },
    alternatives: {
      mode: 'multi', hint: 'Select every route that could realistically work.',
      options: [['smaller', 'A smaller version first'], ['wait', 'Wait and learn more'], ['ask', 'Ask someone for input'], ['nothing', 'Do nothing for now']],
    },
  },
}

/** Used when a kind has no template for a slot. */
const UNIVERSAL_PRESETS: Record<string, CardPreset> = {
  why_now: WHY_NOW_UNIVERSAL,
  timeline: TIMELINE,
}

export function presetFor(kind: DecisionKind | null | undefined, slotKey: string): CardPreset | null {
  const k: DecisionKind = kind ?? 'other'
  return CARD_PRESETS[k]?.[slotKey] ?? UNIVERSAL_PRESETS[slotKey] ?? null
}

const presetOptions = (slotKey: string, p: CardPreset): ChatCardOption[] =>
  p.options.map(([id, label, exclusive]) => ({ id: `${slotKey}.${id}`, label, ...(exclusive ? { exclusive: true } : {}) }))

/** For the planner prompt: "approved options: A | B | C (choose several)" — or null if this slot has no cards. */
export function approvedOptionsForPrompt(kind: DecisionKind | null | undefined, slotKey: string): string | null {
  const p = presetFor(kind, slotKey)
  if (!p) return null
  return `${p.options.map(o => o[1]).join(' | ')} (${p.mode === 'multi' ? 'several can apply at once' : 'pick one'})`
}

// ── Model-option hygiene ─────────────────────────────────────────────────────

const LOOKALIKE_SYSTEM = /^(not sure|don'?t know|i don'?t know|unsure|idk|none of (these|the above)|something else|other\b|prefer not|skip)/i
// A card is a suggestion shown to someone mid-decision; never let the model put harm on one.
const UNSAFE_OPTION = /\b(suicid\w*|kill (myself|him|her|them)|self[- ]?harm|hurt (myself|him|her|them)|overdose|murder\w*|weapon\w*|bomb\w*|launder\w*|fraud\w*|steal\w*|illegal\w*)\b/i

const norm = (s: string): string => s.toLowerCase().replace(/[\u2019']/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

export function sanitizeCardOptions(raw: unknown, slotKey: string, approved: ChatCardOption[] = [], max = MAX_MULTI_OPTIONS): ChatCardOption[] {
  if (!Array.isArray(raw)) return []
  const byLabel = new Map(approved.map(o => [norm(o.label), o]))
  const out: ChatCardOption[] = []
  let adaptive = 0
  for (const c of raw) {
    if (typeof c !== 'string') continue
    const t = c.replace(/\s+/g, ' ').trim().replace(/[.;,]+$/, '')
    if (t.length < 2 || t.length > MAX_OPTION_CHARS) continue
    if (LOOKALIKE_SYSTEM.test(t) || UNSAFE_OPTION.test(t)) continue
    if (out.some(o => norm(o.label) === norm(t))) continue
    const hit = byLabel.get(norm(t))
    if (hit) out.push({ ...hit })
    else { adaptive += 1; out.push({ id: `${slotKey}.a${adaptive}`, label: t }) }
    if (out.length >= max) break
  }
  return out
}

/** Analytics must never carry model-written wording: anything adapted collapses to "<slot>.adaptive". */
export function analyticsOptionId(id: string): string {
  return /\.a\d+$/.test(id) ? id.replace(/\.a\d+$/, '.adaptive') : id
}

// ── Selection rules ──────────────────────────────────────────────────────────

const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven']
const numWord = (n: number): string => NUM_WORDS[n] ?? String(n)

export function describeRule(mode: 'single' | 'multi', min: number, max: number | null): string {
  if (mode === 'single' || max === 1) return 'Choose one.'
  if (max !== null && min <= 1) return `Choose up to ${numWord(max)}.`
  if (max !== null) return `Choose ${numWord(min)} to ${numWord(max)}.`
  if (min >= 2) return `Choose at least ${numWord(min)}. Select every one that could apply.`
  if (min === 1) return 'Choose at least one. Select as many as apply.'
  return 'Select any that apply.'
}

export interface BuildCardArgs {
  kind:        DecisionKind | null | undefined
  slot:        SlotSpec
  /** The question text that was asked (becomes the group's accessible name). */
  question:    string
  /** Options the planner proposed for this question (adapted from the approved list), if any. */
  modelChips?: unknown
}

/**
 * Builds the card group for one asked slot, or null when the question is better
 * answered in plain words (no usable options). Never throws.
 */
export function buildCardGroup(a: BuildCardArgs): ChatCardGroup | null {
  try {
    const { slot } = a
    const kind: DecisionKind = a.kind ?? 'other'
    const preset  = presetFor(kind, slot.key)
    const approved = preset ? presetOptions(slot.key, preset) : []
    const mode: 'single' | 'multi' = preset?.mode ?? 'single'
    const cap  = mode === 'multi' ? MAX_MULTI_OPTIONS : MAX_SINGLE_OPTIONS

    const proposed = sanitizeCardOptions(a.modelChips, slot.key, approved, cap)
    const enough   = proposed.length >= (mode === 'multi' ? 3 : 2)

    let options: ChatCardOption[] = enough ? proposed : approved.slice(0, cap)
    // The slot's own chips (approved copy) are the last resort — they get stable, label-derived ids.
    if (options.length < 2 && slot.chips?.length) {
      options = slot.chips.slice(0, cap).map(label => ({ id: `${slot.key}.${norm(label).replace(/ /g, '_').slice(0, 24)}`, label }))
    }
    if (options.length < 2) return null

    const min = Math.max(0, Math.min(preset?.min ?? 1, options.length))
    const max = mode === 'single' ? 1 : (preset?.max === undefined ? null : preset.max)
    const essential = slot.weight >= ESSENTIAL_WEIGHT
    const sensitive = !!preset?.sensitive

    return {
      questionId:        `${kind}.${slot.key}`,
      slotKey:           slot.key,
      decisionCategory:  kind,
      title:             a.question,
      instruction:       preset?.hint ?? describeRule(mode, min, max),
      options,
      minSelections:     min,
      maxSelections:     max,
      allowSelectAll:    mode === 'multi',
      essential,
      allowSkip:         !essential,
      allowNotSure:      true,
      allowNoneOfThese:  options.length >= 3,
      allowPreferNotToSay: sensitive,
      freeTextCanSatisfyMinimum: true,
      freeTextLabel:     ADD_CONTEXT_LABEL,
      freeTextPlaceholder: 'In your own words\u2026',
      freeTextMaxLength: FREE_TEXT_MAX,
      sensitivity:       sensitive ? 'sensitive' : 'normal',
      adaptive:          options.some(o => /\.a\d+$/.test(o.id)),
    }
  } catch {
    return null   // a card problem must never block the question — it is asked as plain text
  }
}

// ── What the person did with a card group ────────────────────────────────────

export type CardSpecial = 'not_sure' | 'none_fit' | 'prefer_not' | 'skip' | null

export interface CardSelection {
  selectedIds: string[]
  freeText:    string
  special:     CardSpecial
}

export interface SelectionCheck { ok: boolean; error?: string }

export function validateSelection(group: ChatCardGroup, sel: CardSelection): SelectionCheck {
  const text = sel.freeText.trim()
  if (text.length > group.freeTextMaxLength) return { ok: false, error: `Keep it under ${group.freeTextMaxLength} characters.` }
  if (sel.special === 'not_sure')   return group.allowNotSure        ? { ok: true } : { ok: false, error: 'Pick an answer or type your own.' }
  if (sel.special === 'prefer_not') return group.allowPreferNotToSay ? { ok: true } : { ok: false, error: 'Pick an answer or type your own.' }
  if (sel.special === 'skip')       return group.allowSkip           ? { ok: true } : { ok: false, error: 'This one helps the most \u2014 pick an answer or type your own.' }
  if (sel.special === 'none_fit') {
    return text.length >= 2 ? { ok: true } : { ok: false, error: 'Tell me in a few words what fits instead.' }
  }
  const ids = new Set(group.options.map(o => o.id))
  const picked = sel.selectedIds.filter(id => ids.has(id))
  if (group.maxSelections !== null && picked.length > group.maxSelections) {
    return { ok: false, error: `You can choose up to ${numWord(group.maxSelections)}.` }
  }
  if (picked.length < group.minSelections && !(group.freeTextCanSatisfyMinimum && text.length >= 2)) {
    return { ok: false, error: group.minSelections > 1
      ? `Choose at least ${numWord(group.minSelections)}, or add a few words of your own.`
      : 'Pick at least one, or add a few words of your own.' }
  }
  if (picked.length === 0 && text.length < 2) return { ok: false, error: 'Pick one, or add a few words of your own.' }
  return { ok: true }
}

export function responseTypeOf(sel: CardSelection): ChatCardResponseType {
  if (sel.special) return sel.special
  return sel.selectedIds.length > 0 ? 'cards' : 'free_text_only'
}

/** The chat message the person "says" — labels plus their own words. This is what the planner and the transcript see. */
export function serializeSelection(group: ChatCardGroup, sel: CardSelection): string {
  const text = sel.freeText.trim()
  if (sel.special === 'not_sure')   return UNKNOWN_REPLY_TEXT
  if (sel.special === 'prefer_not') return PREFER_NOT_REPLY
  if (sel.special === 'skip')       return SKIP_REPLY
  if (sel.special === 'none_fit')   return text || NONE_FIT_LABEL
  const labels = group.options.filter(o => sel.selectedIds.includes(o.id)).map(o => o.label)
  if (!labels.length) return text
  return text ? `${labels.join('; ')}. ${text}` : labels.join('; ')
}

export function metaFor(group: ChatCardGroup, sel: CardSelection): ChatCardResponseMeta {
  const ids = new Set(group.options.map(o => o.id))
  return {
    questionId:   group.questionId,
    responseType: responseTypeOf(sel),
    selectedIds:  sel.special ? [] : sel.selectedIds.filter(id => ids.has(id)),
    usedFreeText: sel.freeText.trim().length >= 2,
  }
}

/** Client-reported meta is untrusted: keep only known shapes, and only ids that were actually on the card. */
export function sanitizeCardMeta(raw: unknown, pending: ChatCardGroup | null | undefined): ChatCardResponseMeta | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const TYPES: ChatCardResponseType[] = ['cards', 'free_text_only', 'none_fit', 'not_sure', 'prefer_not', 'skip']
  if (!TYPES.includes(r.responseType as ChatCardResponseType)) return null
  const valid = new Set((pending?.options ?? []).map(o => o.id))
  const selectedIds = (Array.isArray(r.selectedIds) ? r.selectedIds : [])
    .filter((x): x is string => typeof x === 'string' && x.length <= 60 && valid.has(x)).slice(0, 12)
  return {
    questionId:   typeof r.questionId === 'string' ? r.questionId.slice(0, 60) : (pending?.questionId ?? ''),
    responseType: r.responseType as ChatCardResponseType,
    selectedIds,
    usedFreeText: r.usedFreeText === true,
  }
}

// ── State edits (pure) ───────────────────────────────────────────────────────

/** Skipped / "prefer not to say": resolved so it is never re-asked, but no "find out" to-do is made — the person chose not to share. */
export function declineSlot(state: ChatDecisionState, key: string): ChatDecisionState {
  if (isKnown(state, key)) return state
  return {
    ...state,
    unknownFacts: (state.unknownFacts ?? []).includes(key) ? state.unknownFacts : [...(state.unknownFacts ?? []), key],
    skippedSlots: (state.skippedSlots ?? []).includes(key) ? state.skippedSlots : [...(state.skippedSlots ?? []), key],
  }
}

export function recordCardAnswer(
  state: ChatDecisionState, group: ChatCardGroup, meta: ChatCardResponseMeta, exchange: number,
): ChatDecisionState {
  const labels = group.options.filter(o => meta.selectedIds.includes(o.id)).map(o => o.label)
  // "cards" with no valid card behind it (stale ids, tampered input) is really a typed answer.
  const responseType: ChatCardResponseType = meta.responseType === 'cards' && labels.length === 0 ? 'free_text_only' : meta.responseType
  const answer: ChatCardAnswer = {
    questionId:     group.questionId,
    slotKey:        group.slotKey,
    responseType,
    selectedIds:    meta.selectedIds,
    selectedLabels: labels,
    usedFreeText:   meta.usedFreeText,
    selectedAll:    group.options.length >= 3 && meta.selectedIds.length === group.options.length,
    exchange,
  }
  let next: ChatDecisionState = { ...state, cardAnswers: { ...(state.cardAnswers ?? {}), [group.slotKey]: answer } }
  if (responseType === 'prefer_not' || responseType === 'skip') next = declineSlot(next, group.slotKey)
  return next
}

/** One line for the planner when the person ticked every option: it decides whether that means "all true", "too broad" or "unsure". */
export function allSelectedNote(group: ChatCardGroup, meta: ChatCardResponseMeta): string | null {
  if (meta.responseType !== 'cards' || group.options.length < 3 || meta.selectedIds.length !== group.options.length) return null
  return `The person ticked EVERY option offered for "${group.slotKey}". Decide whether all of them really apply, the question was too broad, or they are unsure; ask at most ONE focused follow-up, and only if the answer would change your advice. Do not treat this as an error.`
}

// ── Readiness (the "is this enough for the Council?" function) ───────────────

export type IntakeReadiness = CouncilReadiness

export interface ReadinessResult {
  state:           IntakeReadiness
  openRequired:    string[]     // ESSENTIAL slot keys still unresolved
  unknownCount:    number       // essential details unknown / skipped / left open when the chat stopped
  deferredCount:   number       // slots not asked because they were not material
  total:           number
}

/**
 * Thin, analytics-friendly view of lib/chat-intake-depth.ts#councilReadiness (the single definition of "enough
 * for the Council"). Only an unresolved ESSENTIAL slot blocks; unknown, skipped and not-material slots are states
 * the Council works with and are handed to it as such.
 */
export function intakeReadiness(state: ChatDecisionState): ReadinessResult {
  const r = councilReadiness(state)
  return {
    state: r.state,
    openRequired: r.criticalOpen,
    unknownCount: r.unknown.length + r.gaps.length,
    deferredCount: r.deferred.length,
    total: r.criticalOpen.length + r.unknown.length + r.gaps.length,
  }
}

// ── Council handoff: how each detail was captured ────────────────────────────

const labelOf = (state: ChatDecisionState, key: string): string => slotSpec(state.decisionKind, key)?.label ?? key

/**
 * Extra lines for the session's context_text (lib/chat-intake-state.ts). Adds
 * PROVENANCE only; it never restates a model inference as a fact. The verbatim
 * transcript (including every free-text answer) is still appended after these.
 */
export function cardContextLines(state: ChatDecisionState): string[] {
  const out: string[] = []
  const r = councilReadiness(state)
  out.push(`Intake readiness: ${
    r.state === 'ready' ? 'every essential question answered'
    : r.state === 'ready_with_unknowns' ? 'enough to start; some details unknown or not asked (listed below)'
    : r.state === 'closed_with_gaps' ? 'stopped with essential details still open (listed below) \u2014 do not assume them'
    : 'incomplete'}`)
  if (r.gaps.length) out.push(`Essential details still open when the intake stopped: ${r.gaps.map(k => labelOf(state, k)).join('; ')}`)
  if (r.deferred.length) out.push(`Not asked in intake (judged not material to this decision \u2014 explore only if it changes the answer): ${r.deferred.map(k => labelOf(state, k)).join('; ')}`)

  const chosen = Object.values(state.cardAnswers ?? {}).filter(a => a.responseType === 'cards' && a.selectedLabels.length && !a.superseded)
  if (chosen.length) {
    out.push(`Chosen from options (tapped by the person):\n${chosen.map(a => `- ${labelOf(state, a.slotKey)}: ${a.selectedLabels.join('; ')}${a.usedFreeText ? ' (and added their own words \u2014 see transcript)' : ''}`).join('\n')}`)
  }
  const changed = Object.values(state.cardAnswers ?? {}).filter(a => a.superseded && a.selectedLabels.length)
  if (changed.length) {
    out.push(`Earlier taps the person later changed in their own words (the newer words in Key facts outrank these):\n${changed.map(a => `- ${labelOf(state, a.slotKey)}: earlier chose ${a.selectedLabels.join('; ')}`).join('\n')}`)
  }
  const all = Object.values(state.cardAnswers ?? {}).filter(a => a.selectedAll && !a.superseded)
  if (all.length) out.push(`Selected every option offered on: ${all.map(a => labelOf(state, a.slotKey)).join('; ')}`)
  const skipped = (state.skippedSlots ?? [])
  if (skipped.length) out.push(`Skipped or preferred not to say: ${skipped.map(k => labelOf(state, k)).join('; ')}`)
  if (state.contradictions?.length) {
    out.push(`Possible tension Quorum noticed (Quorum\u2019s reading, not confirmed by the person): ${state.contradictions.join('; ')}`)
  }
  if (state.userCorrections?.length) {
    out.push(`The person corrected or clarified (their words outrank anything inferred): ${state.userCorrections.join('; ')}`)
  }
  out.push('Source key: "Chosen from options" = tapped by the person; "Key facts" = the person\u2019s own words or taps; "Kind of decision" and "Possible tension" = Quorum\u2019s inference; the transcript below is verbatim.')
  return out
}

// ── Analytics (stable ids only — never labels, never free text) ──────────────

type Props = Record<string, string | number | boolean | null>

export function cardShownProps(group: ChatCardGroup, step: number): Props {
  return {
    question_id:      group.questionId,
    slot_key:         group.slotKey,
    decision_category: group.decisionCategory,
    intake_step:      step,
    select_mode:      group.maxSelections === 1 ? 'single' : 'multi',
    min_selections:   group.minSelections,
    max_selections:   group.maxSelections ?? -1,
    option_count:     group.options.length,
    adaptive:         group.adaptive,
    essential:        group.essential,
    sensitive:        group.sensitivity === 'sensitive',
  }
}

export function cardAnsweredProps(group: ChatCardGroup, meta: ChatCardResponseMeta, step: number, msToAnswer: number): Props {
  const all = group.options.length >= 3 && meta.selectedIds.length === group.options.length
  return {
    question_id:       group.questionId,
    slot_key:          group.slotKey,
    decision_category: group.decisionCategory,
    intake_step:       step,
    response_type:     meta.responseType,
    selected_count:    meta.selectedIds.length,
    option_ids:        meta.selectedIds.map(analyticsOptionId).join(',').slice(0, 190),
    used_free_text:    meta.usedFreeText,
    all_selected:      all,
    met_minimum:       meta.selectedIds.length >= group.minSelections || meta.usedFreeText,
    ms_to_answer:      Math.max(0, Math.min(3_600_000, Math.round(msToAnswer))),
  }
}

/** "mobile" / "desktop" for the completion split in analytics. A coarse bucket on purpose — not a device fingerprint. */
export function viewportBucket(): 'mobile' | 'desktop' | 'unknown' {
  if (typeof window === 'undefined' || !Number.isFinite(window.innerWidth)) return 'unknown'
  return window.innerWidth < 640 ? 'mobile' : 'desktop'
}
