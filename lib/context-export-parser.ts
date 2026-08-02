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
//   1. ChatGPT export — conversations.json (standalone or inside the .zip
//      OpenAI's "Export data" produces). Tree-structured: each conversation
//      is a `mapping` of node id → { message, parent, children }, walked
//      from the root to flatten in order.
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
//
// Keeps the FRONT of the text, not the tail: parseChatGPTExport() below
// sorts conversations newest-first before flattening specifically so this
// works correctly — a real export can arrive sharded across multiple
// conversations-NNN.json files that are NOT in chronological order relative
// to each other (confirmed against an actual OpenAI export: shard 000
// spanned Jan 2023–Mar 2026, shard 005 spanned May 2023–Aug 2024 — nothing
// about shard order implies time order), so naively keeping "whatever ends
// up last after concatenation" would not reliably keep the most recent
// conversations. Sort first, then keep the front.
const MAX_CHARS = 400_000   // ~100k tokens

function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_CHARS) return { text, truncated: false }
  return { text: text.slice(0, MAX_CHARS), truncated: true }
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
  create_time?: number | null   // conversation-level timestamp — used to sort shards into recency order
  mapping: Record<string, ChatGPTNode>
  current_node?: string
}

function flattenChatGPTConversation(convo: ChatGPTConversation): string {
  const lines: string[] = []
  if (convo.title) lines.push(`# ${convo.title}`)

  const nodes = Object.values(convo.mapping)
  const root = nodes.find(n => n.parent === null)
  if (!root) return lines.join('\n')

  let current: ChatGPTNode | undefined = root
  const visited = new Set<string>()
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    const role = current.message?.author?.role
    const parts = current.message?.content?.parts
    if ((role === 'user' || role === 'assistant') && Array.isArray(parts)) {
      const text = parts.filter(p => typeof p === 'string').join(' ').trim()
      if (text) lines.push(`${role === 'user' ? 'User' : 'Assistant'}: ${text}`)
    }
    const nextId: string | undefined = current.children?.[0]
    current = nextId ? convo.mapping[nextId] : undefined
  }
  return lines.join('\n')
}

// Real OpenAI "Export data" archives can shard conversations across
// multiple conversations-NNN.json files rather than one conversations.json
// (confirmed: a 570-conversation export split into 6 files of ~100 each).
// Shards are not necessarily in time order relative to each other, so every
// conversation across every shard is sorted by create_time (newest first)
// here, once, before flattening — see the note on truncate() for why this
// ordering matters once the combined text exceeds MAX_CHARS.
function parseChatGPTExport(json: unknown): string {
  const conversations = Array.isArray(json) ? json as ChatGPTConversation[] : []
  const sorted = [...conversations].sort((a, b) => (b.create_time ?? 0) - (a.create_time ?? 0))
  return sorted.map(flattenChatGPTConversation).filter(Boolean).join('\n\n---\n\n')
}

// ── Claude: flat chat_messages array ─────────────────────────────────────────

interface ClaudeMessage {
  sender?: string
  text?: string
  content?: Array<{ text?: string }>
}

interface ClaudeConversation {
  name?: string
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

function parseClaudeExport(json: unknown): string {
  const conversations = Array.isArray(json) ? json as ClaudeConversation[] : []
  return conversations.map(flattenClaudeConversation).filter(Boolean).join('\n\n---\n\n')
}

// ── v2: generic JSON conversation shape ──────────────────────────────────────
// Best-effort flatten for third-party "export as JSON" tools that produce
// something like [{role: 'user', content: '...'}, ...] or
// [{sender: 'assistant', text: '...'}, ...] without matching ChatGPT's or
// Claude's specific shape. Deliberately loose field-name matching since
// there's no single standard here.

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
  return lines.join('\n')
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

function detectAndParse(json: unknown): { text: string; sourceType: ContextIngestionSource } | null {
  const arr = unwrapToArray(json)
  if (!arr || arr.length === 0) return null
  const first = arr[0] as Record<string, unknown>
  if (typeof first !== 'object' || first === null) return null

  if ('mapping' in first) {
    return { text: parseChatGPTExport(arr), sourceType: 'chatgpt' }
  }
  if ('chat_messages' in first) {
    return { text: parseClaudeExport(arr), sourceType: 'claude' }
  }
  if (looksLikeGenericConversation(arr)) {
    return { text: flattenGenericConversation(arr), sourceType: 'file_upload' }
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
    const truncatedResult = truncate(text)
    return { text: truncatedResult.text, charCount: truncatedResult.text.length, sourceType: 'file_upload', truncated: truncatedResult.truncated }
  }

  // v2: .md — no parsing needed, just read it. LLM extraction handles
  // markdown formatting fine as source text.
  if (name.endsWith('.md') || name.endsWith('.markdown')) {
    const raw = await file.text()
    if (!raw.trim()) throw new Error('This file looks empty. Try pasting the text instead.')
    const { text, truncated } = truncate(raw.trim())
    return { text, charCount: text.length, sourceType: 'file_upload', truncated }
  }

  // v2: .html
  if (name.endsWith('.html') || name.endsWith('.htm')) {
    const raw = await file.text()
    const text = parseHtmlToText(raw)
    if (!text) throw new Error("Couldn't find readable text in this HTML file. Try pasting the text instead.")
    const truncatedResult = truncate(text)
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

    // Merge every shard's array into one before parsing, so sorting-by-
    // recency in parseChatGPTExport() operates across the whole export, not
    // just whichever shard happened to be found first.
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

    const text = parseChatGPTExport(merged)
    if (!text.trim()) {
      throw new Error("This .zip's conversation files didn't contain any readable messages. Try pasting the text instead.")
    }
    const { text: truncatedText, truncated } = truncate(text)
    return { text: truncatedText, charCount: truncatedText.length, sourceType: 'chatgpt', truncated }
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

  const { text, truncated } = truncate(parsed.text)
  return { text, charCount: text.length, sourceType: parsed.sourceType, truncated }
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
