// lib/context-export-parser.ts
// ── Context Ingestion — export parsing (client-safe, no 'server-only') ──────
//
// Deliberately runs in the browser, inside components/ContextIngestionPanel.tsx,
// BEFORE anything is sent to the server. This is a stronger privacy property
// than "we delete your file after receiving it": the original .zip/.json
// export — which may contain far more than the conversations themselves —
// never leaves the user's device. Only the flattened, plain-text result of
// this module is POSTed to /api/context-ingestion, and the server discards
// that text the instant extraction returns (see lib/context-extractor.ts).
//
// Supported v1 formats, in priority order (per product decision — ChatGPT
// has the largest install base):
//   1. ChatGPT export — conversations.json (standalone or inside the .zip
//      OpenAI's "Export data" produces). Tree-structured: each conversation
//      is a `mapping` of node id → { message, parent, children }, walked
//      from the root to flatten in order.
//   2. Claude export — conversations.json with a flat `chat_messages` array
//      per conversation. Simpler shape, no tree walk needed.
//   3. Plaintext / pasted AI summary — no parsing, used as-is. This is also
//      the manual-text-description path's input.
// ─────────────────────────────────────────────────────────────────────────────

import JSZip from 'jszip'
import type { ContextIngestionSource } from './types'

export interface ParsedExport {
  text:        string
  charCount:   number
  sourceType:  ContextIngestionSource
  truncated?:  boolean
}

// Hard cap before anything reaches the server — a full year of ChatGPT
// history can be tens of MB. Truncating (not rejecting) means a large
// export still yields a usable — if partial — result. Most recent content
// kept, since it's the most likely to reflect current context.
const MAX_CHARS = 400_000   // ~100k tokens, safely inside a single sync extraction call

function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_CHARS) return { text, truncated: false }
  return { text: text.slice(text.length - MAX_CHARS), truncated: true }
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
  mapping: Record<string, ChatGPTNode>
  current_node?: string
}

function flattenChatGPTConversation(convo: ChatGPTConversation): string {
  const lines: string[] = []
  if (convo.title) lines.push(`# ${convo.title}`)

  // Find the root (node with parent === null), then walk children in order.
  // current_node is the leaf of whichever branch was last active — walking
  // from root via .children[0] covers the common single-branch case; if a
  // conversation was edited/regenerated, later branches are skipped, which
  // is fine here (we want representative signal, not a perfect transcript).
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

function parseChatGPTExport(json: unknown): string {
  const conversations = Array.isArray(json) ? json as ChatGPTConversation[] : []
  return conversations.map(flattenChatGPTConversation).filter(Boolean).join('\n\n---\n\n')
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

// ── Shape sniffing ────────────────────────────────────────────────────────────

function detectAndParse(json: unknown): { text: string; sourceType: ContextIngestionSource } | null {
  if (!Array.isArray(json) || json.length === 0) return null
  const first = json[0] as Record<string, unknown>

  if ('mapping' in first) {
    return { text: parseChatGPTExport(json), sourceType: 'chatgpt' }
  }
  if ('chat_messages' in first) {
    return { text: parseClaudeExport(json), sourceType: 'claude' }
  }
  return null
}

// ── Public entry points ──────────────────────────────────────────────────────

/**
 * Parse an uploaded File — .zip (ChatGPT's export format) or a bare .json.
 * Runs entirely in the browser via the File/JSZip APIs; never touches the
 * network itself. Throws a user-facing Error message on unrecognized shape
 * so the caller can show it directly rather than a generic failure.
 */
export async function parseExportFile(file: File): Promise<ParsedExport> {
  let raw: string

  if (file.name.endsWith('.zip')) {
    const zip = await JSZip.loadAsync(file)
    const convoFile = Object.values(zip.files).find(f =>
      f.name.endsWith('conversations.json') && !f.dir
    )
    if (!convoFile) {
      throw new Error("Couldn't find conversations.json inside this .zip — is this a ChatGPT or Claude data export?")
    }
    raw = await convoFile.async('text')
  } else if (file.name.endsWith('.json')) {
    raw = await file.text()
  } else {
    throw new Error('Please upload the .zip or conversations.json file from your export, or paste text instead.')
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error("This file doesn't look like valid export JSON. Try re-exporting, or paste text instead.")
  }

  const parsed = detectAndParse(json)
  if (!parsed || !parsed.text.trim()) {
    throw new Error("This doesn't match a supported ChatGPT or Claude export format. You can paste text instead.")
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
