// scripts/draft-playbooks.ts
// ── Grow the decision-situation library from a list of decisions ─────────────────────────────────────────────────────
//
//   ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/draft-playbooks.ts decisions.txt
//   npx tsx scripts/draft-playbooks.ts --from-json drafts.json        (validate drafts made elsewhere; no API call)
//
// decisions.txt: one decision per line, in the words people use ("should I switch from Android to iPhone",
// "should I let my teenager get a part time job"). Blank lines and lines starting with # are ignored.
//
// WHAT IT DOES
//   1. Skips lines the library already recognises (reports how many, so you can see real coverage).
//   2. Asks Claude to GROUP the rest into situations and draft each one in the library's format
//      (lib/decision-playbooks.ts PlaybookDef): specific questions, tap-answers, everyday phrasings.
//   3. Runs every draft through the SAME validator the tests use (lib/playbook-validate.ts): bad wording, feelings
//      questions, tap-answers that imitate app buttons, duplicate phrases and phrases another situation already owns
//      are rejected with a reason. Nothing unchecked reaches you.
//   4. Writes playbook-drafts/<timestamp>.ts (accepted) and <timestamp>.rejected.json (with reasons).
//
// WHAT IT NEVER DOES: edit lib/playbook-data/. A person reads the accepted drafts, fixes the wording, pastes them into
// the matching data file, and `npm test` then checks each phrase resolves to its own situation. Drafts are model-written
// content that people will read and tap, so a human review is a requirement, not a nicety.

import Anthropic from '@anthropic-ai/sdk'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { PLAYBOOKS, classifyPlaybook } from '../lib/decision-playbooks'
import type { PlaybookDef } from '../lib/decision-playbooks'
import { DECISION_KINDS } from '../lib/chat-intake-brief'
import { validatePlaybookDef } from '../lib/playbook-validate'

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514'
const BATCH = 12

const SYSTEM = `You write decision-intake "situations" for Quorum, an app that helps a person think through a decision before an AI council debates it.
A situation is ONE specific kind of decision (e.g. housing.buy, relationship.breakup, lifestyle.pet) with a few quick questions a thoughtful friend would ask FIRST.

Return ONLY a JSON array. Each item:
{
  "id": "<type>.<snake_case_name>",        // <type> is one of: ${DECISION_KINDS.filter(k => k !== 'other').join(', ')}
  "label": "short noun phrase, max 48 chars",
  "light": true | false,                    // true ONLY for type "lifestyle" (small everyday decisions), false for every other type
  "slots": [ ["key", "Short label", "Plain question?", ["tap answer", ...] | null, "flags"] ],
  "aliases": ["everyday phrase", ...]       // 8-14 phrasings a person would actually type
}

RULES (a validator rejects violations):
- 2-6 questions; 2-5 of them required (flag letter r). Other flags: m = pick several, s = sensitive (money, health, family, relationships).
- Ask for CONCRETE facts that change the advice (amounts, timing, who is affected, what has been tried). Never ask how the person feels or what success looks like.
- Each question is plain language and ends with "?". Max 170 characters. Label max 36 characters.
- Tap answers: 2-5 short options (max 36 chars), mutually exclusive unless the flag m is set. Use null for open-ended questions.
  NEVER include "Not sure", "Don't know", "Prefer not to say", "Unknown" or "None of the above": the app adds those buttons itself.
- Keys are snake_case letters. Do not use the key "alternatives", "why_now" or "change_mind": the type supplies those.
- Aliases are short verb phrases ("sell my flat", "ask for a raise"), 2+ words. A single distinctive word needs a leading "=" ("=mba").
  Avoid generic phrases several situations could share. Do not repeat an alias across items.
- Do not give medical, legal or financial advice in questions. Gather context only.
- Prefer ONE situation per distinct kind of decision. Group phrasings that need the same questions into one item.`

function readLines(path: string): string[] {
  return readFileSync(path, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
}

function extractJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  const start = cleaned.indexOf('['), end = cleaned.lastIndexOf(']')
  if (start < 0 || end < start) throw new Error('no JSON array in the reply')
  return JSON.parse(cleaned.slice(start, end + 1))
}

