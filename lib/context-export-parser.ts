// lib/context-export-parser.ts
// ── Context Ingestion — export parsing (client-safe, no 'server-only') ──────
//
// Deliberately runs in the browser, inside components/ContextIngestionPanel.tsx,
// BEFORE anything is sent to the server. This is a stronger privacy property
// than "we delete your file after receiving it": the original file — which
// may contain far more than the conversation itself (a whole .docx's
// metadata, a whole .zip's other contents) — never leaves the user's
// device. Only the flattened, plain-text result of this module is POSTed to
// /api/context-ingestion, and the server discards that text the instant
// extraction returns (see lib/context-extractor.ts).
//
// Supported formats:
//   1. ChatGPT export — conversations.json (standalone, or sharded across
//      conversations-000.json, conversations-001.json, etc. inside the .zip
//      OpenAI's "Export data" produces — confirmed against a real 570-
//      conversation export that large accounts get sharded, not a single
//      file). Tree-structured: each conversation is a `mapping` of node id →
//      { message, parent, children }; the live branch is read by walking
//      BACKWARD from current_node via .parent, not forward from the root
//      (see flattenChatGPTConversation's comment — walking forward assumes
//      children[0] is the live branch, which was verified false in every
//      one of 570 real conversations tested).
//   2. Claude export — conversations.json with a flat `chat_messages` array
//      per conversation. Simpler shape, no tree walk needed.
//   3. v2 — Markdown (.md) — read as-is. Extraction already handles ##
//      headers / **bold** speaker markers fine as source text; no special
//      parsing adds value here, unlike the structured formats above.
//   4. v2 — HTML (.html) — many "export my chat" browser tools/sites produce
//      a styled transcript. Parsed via the browser's own DOMParser (no new
//      dependency) — script/style stripped, block-level tags forced onto
//      their own line so paragraphs don't run together.
//   5. v2 — Word (.docx) — a .docx is itself a zip; JSZip (already a dep for
//      #1) opens it and reads word/document.xml, then DOMParser's XML mode
//      pulls text out of <w:t> runs, one line per <w:p> paragraph.
//   6. v2 — Generic JSON — a chat export that isn't confidently ChatGPT's or
//      Claude's shape but still looks like an array of {role/sender/speaker,
//      content/text/message} objects (common output shape for third-party
//      "export as JSON" tools). Best-effort flatten; if it doesn't look like
//      a conversation at all, the person is pointed at pasting text instead.
//   7. Plaintext / pasted AI summary — no parsing, used as-is. This is also
//      the manual-text-description path's input.
//
// None of formats 3–6 get their own ContextIngestionSource value — they're
// all labeled 'file_upload' (vs. the confident 'chatgpt'/'claude' labels for
// #1–2), since the label is provenance only and extraction quality doesn't
// depend on it.
// ─────────────────────────────────────────────────────────────────────────────

import JSZip from 'jszip'
import type { ContextIngestionSource } from './types'

export interface ParsedExport {
  text:        string
  charCount:   number
  sourceType:  ContextIngestionSource
  truncated?:  boolean
}

// User-facing string for the upload section's "what's accepted" caption —
// single source of truth so the UI copy and the actual accept list can't
// drift apart.
export const ACCEPTED_FILE_TYPES_LABEL =
  'ChatGPT export (.zip, .json) · Claude export (.json) · Markdown, HTML, or Word transcript (.md, .html, .docx)'
export const ACCEPTED_FILE_EXTENSIONS = '.zip,.json,.md,.html,.docx'

// Hard cap before anything reaches the server — a full year of ChatGPT
// history can be tens of MB. Truncating (not rejecting) means a large
// export still yields a usable — if partial — result.
const MAX_CHARS = 400_000   // ~100k tokens

// Simple head-slice truncation — used for formats without a reliable
// per-item timestamp to bucket by (generic JSON, .md/.html/.docx, pasted
// text). ChatGPT and Claude use bucketAndAllocate() below instead.
function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_CHARS) return { text, truncated: false }
  return { text: text.slice(0, MAX_CHARS), truncated: true }
}

