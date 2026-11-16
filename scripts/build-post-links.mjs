#!/usr/bin/env node
// scripts/build-post-links.mjs
// Turns a content calendar into ready-to-paste links that open Quorum with the scenario from the post already in the box.
//
//   node scripts/build-post-links.mjs scripts/post-calendar.sample.csv [https://app.quorumvault.org] > links.csv
//
// Input CSV (header row required), one post per line:
//   source,medium,campaign,content,scenario
//   linkedin,post,nov_gtm,li_post_12,job_offers
//
// `scenario` is a slug from lib/post-scenarios.ts (or one of the four ids in lib/intake-examples.ts). Leave it empty for a
// plain link with no text in the box. Unknown slugs stop the script, so a typo never ships in a post.
// Output: the same rows plus a `url` column. Nothing is sent anywhere.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const [, , csvPath, baseArg] = process.argv
if (!csvPath) { console.error('Usage: node scripts/build-post-links.mjs <calendar.csv> [base-url]'); process.exit(1) }
const base = (baseArg || process.env.APP_URL || 'https://app.quorumvault.org').replace(/\/+$/, '')

// Known slugs, read from the two source files (the app is TypeScript; this script stays dependency-free).
const slugs = new Set()
for (const [file, re] of [['lib/post-scenarios.ts', /slug:\s*'([a-z0-9_]+)'/g], ['lib/intake-examples.ts', /\bid:\s+'([a-z0-9_]+)'/g]]) {
  const text = readFileSync(join(root, file), 'utf8')
  for (const m of text.matchAll(re)) slugs.add(m[1])
}

function parseCsv(text) {
  return text.split(/\r?\n/).filter(l => l.trim()).map(l => l.split(',').map(c => c.trim()))
}
const [header, ...rows] = parseCsv(readFileSync(csvPath, 'utf8'))
const col = Object.fromEntries(header.map((h, i) => [h.toLowerCase(), i]))
for (const need of ['source', 'medium', 'campaign', 'content', 'scenario']) {
  if (!(need in col)) { console.error(`Missing column "${need}". Header must be: source,medium,campaign,content,scenario`); process.exit(1) }
}

let bad = 0
const out = [[...header, 'url'].join(',')]
for (const r of rows) {
  const get = k => r[col[k]] ?? ''
  const scenario = get('scenario')
  if (scenario && !slugs.has(scenario)) { console.error(`Unknown scenario "${scenario}" in row: ${r.join(',')}`); bad++; continue }
  const q = new URLSearchParams()
  if (scenario) q.set('scenario', scenario)
  q.set('utm_source', get('source')); q.set('utm_medium', get('medium'))
  q.set('utm_campaign', get('campaign')); q.set('utm_content', get('content'))
  out.push([...r, `${base}/?${q.toString()}`].join(','))
}
if (bad) { console.error(`${bad} row(s) skipped. Known scenarios: ${[...slugs].sort().join(', ')}`); process.exitCode = 1 }
console.log(out.join('\n'))
