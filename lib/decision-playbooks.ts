// lib/decision-playbooks.ts
// ── A library of ready-made decision situations (the engine; the content is lib/playbook-data.ts) ─────────────────
//
// WHAT A PLAYBOOK IS
// A specific situation inside a broad decision TYPE: `housing.buy`, `relationship.breakup`, `lifestyle.pet`,
// `career_move.ask_raise`. It carries
//   - its own sharper questions (slots) with tap-answers, which become the cards,
//   - a list of everyday phrasings ("aliases") that identify it,
// and INHERITS everything generic ("other routes", "what set this off", the parent's card templates) from its parent
// type, so a new situation is ~8 lines of data, not a new template.
//
// WHY IT SCALES
// It is data, not code. Adding a situation = one entry in playbook-data.ts. The tests then check it (question wording,
// card options, no phrase claimed by two situations, every phrase resolves to its own situation) so a bad entry fails
// loudly instead of quietly asking the wrong questions.
//
// HOW A SITUATION IS RECOGNISED, in order (lib/chat-intake-turn.ts mergeNotes):
//   1. the planner (LLM) names a playbook id or a base type;
//   2. otherwise this module's phrase matcher reads the person's own words — instant, free, deterministic;
//   3. otherwise the base type's generic questions; otherwise the generic `other` ones. Nothing is ever a dead end.
//
// MATCHING: normalise (lower-case, drop filler words, light stemming) so "buying a house", "bought... house" (add the
// irregular form as its own alias) and "should I buy the house now" all hit the alias "buy house". An alias matches
// when its words appear in order within a short window. Longer aliases are more specific and win.

import type { BaseDecisionKind, PlaybookId } from '@/lib/types'
import { PLAYBOOK_DEFS } from '@/lib/playbook-data'

// ── Authoring format ─────────────────────────────────────────────────────────────────────────────────────────────

/** [key, label, question, tap-answers | null, flags]   flags: r = required · m = pick several · s = sensitive ("Prefer not to say"). */
export type SlotTuple = [key: string, label: string, ask: string, chips: string[] | null, flags?: string]

export interface PlaybookDef {
  id:      PlaybookId
  label:   string
  /** Everyday phrasings. A leading "=" marks a single distinctive word that is safe on its own ("=mba"). */
  aliases: string[]
  slots:   SlotTuple[]
  /** Small / everyday decision: do not make "other routes" a required question. */
  light?:  boolean
}

export interface PlaybookSlot {
  key:       string
  label:     string
  ask:       string
  chips:     string[] | null
  required:  boolean
  multi:     boolean
  sensitive: boolean
  /** Question order: earlier slots matter more. */
  weight:    number
}

export interface Playbook {
  id:      PlaybookId
  base:    Exclude<BaseDecisionKind, 'other'>
  label:   string
  light:   boolean
  aliases: string[]
  slots:   PlaybookSlot[]
}

// ── Registry ─────────────────────────────────────────────────────────────────────────────────────────────────────

function build(def: PlaybookDef): Playbook {
  const base = def.id.split('.')[0] as Playbook['base']
  return {
    id: def.id, base, label: def.label, light: !!def.light, aliases: def.aliases,
    slots: def.slots.map(([key, label, ask, chips, flags = ''], i) => ({
      key, label, ask, chips: chips && chips.length ? chips : null,
      required:  flags.includes('r'),
      multi:     flags.includes('m'),
      sensitive: flags.includes('s'),
      weight:    Math.max(35, 90 - 5 * i),
    })),
  }
}

export const PLAYBOOKS: readonly Playbook[] = PLAYBOOK_DEFS.map(build)
const BY_ID = new Map<string, Playbook>(PLAYBOOKS.map(p => [p.id, p]))

export function isPlaybookId(v: unknown): v is PlaybookId {
  return typeof v === 'string' && BY_ID.has(v)
}
export function getPlaybook(v: unknown): Playbook | null {
  return typeof v === 'string' ? BY_ID.get(v) ?? null : null
}
/** 'housing.buy' -> 'housing'; 'housing' -> 'housing'; anything else -> null. */
export function baseKindOf(kind: string | null | undefined): Exclude<BaseDecisionKind, 'other'> | 'other' | null {
  if (!kind) return null
  const pb = BY_ID.get(kind)
  if (pb) return pb.base
  return kind.includes('.') ? null : (kind as BaseDecisionKind)
}
export const totalAliasCount = (): number => PLAYBOOKS.reduce((n, p) => n + p.aliases.length, 0)

// ── Normalisation + matching ─────────────────────────────────────────────────────────────────────────────────────