// Strips OpenAI's internal browsing/search citation tokens that sometimes
// leak directly into message text — e.g. "citeturn0search2turn0search0"
// or "citeturn1academia4turn2news1" (one or more "turn{N}{tool}{M}"
// chunks concatenated with no separator after "cite"). Confirmed present
// in real export data; harmless noise for extraction but worth cleaning up
// since it's free to do. Applied once, at the point each format's text is
// finalized, rather than per-message, so every format benefits without
// needing its own call site.
function stripCitationArtifacts(text: string): string {
  return text.replace(/\s*cite(?:turn\d+\w*?\d+)+\s*/gi, ' ')
}

// ── Diversity-aware bucketed truncation ──────────────────────────────────────
//
// A straight "sort newest-first, keep the first N characters" truncation
// (v2's original approach) has a real failure mode: if the account has been
// in an intense sprint on one topic recently, that sprint alone can fill
// the entire character budget, and every other conversation — regardless
// of how relevant it'd be to a future, unrelated decision — never reaches
// extraction at all. Verified this concretely: a real export produced a
// Foundational Context that was 15/15 facts about one GTM sprint.
//
// Fix: bucket conversations by age (last 30 days / 31–180 days / 180+ days,
// relative to the most recent conversation's own timestamp, not wall-clock
// "now" — an export itself could be old), allocate a fixed share of the
// character budget to each bucket (50/30/20), and within each bucket still
// prefer the newest conversations first. Whole conversations are kept or
// dropped — never split mid-conversation — and the very first conversation
// considered for a bucket is always included even if it alone exceeds that
// bucket's budget, so one large conversation can't zero out an entire time
// period, only dominate it. That's a known, accepted tradeoff over building
// something more elaborate (e.g. capping any single conversation's share of
// its own bucket) — the 50/30/20 split alone was enough to turn "0 of 198
// older conversations included" into "11 of 198 included" against the real
// export this was tested on, which is the actual problem worth solving here.

interface TimestampedItem {
  timestamp: number | null   // epoch seconds; null when the format has no reliable per-item time
  text:      string
}

const DAY_SECONDS = 86_400
const RECENT_MAX_AGE_DAYS = 30
const MID_MAX_AGE_DAYS    = 180
const BUCKET_SHARES = { recent: 0.5, mid: 0.3, older: 0.2 } as const

function bucketAndAllocate(items: TimestampedItem[], totalBudget: number): { text: string; truncated: boolean } {
  const withTs    = items.filter((i): i is { timestamp: number; text: string } => i.timestamp !== null)
  const withoutTs = items.filter(i => i.timestamp === null)

  // No usable timestamps at all (e.g. every conversation lacked one) —
  // fall back to the simple newest-first-order-assumed head slice rather
  // than bucketing on nothing.
  if (withTs.length === 0) {
    const joined = items.map(i => i.text).join('\n\n---\n\n')
    return truncate(joined)
  }

  const mostRecent = Math.max(...withTs.map(i => i.timestamp))
  const buckets = {
    recent: { items: [] as typeof withTs, budget: totalBudget * BUCKET_SHARES.recent },
    mid:    { items: [] as typeof withTs, budget: totalBudget * BUCKET_SHARES.mid },
    older:  { items: [] as typeof withTs, budget: totalBudget * BUCKET_SHARES.older },
  }
  for (const item of withTs) {
    const ageDays = (mostRecent - item.timestamp) / DAY_SECONDS
    if (ageDays <= RECENT_MAX_AGE_DAYS) buckets.recent.items.push(item)
    else if (ageDays <= MID_MAX_AGE_DAYS) buckets.mid.items.push(item)
    else buckets.older.items.push(item)
  }

  const chunks: string[] = []
  let includedCount = 0
  for (const bucket of [buckets.recent, buckets.mid, buckets.older]) {
    const sorted = [...bucket.items].sort((a, b) => b.timestamp - a.timestamp)
    let used = 0
    for (const item of sorted) {
      if (used > 0 && used + item.text.length > bucket.budget) break
      chunks.push(item.text)
      used += item.text.length
      includedCount++
    }
  }

  // Untimestamped items (shouldn't normally happen for ChatGPT/Claude, but
  // don't silently drop them if they occur) — appended last, budget-permitting.
  let combined = chunks.join('\n\n---\n\n')
  for (const item of withoutTs) {
    if (combined.length + item.text.length > totalBudget) break
    combined += (combined ? '\n\n---\n\n' : '') + item.text
    includedCount++
  }

  return { text: combined, truncated: includedCount < items.length }
}

