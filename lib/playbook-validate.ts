// lib/playbook-validate.ts
// ── The quality bar for a decision situation (a PlaybookDef), as code ────────────────────────────────────────────────
// One definition shared by the tests (which run it over every entry in lib/playbook-data/) and by
// scripts/draft-playbooks.ts (which runs it over model-drafted entries before a human ever sees them). Returns a list of
// plain-English problems; an empty list means the entry is acceptable.

import { DECISION_KINDS } from '@/lib/chat-intake-brief'
import { PLAYBOOKS, tokens } from '@/lib/decision-playbooks'
import type { PlaybookDef } from '@/lib/decision-playbooks'

const FEELINGS = /\b(feel|feeling|success)\b/i
const LOOKALIKE_CHIP = /not sure|don'?t know|do not know|prefer not|unknown|i guess|none of the above/i

/** The normalised form used to decide whether two aliases are "the same phrase". */
export const aliasKey = (alias: string): string => tokens(alias.replace(/^=/, '')).join(' ')

export function validatePlaybookDef(def: PlaybookDef, opts: { against?: ReadonlyArray<{ id: string; aliases: string[] }> } = {}): string[] {
  const out: string[] = []
  const bad = (m: string) => out.push(m)
  const against = opts.against ?? PLAYBOOKS

  if (!/^[a-z_]+\.[a-z_]+$/.test(def.id ?? '')) bad(`id "${def.id}" must look like type.situation (snake_case)`)
  const base = String(def.id ?? '').split('.')[0]
  if (!(DECISION_KINDS as readonly string[]).includes(base) || base === 'other') bad(`"${base}" is not a real decision type`)
  if (against.some(p => p.id === def.id)) bad(`id "${def.id}" already exists`)
  if (!def.label || def.label.length > 48) bad('label is missing or longer than 48 characters')
  if (!!def.light !== (base === 'lifestyle')) bad('only everyday (lifestyle) situations are light, and all of them must be')

  const slots = def.slots ?? []
  if (slots.length < 2 || slots.length > 6) bad(`needs 2-6 questions, has ${slots.length}`)
  const required = slots.filter(s => (s[4] ?? '').includes('r')).length
  if (required < 2 || required > 5) bad(`needs 2-5 required questions, has ${required}`)
  const keys = new Set<string>()
  for (const [key, label, ask, chips, flags = ''] of slots) {
    const at = `question "${key}"`
    if (!/^[a-z_]+$/.test(key)) bad(`${at}: key must be snake_case letters`)
    if (keys.has(key)) bad(`${at}: duplicate key`)
    keys.add(key)
    if (key === 'change_mind') bad(`${at}: reserved key`)
    if (!label || label.length > 36) bad(`${at}: label missing or longer than 36 characters`)
    if (!ask || !ask.endsWith('?')) bad(`${at}: must be a question ending in "?"`)
    if (ask && FEELINGS.test(ask)) bad(`${at}: do not ask about feelings or "what success looks like"`)
    if (ask && ask.length > 170) bad(`${at}: longer than 170 characters`)
    if (!/^[rms]*$/.test(flags)) bad(`${at}: flags may only contain r, m, s`)
    if (chips) {
      if (chips.length < 2 || chips.length > 5) bad(`${at}: needs 2-5 tap-answers, has ${chips.length}`)
      if (new Set(chips.map(c => c.toLowerCase())).size !== chips.length) bad(`${at}: duplicate tap-answer`)
      for (const c of chips) {
        if (c.length > 36) bad(`${at}: tap-answer "${c}" is longer than 36 characters`)
        if (LOOKALIKE_CHIP.test(c)) bad(`${at}: tap-answer "${c}" imitates a button the app already adds ("Not sure", "Prefer not to say")`)
      }
    } else if (flags.includes('m')) bad(`${at}: a multi-select question needs tap-answers`)
  }

  const aliases = def.aliases ?? []
  if (aliases.length < 6) bad(`needs at least 6 everyday phrasings, has ${aliases.length}`)
  const owner = new Map<string, string>()
  for (const p of against) for (const a of p.aliases) owner.set(aliasKey(a), p.id)
  const mine = new Set<string>()
  for (const a of aliases) {
    const key = aliasKey(a)
    if (a.includes('=') && !a.startsWith('=')) bad(`phrase "${a}": "=" is only allowed as the first character`)
    if (key.split(' ').filter(Boolean).length < 2 && !a.startsWith('=')) bad(`phrase "${a}" reduces to one word; mark a distinctive single word as "=${a}" or make it longer`)
    if (!key) bad(`phrase "${a}" has no content words`)
    const other = owner.get(key)
    if (other && other !== def.id) bad(`phrase "${a}" is already claimed by ${other}`)
    if (mine.has(key)) bad(`phrase "${a}" is listed twice`)
    mine.add(key)
  }
  return out
}