const FILLER = new Set([
  'a', 'an', 'the', 'my', 'our', 'your', 'his', 'her', 'their', 'its', 'to', 'of', 'on', 'at', 'with',
  'and', 'or', 'i', 'we', 'me', 'us', 'should', 'can', 'could', 'would', 'do', 'does', 'did', 'is', 'are', 'am', 'be',
  'it', 'this', 'that', 'these', 'those', 'now', 'than', 'if', 'so', 'as', 'by', 'will', 'shall', 'just', 'really',
  'thinking', 'think', 'about', 'whether', 'want', 'wanna', 'need', 'trying',
])

const DOUBLED = /([bdgmnprt])\1$/   // quitting -> quit, planning -> plan; but selling stays sell

/** Deliberately simple: enough to make buy/buying/buys and house/houses meet, with no dictionary. */
export function stem(word: string): string {
  let s = word
  if (s.length <= 3) return s
  if (s.endsWith('ies') && s.length > 4) s = `${s.slice(0, -3)}y`
  else if (/(ches|shes|sses|xes|zes)$/.test(s)) s = s.slice(0, -2)
  else if (s.endsWith('ing') && s.length > 5) { s = s.slice(0, -3); if (DOUBLED.test(s)) s = s.slice(0, -1) }
  else if (s.endsWith('ed') && s.length > 4) { s = s.slice(0, -2); if (DOUBLED.test(s)) s = s.slice(0, -1) }
  else if (s.endsWith('s') && !s.endsWith('ss') && s.length > 3) s = s.slice(0, -1)
  if (s.length > 3 && s.endsWith('e')) s = s.slice(0, -1)
  return s
}

export function tokens(text: string): string[] {
  return text.toLowerCase().replace(/[\u2018\u2019']/g, '').replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter(w => w && !FILLER.has(w)).map(stem)
}

interface CompiledAlias { playbook: Playbook; toks: string[]; single: boolean }

const ALIASES: CompiledAlias[] = []
for (const playbook of PLAYBOOKS) {
  for (const raw of playbook.aliases) {
    const single = raw.startsWith('=')
    const toks = tokens(single ? raw.slice(1) : raw)
    if (toks.length) ALIASES.push({ playbook, toks, single })
  }
}

/** Words of the alias appear in order in the text, spanning at most (alias length + 3) of the text's words. */
function aliasMatches(a: string[], t: string[]): boolean {
  const slack = 3
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== a[0]) continue
    let j = i, ok = true
    for (let k = 1; k < a.length; k++) {
      let found = -1
      for (let m = j + 1; m < t.length && m - i <= a.length - 1 + slack; m++) if (t[m] === a[k]) { found = m; break }
      if (found < 0) { ok = false; break }
      j = found
    }
    if (ok) return true
  }
  return false
}

export interface PlaybookMatch {
  playbook: Playbook
  /** Words in the longest alias that matched: the more specific, the higher. */
  score:    number
  /** How many of the playbook's aliases matched. */
  hits:     number
}

export interface MatchOptions {
  /** Only consider playbooks under this base type (used when the planner already chose one). */
  within?: string | null
  /** Single-word aliases count as 1 and multi-word as their length; default requires 2 unless the alias is marked "=". */
  minScore?: number
}

/**
 * Best-matching playbook for the person's own words, or null. Conservative: the best match must beat every other
 * playbook's, otherwise this stays silent and the planner / generic questions apply.
 */
export function classifyPlaybook(raw: string | null | undefined, opts: MatchOptions = {}): PlaybookMatch | null {
  const text = (raw ?? '').trim()
  if (text.length < 3) return null
  const t = tokens(text)
  if (!t.length) return null
  const have = new Set(t)
  const within = opts.within ? baseKindOf(opts.within) : null
  const minScore = opts.minScore ?? 2

  const byPb = new Map<string, PlaybookMatch>()
  for (const al of ALIASES) {
    if (within && al.playbook.base !== within) continue
    if (!al.toks.every(w => have.has(w))) continue          // cheap reject before the ordered check
    if (!aliasMatches(al.toks, t)) continue
    const score = al.toks.length
    if (score < minScore && !al.single) continue
    const cur = byPb.get(al.playbook.id)
    if (cur) { cur.hits++; cur.score = Math.max(cur.score, score) }
    else byPb.set(al.playbook.id, { playbook: al.playbook, score, hits: 1 })
  }
  if (!byPb.size) return null

  const ranked = Array.from(byPb.values()).sort((a, b) => b.score - a.score || b.hits - a.hits)
  const [best, runner] = ranked
  if (runner && runner.score === best.score && runner.hits === best.hits) return null   // genuinely ambiguous: stay silent
  return best
}