// ── ChatGPT: walk the mapping tree ───────────────────────────────────────────

interface ChatGPTNode {
  id: string
  message: {
    author?: { role?: string }
    content?: { parts?: unknown[] }
    create_time?: number | null
  } | null
  parent: string | null
  children: string[]
}

interface ChatGPTConversation {
  title?: string
  create_time?: number | null   // conversation-level timestamp — used for bucketing/sorting across shards
  mapping: Record<string, ChatGPTNode>
  current_node?: string
}

function appendMessageLine(lines: string[], node: ChatGPTNode): void {
  const role = node.message?.author?.role
  const parts = node.message?.content?.parts
  if ((role === 'user' || role === 'assistant') && Array.isArray(parts)) {
    const text = parts.filter(p => typeof p === 'string').join(' ').trim()
    if (text) lines.push(`${role === 'user' ? 'User' : 'Assistant'}: ${text}`)
  }
}

function flattenChatGPTConversation(convo: ChatGPTConversation): string {
  const lines: string[] = []
  if (convo.title) lines.push(`# ${convo.title}`)

  // Walk BACKWARD from current_node via .parent, then reverse — this is the
  // one reliable way to get the actual displayed conversation. Walking
  // forward from the root via children[0] (the original approach here)
  // assumes the first branch at every fork is the live one; verified
  // against a real 570-conversation export that this is wrong essentially
  // always — root.children was empty/undefined in every single case,
  // so that walk terminated after one node and extracted zero messages
  // from all 570 conversations. current_node is ChatGPT's own pointer to
  // the leaf of whichever branch is actually showing, so walking up from
  // there and reversing is the correct chain regardless of how many
  // regenerations/edits a conversation has.
  const nodes = convo.mapping
  let node: ChatGPTNode | undefined = convo.current_node ? nodes[convo.current_node] : undefined

  // Fallback for the rare export shape without a usable current_node: fall
  // back to the previous root-forward walk rather than emitting nothing.
  if (!node) {
    const root = Object.values(nodes).find(n => n.parent === null)
    let current: ChatGPTNode | undefined = root
    const visitedFallback = new Set<string>()
    while (current && !visitedFallback.has(current.id)) {
      visitedFallback.add(current.id)
      appendMessageLine(lines, current)
      const nextId: string | undefined = current.children?.[0]
      current = nextId ? nodes[nextId] : undefined
    }
    return lines.join('\n')
  }

  const chain: ChatGPTNode[] = []
  const visited = new Set<string>()
  while (node && !visited.has(node.id)) {
    visited.add(node.id)
    chain.unshift(node)   // build oldest-to-newest by unshifting as we walk upward
    node = node.parent ? nodes[node.parent] : undefined
  }

  for (const n of chain) appendMessageLine(lines, n)
  return lines.join('\n')
}