const q = (s: string) => JSON.stringify(s)
function toSource(d: PlaybookDef): string {
  const slots = d.slots.map(([k, l, a, c, f]) => `      [${q(k)}, ${q(l)}, ${q(a)}, ${c ? `[${c.map(q).join(', ')}]` : 'null'}${f ? `, ${q(f)}` : ''}],`).join('\n')
  return `  { id: ${q(d.id)}, label: ${q(d.label)},${d.light ? ' light: true,' : ''}\n    slots: [\n${slots}\n    ],\n    aliases: [${d.aliases.map(q).join(', ')}] },`
}

async function draftBatch(client: Anthropic, lines: string[], existingIds: string[]): Promise<unknown[]> {
  const res = await client.messages.create({
    model: MODEL, max_tokens: 6000, system: SYSTEM,
    messages: [{ role: 'user', content:
      `Existing situation ids (do not duplicate these):\n${existingIds.join(', ')}\n\nDraft situations that cover these decisions:\n${lines.map(l => `- ${l}`).join('\n')}` }],
  })
  const text = res.content.map(b => (b.type === 'text' ? b.text : '')).join('')
  const parsed = extractJson(text)
  if (!Array.isArray(parsed)) throw new Error('reply was not an array')
  return parsed
}

async function main() {
  const args = process.argv.slice(2)
  const fromJsonAt = args.indexOf('--from-json')
  let drafts: unknown[] = []

  if (fromJsonAt >= 0) {
    drafts = JSON.parse(readFileSync(args[fromJsonAt + 1], 'utf8'))
  } else {
    const file = args[0]
    if (!file) { console.error('usage: npx tsx scripts/draft-playbooks.ts decisions.txt   (or --from-json drafts.json)'); process.exit(1) }
    if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY is not set'); process.exit(1) }
    const all = readLines(file)
    const uncovered = all.filter(l => !classifyPlaybook(l))
    console.log(`${all.length} decisions read · ${all.length - uncovered.length} already recognised (${Math.round(100 * (all.length - uncovered.length) / Math.max(1, all.length))}%) · ${uncovered.length} to draft`)
    const client = new Anthropic()
    const ids: string[] = PLAYBOOKS.map(p => p.id)
    for (let i = 0; i < uncovered.length; i += BATCH) {
      const chunk = uncovered.slice(i, i + BATCH)
      try {
        const got = await draftBatch(client, chunk, ids.concat(drafts.map(d => String((d as { id?: string }).id))))
        drafts.push(...got)
        console.log(`  batch ${i / BATCH + 1}: ${got.length} drafted`)
      } catch (err) { console.error(`  batch ${i / BATCH + 1} failed:`, err instanceof Error ? err.message : err) }
    }
  }

  const accepted: PlaybookDef[] = []
  const rejected: Array<{ draft: unknown; problems: string[] }> = []
  for (const d of drafts) {
    const def = d as PlaybookDef
    const problems = validatePlaybookDef(def, { against: [...PLAYBOOKS, ...accepted] })
    if (problems.length) rejected.push({ draft: d, problems }); else accepted.push(def)
  }

  mkdirSync('playbook-drafts', { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const header = `// REVIEW BEFORE MERGING. Model-drafted, machine-validated, not yet human-read.\n// Paste each entry into the matching lib/playbook-data/*.ts file, fix the wording, then run \`npm test\`.\nimport type { PlaybookDef } from '@/lib/decision-playbooks'\n\nexport const DRAFTS: PlaybookDef[] = [\n`
  writeFileSync(`playbook-drafts/${stamp}.ts`, `${header}${accepted.map(toSource).join('\n')}\n]\n`)
  writeFileSync(`playbook-drafts/${stamp}.rejected.json`, JSON.stringify(rejected, null, 2))
  console.log(`\n${accepted.length} accepted -> playbook-drafts/${stamp}.ts\n${rejected.length} rejected -> playbook-drafts/${stamp}.rejected.json`)
  for (const r of rejected.slice(0, 10)) console.log(`  x ${(r.draft as { id?: string }).id ?? '(no id)'}: ${r.problems[0]}`)
}

main().catch(err => { console.error(err); process.exit(1) })
