// lib/display-tags.ts
//
// Single, nesting-safe parser for the three INLINE display tags the advisors
// emit (see WORD_LIMIT_PREFIX #6 and the reversal / hidden-assumption beats in
// lib/personas.ts):
//
//   <assumption>…</assumption>   the dangerous unexamined assumption
//   <reversal>…</reversal>       the one fact that would flip the advisor
//   <estimate>…</estimate>       a council-suggested number (not user-stated)
//
// WHY THIS EXISTS
// PersonaPanel.renderAssumption used to find each tag with an independent
// indexOf / matchAll and then slice the text between the resulting spans. That
// silently assumed spans never overlap. The prompt forbids nesting <estimate>
// inside <reversal>/<assumption>, but models do it anyway — e.g.
//
//   <reversal>…less than <estimate>three months</estimate> of expenses…</reversal>
//
// With overlapping spans, `text.slice(cursor, span.start)` ran backwards (→ ''),
// the outer span's inner text kept the raw <estimate> markers, and the tail of
// the sentence was emitted twice ("…three months{estimate} of expenses…</reversal>").
// A reload made it worse (several tag pairs in one concatenated blob).
//
// This parser is a single left-to-right scan with per-kind pairing, so it:
//   • supports any nesting / interleaving of the three kinds,
//   • never duplicates or drops prose,
//   • never emits a raw tag, even for stray closers or unclosed openers
//     (unclosed openers are simply not highlighted — nothing is lost).

export type DisplayTagKind = 'assumption' | 'reversal' | 'estimate'

export type DisplayItem =
  | { type: 'text';   text: string; kinds: DisplayTagKind[] }
  // Emitted once, right after a paired <estimate> span closes. The UI renders
  // its "estimate" superscript here (color alone doesn't explain the highlight).
  | { type: 'estimateMarker' }

const TAG_RE = /<(\/?)(assumption|reversal|estimate)>/gi
const KINDS: DisplayTagKind[] = ['assumption', 'reversal', 'estimate']

interface Token { index: number; length: number; close: boolean; kind: DisplayTagKind; paired: boolean }

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  TAG_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TAG_RE.exec(text)) !== null) {
    tokens.push({
      index: m.index, length: m[0].length,
      close: m[1] === '/', kind: m[2].toLowerCase() as DisplayTagKind, paired: false,
    })
  }
  // Pair each closer with the nearest unmatched opener of the SAME kind.
  const openStacks: Record<DisplayTagKind, Token[]> = { assumption: [], reversal: [], estimate: [] }
  for (const t of tokens) {
    if (!t.close) { openStacks[t.kind].push(t); continue }
    const opener = openStacks[t.kind].pop()
    if (opener) { opener.paired = true; t.paired = true }
  }
  return tokens
}

/**
 * Split text into plain runs annotated with the display kinds active over them.
 * Only PAIRED tags create highlights; every tag marker (paired or stray) is
 * removed from the output text.
 */
export function parseDisplayTags(text: string): DisplayItem[] {
  const tokens = tokenize(text)
  const items: DisplayItem[] = []
  const depth: Record<DisplayTagKind, number> = { assumption: 0, reversal: 0, estimate: 0 }
  const active = (): DisplayTagKind[] => KINDS.filter(k => depth[k] > 0)

  const pushText = (s: string) => {
    if (!s) return
    const kinds = active()
    const last = items[items.length - 1]
    // Merge adjacent runs with identical kinds so output stays compact.
    if (last && last.type === 'text' && last.kinds.join() === kinds.join()) last.text += s
    else items.push({ type: 'text', text: s, kinds })
  }

  let cursor = 0
  for (const t of tokens) {
    pushText(text.slice(cursor, t.index))
    cursor = t.index + t.length
    if (!t.paired) continue                       // stray marker: drop it, keep the prose
    if (!t.close) { depth[t.kind] += 1; continue }
    depth[t.kind] = Math.max(0, depth[t.kind] - 1)
    if (t.kind === 'estimate') items.push({ type: 'estimateMarker' })
  }
  pushText(text.slice(cursor))
  return items
}

/** Outer→inner ordering used when wrapping nested highlights. */
export function orderKinds(kinds: DisplayTagKind[]): DisplayTagKind[] {
  const rank: Record<DisplayTagKind, number> = { assumption: 0, reversal: 1, estimate: 2 }
  return [...kinds].sort((a, b) => rank[a] - rank[b])
}

const TAG_NAMES = ['assumption', 'reversal', 'estimate']

/**
 * Remove every display-tag marker, keeping all prose. When `streaming` is true
 * a half-received marker at the very end ("…runway <estim") is cut too so raw
 * markup never flashes mid-stream.
 */
export function stripDisplayTags(text: string, opts: { streaming?: boolean } = {}): string {
  let out = text.replace(/<\/?(?:assumption|reversal|estimate)>/gi, '')
  if (opts.streaming) {
    const partial = /<\/?([a-z]*)$/i.exec(out)
    if (partial) {
      const frag = partial[1].toLowerCase()
      if (TAG_NAMES.some(n => n.startsWith(frag))) out = out.slice(0, partial.index)
    }
  }
  return out
}