// Real OpenAI "Export data" archives can shard conversations across
// multiple conversations-NNN.json files rather than one conversations.json
// (confirmed: a 570-conversation export split into 6 files of ~100 each),
// and shards are not necessarily in time order relative to each other. Every
// conversation across every merged shard is flattened here, then handed to
// bucketAndAllocate() so recency AND cross-time diversity both hold, instead
// of a flat sort+slice that lets one recent sprint crowd out everything else.
function parseChatGPTExport(json: unknown, budget: number): { text: string; truncated: boolean } {
  const conversations = Array.isArray(json) ? json as ChatGPTConversation[] : []
  const items: TimestampedItem[] = conversations
    .map(c => ({ timestamp: c.create_time ?? null, text: flattenChatGPTConversation(c) }))
    .filter(i => i.text.trim())
  const { text, truncated } = bucketAndAllocate(items, budget)
  return { text: stripCitationArtifacts(text), truncated }
}

// ── Claude: flat chat_messages array ─────────────────────────────────────────

interface ClaudeMessage {
  sender?: string
  text?: string
  content?: Array<{ text?: string }>
}

interface ClaudeConversation {
  name?: string
  created_at?: string   // ISO timestamp, when present — used for the same bucketing as ChatGPT
  chat_messages?: ClaudeMessage[]
}

function flattenClaudeConversation(convo: ClaudeConversation): string {
  const lines: string[] = []
  if (convo.name) lines.push(`# ${convo.name}`)
  for (const m of convo.chat_messages ?? []) {
    const role = m.sender === 'human' ? 'User' : 'Assistant'
    const text = m.text?.trim() || (m.content ?? []).map(c => c.text ?? '').join(' ').trim()
    if (text) lines.push(`${role}: ${text}`)
  }
  return lines.join('\n')
}

// Same bucketing as ChatGPT when created_at is present; falls back to
// bucketAndAllocate's own no-timestamp path (simple head slice) otherwise —
// Claude's export doesn't always include a conversation-level timestamp in
// every version of the format, so this degrades gracefully rather than
// assuming it's always there.
function parseClaudeExport(json: unknown, budget: number): { text: string; truncated: boolean } {
  const conversations = Array.isArray(json) ? json as ClaudeConversation[] : []
  const items: TimestampedItem[] = conversations
    .map(c => ({
      timestamp: c.created_at ? Math.floor(Date.parse(c.created_at) / 1000) || null : null,
      text: flattenClaudeConversation(c),
    }))
    .filter(i => i.text.trim())
  const { text, truncated } = bucketAndAllocate(items, budget)
  return { text: stripCitationArtifacts(text), truncated }
}

// ── v2: generic JSON conversation shape ──────────────────────────────────────
// Best-effort flatten for third-party "export as JSON" tools that produce
// something like [{role: 'user', content: '...'}, ...] or
// [{sender: 'assistant', text: '...'}, ...] without matching ChatGPT's or
// Claude's specific shape. Deliberately loose field-name matching since
// there's no single standard here. No reliable per-item timestamp for an
// arbitrary third-party shape, so this stays on the simple head-slice
// truncation rather than bucketing.

interface GenericMessage {
  role?: unknown; sender?: unknown; speaker?: unknown
  content?: unknown; text?: unknown; message?: unknown
}

function looksLikeGenericConversation(arr: unknown[]): boolean {
  if (arr.length === 0) return false
  const first = arr[0] as GenericMessage
  if (typeof first !== 'object' || first === null) return false
  const hasRole = 'role' in first || 'sender' in first || 'speaker' in first
  const hasText = 'content' in first || 'text' in first || 'message' in first
  return hasRole && hasText
}

function flattenGenericConversation(arr: unknown[]): string {
  const lines: string[] = []
  for (const item of arr) {
    if (typeof item !== 'object' || item === null) continue
    const m = item as GenericMessage
    const roleRaw = m.role ?? m.sender ?? m.speaker
    const textRaw = m.content ?? m.text ?? m.message
    const text = typeof textRaw === 'string' ? textRaw.trim()
      : Array.isArray(textRaw) ? textRaw.map(p => (typeof p === 'string' ? p : (p as { text?: string })?.text ?? '')).join(' ').trim()
      : ''
    if (!text) continue
    const roleStr = typeof roleRaw === 'string' ? roleRaw.toLowerCase() : ''
    const role = /assistant|ai|bot|claude|gpt|chatgpt|model/.test(roleStr) ? 'Assistant' : 'User'
    lines.push(`${role}: ${text}`)
  }
  return stripCitationArtifacts(lines.join('\n'))
}

