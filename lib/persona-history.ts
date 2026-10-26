// lib/persona-history.ts
//
// One advisor's thread = original analysis + a chronological list of later
// exchanges. Two kinds of later exchange exist:
//
//   pushback  — the person pressed "Disagree or ask a follow-up" on THIS advisor
//   update    — another advisor's challenge (or a synthesis-level challenge)
//               was broadcast to the whole council and this advisor reassessed
//
// This module is the single place that knows how that thread is
//   (a) serialized to the flat string SessionView keeps per advisor,
//   (b) rebuilt from the `messages` table on reload (app/session/[id]/page.tsx),
//   (c) replayed to the model so the advisor can see its OWN earlier analysis.
//
// Before this existed:
//   • (b) concatenated every assistant row with "\n\n" and no structure, so a
//     reloaded card rendered the original + all replies as ONE paragraph with
//     several <assumption>/<reversal>/<estimate> pairs in it (tag leak), and
//     `synthesis` was the concatenation of EVERY synthesis ever generated
//     (the first <verdict> won → "synthesis never changes").
//   • (c) was missing — `messages` only held the person's challenges, so the
//     model was asked "what does this change in your prior analysis?" without
//     being shown that analysis, and had no lean to stay consistent with.

export const NEW_INFO_PREFIX = 'New information has surfaced during this review'

export interface PushbackSegment { kind: 'pushback'; user: string; reply: string }
export interface UpdateSegment   { kind: 'update';   info: string; reply: string }
export type HistorySegment = PushbackSegment | UpdateSegment

export interface ParsedPersonaContent { initial: string; history: HistorySegment[] }

/** Build the "New information…" message every advisor receives on a challenge. */
export function buildNewInfoMessage(text: string, priorLean?: string, seq?: number): string {
  const leanLine = priorLean
    ? `\n\nYour lean before this update was "${priorLean}". Keep the SAME polarity you used originally ("wait" = lean toward not taking the action / delaying; "proceed" = lean toward taking it). Only change it if this information genuinely changes your view — if it strengthens your existing position, your lean is unchanged.`
    : ''
  // `seq` makes two challenges with identical wording distinct strings — PersonaPanel's
  // effect de-dupes on the exact message, so identical text would otherwise be ignored.
  return `${NEW_INFO_PREFIX}${seq ? ` (update ${seq})` : ''}:\n\n"${text}"\n\nReassess it independently through your own lens — you may keep, strengthen, weaken, or reverse your position based on it. Provide a concise update (under 200 words) either way: state plainly whether this changes your view, and why.${leanLine}`
}

/** Pull the person's original words back out of a "New information…" message. */
export function extractNewInfo(userRow: string): string {
  const m = userRow.match(/New information has surfaced during this review(?: \(update \d+\))?:\s*\n\n"([\s\S]*?)"\n\nReassess/)
  return m ? m[1] : ''
}

// ── (a) serialize / parse ────────────────────────────────────────────────────
export function serializePersonaContent(initialRaw: string, history: HistorySegment[]): string {
  const parts = [initialRaw]
  for (const seg of history) {
    parts.push(seg.kind === 'pushback'
      ? `[Pushback: "${seg.user}"]\n${seg.reply}`
      : `[Updated after Examiner answers${seg.info ? `: "${seg.info}"` : ''}]\n${seg.reply}`)
  }
  return parts.join('\n\n')
}

const MARKER_RE = /\n\n\[(?:Pushback: "([\s\S]*?)"|Updated after Examiner answers(?:: "([\s\S]*?)")?)\]\n/g

export function parsePersonaContent(content: string): ParsedPersonaContent {
  const markers: { start: number; end: number; kind: 'pushback' | 'update'; text: string }[] = []
  MARKER_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MARKER_RE.exec(content)) !== null) {
    markers.push({
      start: m.index, end: m.index + m[0].length,
      kind: m[1] !== undefined ? 'pushback' : 'update',
      text: m[1] ?? m[2] ?? '',
    })
  }
  if (markers.length === 0) return { initial: content, history: [] }
  const history: HistorySegment[] = markers.map((mk, i) => {
    const reply = content.slice(mk.end, i + 1 < markers.length ? markers[i + 1].start : undefined)
    return mk.kind === 'pushback'
      ? { kind: 'pushback', user: mk.text, reply }
      : { kind: 'update',   info: mk.text, reply }
  })
  return { initial: content.slice(0, markers[0].start), history }
}

// ── (b) rebuild from DB rows ─────────────────────────────────────────────────
export interface MessageRow { persona: string | null; role: string; content: string }

// Keys that are NOT advisors: only their most recent assistant row is current.
const LATEST_ONLY = new Set(['synthesis', 'decision_brief'])

/**
 * rows MUST be in chronological order (oldest → newest) with content already
 * decrypted. Returns the same shape SessionView expects (personaKey → string),
 * but structured so PersonaPanel can parse the thread back out.
 */
export function buildInitialMessages(rows: MessageRow[]): Record<string, string> {
  const initial:  Record<string, string> = {}
  const history:  Record<string, HistorySegment[]> = {}
  const pending:  Record<string, string | null> = {}
  const latest:   Record<string, string> = {}

  for (const row of rows) {
    const key = row.persona
    if (!key || !row.content) continue

    if (LATEST_ONLY.has(key)) {
      if (row.role === 'assistant') latest[key] = row.content   // newest wins
      continue
    }
    if (row.role === 'user') { pending[key] = row.content; continue }
    if (row.role !== 'assistant') continue

    const user = pending[key] ?? null
    pending[key] = null
    if (initial[key] === undefined) { initial[key] = row.content; history[key] = []; continue }

    if (user === null && history[key].length === 0) {
      // Assistant row with no preceding user turn and no history yet = a retry
      // of the INITIAL call (e.g. the missing-<lens> silent retry). Newest wins.
      initial[key] = row.content
      continue
    }
    history[key].push(
      user !== null && user.startsWith(NEW_INFO_PREFIX)
        ? { kind: 'update',   info: extractNewInfo(user), reply: row.content }
        : { kind: 'pushback', user: user ?? '',           reply: row.content },
    )
  }

  const out: Record<string, string> = {}
  for (const key of Object.keys(initial)) out[key] = serializePersonaContent(initial[key], history[key])
  for (const key of Object.keys(latest))  out[key] = latest[key]
  return out
}

// ── (c) replay to the model ──────────────────────────────────────────────────
export interface ChatTurn { role: 'user' | 'assistant'; content: string }

/**
 * Conversation the advisor sees when answering a NEW challenge: its own
 * original analysis (tag-intact, so its <lean> is visible), every earlier
 * exchange in order, then the new user turn. Strictly alternates assistant /
 * user starting with assistant (the server prepends the decision prompt as the
 * opening user turn).
 */
export function buildAdvisorConversation(
  initialRaw: string,
  history: HistorySegment[],
  newUserTurn: string,
): ChatTurn[] {
  const turns: ChatTurn[] = []
  if (initialRaw) turns.push({ role: 'assistant', content: initialRaw })
  for (const seg of history) {
    turns.push({
      role: 'user',
      content: seg.kind === 'pushback' ? seg.user : buildNewInfoMessage(seg.info),
    })
    turns.push({ role: 'assistant', content: seg.reply })
  }
  turns.push({ role: 'user', content: newUserTurn })
  return turns
}