// Unwraps a common one-level-of-nesting shape: { messages: [...] } or
// { conversation: [...] } instead of a bare top-level array.
function unwrapToArray(json: unknown): unknown[] | null {
  if (Array.isArray(json)) return json
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>
    for (const key of ['messages', 'conversation', 'chat_messages', 'mapping']) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[]
    }
  }
  return null
}

// ── Shape sniffing ────────────────────────────────────────────────────────────

function detectAndParse(json: unknown): { text: string; sourceType: ContextIngestionSource; truncated: boolean } | null {
  const arr = unwrapToArray(json)
  if (!arr || arr.length === 0) return null
  const first = arr[0] as Record<string, unknown>
  if (typeof first !== 'object' || first === null) return null

  if ('mapping' in first) {
    const { text, truncated } = parseChatGPTExport(arr, MAX_CHARS)
    return { text, sourceType: 'chatgpt', truncated }
  }
  if ('chat_messages' in first) {
    const { text, truncated } = parseClaudeExport(arr, MAX_CHARS)
    return { text, sourceType: 'claude', truncated }
  }
  if (looksLikeGenericConversation(arr)) {
    const { text, truncated } = truncate(flattenGenericConversation(arr))
    return { text, sourceType: 'file_upload', truncated }
  }
  return null
}

// ── v2: HTML → text ──────────────────────────────────────────────────────────
// Uses the browser's own DOMParser — no new dependency. Forces a newline
// after each block-level element before reading textContent, since
// textContent alone collapses "<p>Hello</p><p>World</p>" into "HelloWorld".

function parseHtmlToText(raw: string): string {
  const doc = new DOMParser().parseFromString(raw, 'text/html')
  doc.querySelectorAll('script, style, noscript').forEach(el => el.remove())
  doc.querySelectorAll('p, br, div, li, h1, h2, h3, h4, h5, h6, tr, blockquote').forEach(el => {
    el.insertAdjacentText('afterend', '\n')
  })
  return (doc.body?.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}

// ── v2: .docx → text ──────────────────────────────────────────────────────────
// A .docx is a zip containing word/document.xml (OOXML). Reuses JSZip
// (already a dependency for #1's .zip handling) rather than adding a full
// docx-parsing library — text runs live in <w:t> elements, one paragraph
// per <w:p>.

async function parseDocxFile(file: File): Promise<string> {
  const zip = await JSZip.loadAsync(file)
  const docXml = zip.file('word/document.xml')
  if (!docXml) {
    throw new Error("Couldn't read this .docx — is it a standard Word document? Try pasting the text instead.")
  }
  const xml = await docXml.async('text')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const paragraphs = Array.from(doc.getElementsByTagName('w:p'))
  const lines = paragraphs
    .map(p => Array.from(p.getElementsByTagName('w:t')).map(t => t.textContent ?? '').join(''))
    .filter(line => line.trim())
  return lines.join('\n')
}

// ── Public entry points ──────────────────────────────────────────────────────

/**
 * Parse an uploaded File. Runs entirely in the browser; never touches the
 * network itself. Throws a user-facing Error message on unrecognized shape
 * so the caller can show it directly rather than a generic failure.
 */
export async function parseExportFile(file: File): Promise<ParsedExport> {
  const name = file.name.toLowerCase()

  // v2: .docx first — it's technically a zip too, so this check must come
  // before the generic .zip branch below.
  if (name.endsWith('.docx')) {
    const text = await parseDocxFile(file)
    if (!text.trim()) {
      throw new Error("Couldn't find readable text in this .docx. Try pasting the text instead.")
    }
    const truncatedResult = truncate(stripCitationArtifacts(text))
    return { text: truncatedResult.text, charCount: truncatedResult.text.length, sourceType: 'file_upload', truncated: truncatedResult.truncated }
  }

  // v2: .md — no parsing needed, just read it. LLM extraction handles
  // markdown formatting fine as source text.
  if (name.endsWith('.md') || name.endsWith('.markdown')) {
    const raw = await file.text()
    if (!raw.trim()) throw new Error('This file looks empty. Try pasting the text instead.')
    const { text, truncated } = truncate(stripCitationArtifacts(raw.trim()))
    return { text, charCount: text.length, sourceType: 'file_upload', truncated }
  }

  // v2: .html
  if (name.endsWith('.html') || name.endsWith('.htm')) {
    const raw = await file.text()
    const text = parseHtmlToText(raw)
    if (!text) throw new Error("Couldn't find readable text in this HTML file. Try pasting the text instead.")
    const truncatedResult = truncate(stripCitationArtifacts(text))
    return { text: truncatedResult.text, charCount: truncatedResult.text.length, sourceType: 'file_upload', truncated: truncatedResult.truncated }
  }

  let raw: string
  if (name.endsWith('.zip')) {
    const zip = await JSZip.loadAsync(file)
    // Matches both the single-file `conversations.json` and OpenAI's
    // sharded `conversations-000.json`, `conversations-001.json`, etc. —
    // matched on the basename only, in case the export nests files in a
    // subfolder, and matched broadly (not just one exact filename) because
    // a real export can arrive as any number of shards depending on how
    // much history the account has.
    const convoFiles = Object.values(zip.files).filter(f => {
      if (f.dir) return false
      const base = f.name.split('/').pop() ?? f.name
      return /^conversations(-\d+)?\.json$/i.test(base)
    })
    if (convoFiles.length === 0) {
      throw new Error("Couldn't find a conversations.json (or conversations-NNN.json) inside this .zip — is this a ChatGPT data export?")
    }

    // Merge every shard's array into one before parsing, so bucketing in
    // parseChatGPTExport() operates across the whole export, not just
    // whichever shard happened to be found first.
    const shardArrays = await Promise.all(
      convoFiles.map(async f => {
        try {
          const text = await f.async('text')
          const parsed = JSON.parse(text)
          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []   // one corrupt shard shouldn't sink the whole import
        }
      })
    )
    const merged = shardArrays.flat()
    if (merged.length === 0) {
      throw new Error("Found conversation files in this .zip, but couldn't read any conversations from them. Try pasting the text instead.")
    }

    const { text, truncated } = parseChatGPTExport(merged, MAX_CHARS)
    if (!text.trim()) {
      throw new Error("This .zip's conversation files didn't contain any readable messages. Try pasting the text instead.")
    }
    return { text, charCount: text.length, sourceType: 'chatgpt', truncated }
  } else if (name.endsWith('.json')) {
    raw = await file.text()
  } else {
    throw new Error(`Please upload one of: ${ACCEPTED_FILE_TYPES_LABEL}, or paste text instead.`)
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error("This file doesn't look like valid JSON. Try re-exporting, or paste text instead.")
  }

  const parsed = detectAndParse(json)
  if (!parsed || !parsed.text.trim()) {
    throw new Error("This doesn't match a supported export format. You can paste text instead.")
  }

  return { text: parsed.text, charCount: parsed.text.length, sourceType: parsed.sourceType, truncated: parsed.truncated }
}

/**
 * Manual text / pasted-summary path — no parsing, just validation + the same
 * truncation cap applied to uploads.
 */
export function parsePlainText(raw: string, sourceType: 'manual' | 'pasted_summary'): ParsedExport {
  const trimmed = raw.trim()
  const { text, truncated } = truncate(trimmed)
  return { text, charCount: text.length, sourceType, truncated }
}
