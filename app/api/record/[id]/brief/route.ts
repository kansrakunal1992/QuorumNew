// app/api/record/[id]/brief/route.ts
// ── Sprint 8: Decision Brief PDF (v2) ────────────────────────────────────────
//
// Fixes vs v1:
//   1. Unicode sanitiser — replaces Rs./₹ and all non-Latin-1 chars before
//      passing to jsPDF (Latin-1 encoding; anything outside it renders as garbage)
//   2. Line-by-line rendering throughout — no pre-calculated box heights that
//      go wrong when text wraps more than estimated
//   3. Dark premium layout — deep navy/black pages, gold accents, per-persona
//      colour bands matching the Quorum UI dark theme
//   4. Dynamic import — avoids "window is not defined" in Next.js server context
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { PERSONAS, DECISION_BRIEF } from '@/lib/personas'
import { createCompletion }   from '@/lib/ai-client'
import type { PersonaKey }     from '@/lib/types'
import { encrypt, decrypt }    from '@/lib/encryption'

const APPENDIX_ORDER: PersonaKey[] = [
  'synthesis',
  'contrarian',
  'risk_architect',
  'pattern_analyst',
  'stakeholder_mirror',
  'elder',
  'competitor',
]

// ── Unicode → Latin-1 sanitiser ───────────────────────────────────────────────
// jsPDF default encoding is Latin-1 (Windows-1252). Characters outside this
// range render as garbage (e.g. ₹ → ¹, — → ?, " → ?).
// This sanitiser replaces common non-Latin-1 chars with ASCII equivalents
// before any text reaches the PDF renderer.

function sanitise(text: string): string {
  return text
    // Currency
    .replace(/₹/g, 'Rs.')
    .replace(/€/g, 'EUR ')
    .replace(/£/g, 'GBP ')
    .replace(/\$/g, '$')
    // Dashes and hyphens
    .replace(/[\u2013\u2014]/g, '--')   // en-dash, em-dash
    .replace(/\u2012/g, '-')            // figure dash
    // Smart quotes → straight
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    // Ellipsis
    .replace(/\u2026/g, '...')
    // Bullets
    .replace(/[\u2022\u2023\u25E6\u2043]/g, '-')
    // Arrows
    .replace(/\u2192/g, '->')
    .replace(/\u2190/g, '<-')
    // Multiplication / degree
    .replace(/\u00D7/g, 'x')
    .replace(/\u00B0/g, ' deg')
    // Fractions
    .replace(/\u00BD/g, '1/2')
    .replace(/\u00BC/g, '1/4')
    .replace(/\u00BE/g, '3/4')
    // Remove any remaining non-Latin-1
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x00-\xFF]/g, '?')
}

// Strip the examiner-style wrapper that "share to all advisors" prepends to
// user pushback messages before they are saved to the DB, leaving only the
// raw pushback text the decision-maker actually typed.
function cleanPushbackText(raw: string): string {
  return raw
    // Remove "The user submitted the following new information while
    // challenging another advisor. Review it and update your position
    // if it changes your assessment:" preamble
    .replace(/^The user submitted the following[^"\n]*[:\n]+\s*/i, '')
    // Remove the quoted wrapper if present: "..."
    .replace(/^"([\s\S]*)"\s*$/, '$1')
    // Remove the trailing instruction block
    .replace(/\s*Provide a concise update[\s\S]*$/i, '')
    .trim()
}

// Strip <lens>, <position>, <realcost>, <verdict>, <tension> tags from advisor text
function stripAdvisorTags(raw: string): string {
  return raw
    .replace(/<lens>[\s\S]*?<\/lens>/gi, '')
    .replace(/<position>[\s\S]*?<\/position>/gi, '')
    .replace(/<realcost>[\s\S]*?<\/realcost>/gi, '')
    .replace(/<verdict>[\s\S]*?<\/verdict>\n*/gi, '')
    .replace(/<verdict>[\s\S]*/gi, '')           // guard: open tag without close
    .replace(/<\/?tension>/gi, '')
    .replace(/^\s+/, '')
}

// ── Colour palettes — dark (original) + light ─────────────────────────────────
// buildPdf() selects one into a local `const C` and `const PERSONA_ACCENT` at
// the top of the function; every existing C.xxx / PERSONA_ACCENT[key] reference
// below resolves to whichever palette is active via lexical scoping — no other
// lines in the function need to change.

type Palette = {
  gold:         [number, number, number]
  goldDim:      [number, number, number]
  goldText:     [number, number, number]
  pageBg:       [number, number, number]
  headerBg:     [number, number, number]
  briefBg:      [number, number, number]
  synthBg:      [number, number, number]
  decisionBg:   [number, number, number]
  pushbackBg:   [number, number, number]
  bodyText:     [number, number, number]
  mutedText:    [number, number, number]
  dimText:      [number, number, number]
  ruleGold:     [number, number, number]
  ruleMid:      [number, number, number]
  white:        [number, number, number]
  goldLight:    [number, number, number]
  pushbackText: [number, number, number]
  verdictBg:           [number, number, number]
  verdictAccent:       [number, number, number]
  tensionHighlightBg:  [number, number, number]
}

const DARK_PALETTE: Palette = {
  gold:         [201, 168, 76],
  goldDim:      [100, 82,  30],
  goldText:     [201, 168, 76],
  pageBg:       [4,   6,   15],
  headerBg:     [4,   6,   15],
  briefBg:      [8,   18,  8],
  synthBg:      [15,  22,  15],
  decisionBg:   [7,   10,  22],
  pushbackBg:   [7,   12,  24],
  bodyText:     [188, 200, 220],
  mutedText:    [74,  85,  104],
  dimText:      [42,  58,  92],
  ruleGold:     [42,  38,  18],
  ruleMid:      [28,  43,  74],
  white:        [232, 234, 240],
  goldLight:    [180, 148, 60],
  pushbackText: [160, 172, 198],
  verdictBg:           [44, 36, 15],
  verdictAccent:       [222, 184, 96],
  tensionHighlightBg:  [56, 47, 21],
}

// Light palette — warm off-white pages, deep bronze gold, near-black text.
// All tones chosen for print legibility at 300dpi.
const LIGHT_PALETTE: Palette = {
  gold:         [150, 108, 20],   // deep bronze — legible on white
  goldDim:      [200, 172, 110],
  goldText:     [150, 108, 20],
  pageBg:       [250, 248, 243],  // warm off-white
  headerBg:     [250, 248, 243],
  briefBg:      [232, 240, 228],  // light sage wash
  synthBg:      [234, 242, 230],
  decisionBg:   [242, 236, 222],  // light cream wash
  pushbackBg:   [228, 234, 244],
  bodyText:     [40,  38,  34],   // near-black warm
  mutedText:    [120, 114, 104],
  dimText:      [165, 160, 150],
  ruleGold:     [225, 205, 165],
  ruleMid:      [215, 210, 200],
  white:        [30,  28,  24],   // unused in practice; kept for key parity
  goldLight:    [140, 100, 40],   // pushback label
  pushbackText: [55,  65,  90],   // pushback body — readable on light
  verdictBg:           [249, 238, 211],
  verdictAccent:       [150, 108, 20],
  tensionHighlightBg:  [251, 243, 222],
}

// Persona accent backgrounds — dark vs light
const PERSONA_ACCENT_DARK: Record<string, [number, number, number]> = {
  synthesis:         [15,  22,  15],
  contrarian:        [60,  18,  18],
  risk_architect:    [11,  22,  56],
  pattern_analyst:   [11,  32,  22],
  stakeholder_mirror:[28,  12,  46],
  elder:             [38,  24,  8],
  competitor:        [22,  16,  6],
}

const PERSONA_ACCENT_LIGHT: Record<string, [number, number, number]> = {
  synthesis:         [228, 238, 224],
  contrarian:        [250, 224, 220],
  risk_architect:    [220, 230, 248],
  pattern_analyst:   [222, 240, 228],
  stakeholder_mirror:[240, 226, 248],
  elder:             [248, 236, 210],
  competitor:        [242, 240, 216],
}

// ── PDF builder ───────────────────────────────────────────────────────────────
// v3 fixes:
//   A) Always set font BEFORE splitTextToSize — bold font metrics were bleeding
//      into normal-text wrapping, causing text to clip/overflow
//   B) Markdown renderer for Decision Brief — **bold**, *italic*, ---, - bullets,
//      numbered lists, ## headings all parsed and rendered correctly
//   C) Decision block rendered line-by-line (no pre-calc box height)

interface ExaminerQA { question_text: string; response_text: string | null; question_order: number }

async function buildPdf(
  session: { decision_text: string; context_text?: string | null; created_at: string; id: string },
  messages: { persona: string; role: string; content: string }[],
  examinerQAs: ExaminerQA[] = [],
  theme: 'dark' | 'light' = 'dark',
): Promise<Buffer> {
  // ── Theme selection — every C.xxx and PERSONA_ACCENT[key] reference below
  // resolves to the active palette without any other code changes needed.
  const C              = theme === 'light' ? LIGHT_PALETTE      : DARK_PALETTE
  const PERSONA_ACCENT = theme === 'light' ? PERSONA_ACCENT_LIGHT : PERSONA_ACCENT_DARK

  const { jsPDF } = await import('jspdf')

  const doc  = new jsPDF({ unit: 'pt', format: 'a4', putOnlyUsedFonts: true })
  const PW   = doc.internal.pageSize.getWidth()
  const PH   = doc.internal.pageSize.getHeight()
  const ML   = 56
  const MR   = 56
  const TW   = PW - ML - MR
  const BOTTOM_MARGIN = 60
  let   Y    = 0
  let   page = 1

  // ── Page fill (uses C.pageBg — resolves to dark or light depending on theme) ──
  const fillPage = () => {
    doc.setFillColor(...C.pageBg)
    doc.rect(0, 0, PW, PH, 'F')
  }
  fillPage()

  // ── Footer ────────────────────────────────────────────────────────────────────
  const drawFooter = () => {
    doc.setDrawColor(...C.ruleMid)
    doc.setLineWidth(0.3)
    doc.line(ML, PH - 40, PW - MR, PH - 40)
    doc.setFont('Helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...C.mutedText)
    doc.text(`Private \xB7 Quorum`, ML, PH - 26)
    doc.text(String(page), PW - MR, PH - 26, { align: 'right' })
  }

  // ── Page break ────────────────────────────────────────────────────────────────
  const ensure = (needed: number) => {
    if (Y + needed > PH - BOTTOM_MARGIN) {
      doc.addPage()
      fillPage()
      page++
      Y = 52
      drawFooter()
    }
  }

  // ── Body text (prose) ─────────────────────────────────────────────────────────
  // CRITICAL: font must be set BEFORE splitTextToSize — jsPDF uses current font
  // metrics for wrapping. If a bold header was drawn previously, wrapping uses
  // bold metrics but text renders in normal → lines overflow their measured width.
  const bodyBlock = (raw: string, indent = 0, size = 10.5, color = C.bodyText) => {
    const text = sanitise(raw).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const lh   = size * 1.58
    // Split on actual newlines first, then wrap each paragraph
    const paragraphs = text.split('\n')
    for (const para of paragraphs) {
      if (!para.trim()) { Y += lh * 0.4; continue }
      // SET FONT BEFORE SPLIT — fixes metric mismatch bug
      doc.setFont('Helvetica', 'normal')
      doc.setFontSize(size)
      const lines = doc.splitTextToSize(para, TW - indent) as string[]
      for (const line of lines) {
        ensure(lh + 2)
        doc.setFont('Helvetica', 'normal')
        doc.setFontSize(size)
        doc.setTextColor(...color)
        doc.text(line, ML + indent, Y)
        Y += lh
      }
    }
    Y += 5
  }

  // ── Synthesis verdict + tension rendering ──────────────────────────────────
  // Mirrors the live session view (components/SynthesisCard.tsx): the verdict
  // is pulled out into a gold accent box; the tension sentence stays inline in
  // the prose with a highlighted background. Both use theme-aware palette colors.

  const VERDICT_SIZE = 12.5

  // Truncate to first complete sentence — guards against the model writing
  // more than one sentence inside <verdict>, same rule as the web renderer.
  const firstSentencePdf = (text: string): string => {
    const m = text.match(/^[^.!?]*[.!?]/)
    return m ? m[0].trim() : text.trim()
  }

  // Strips verdict (returns it separately) and leaves tension tags intact in
  // `rest` for renderSynthesisBody to locate per-paragraph.
  const parseVerdictTension = (raw: string): { verdict: string | null; rest: string } => {
    const vMatch = raw.match(/<verdict>([\s\S]*?)<\/verdict>/)
    const verdict = vMatch?.[1]?.trim() ? firstSentencePdf(vMatch[1].trim()) : null
    const rest = raw
      .replace(/<verdict>[\s\S]*?<\/verdict>\n*/, '')
      .replace(/<verdict>[\s\S]*/, '')   // guard: open tag without close
      .trimStart()
    return { verdict, rest }
  }

  const renderVerdictBoxPdf = (verdictText: string) => {
    // Layout is computed top-down with explicit baseline math (label baseline,
    // then verdict baseline) instead of a fixed labelGap — the previous fixed
    // gap (13pt) was tuned for the label's old font size and didn't account for
    // VERDICT_SIZE's actual ascent, so the verdict text's cap-height crept up
    // into the "COUNCIL VERDICT" label above it.
    const padTop = 14, padBottom = 14, padX = 16
    const labelSize = 7.5
    const labelToVerdictGap = labelSize * 1.9   // generous clearance below label

    doc.setFont('Helvetica', 'normal')   // verdict sentence is not bold (display weight, not heavy)
    doc.setFontSize(VERDICT_SIZE)
    const wrapped: string[] = doc.splitTextToSize(verdictText, TW - padX * 2) as string[]
    const lh   = VERDICT_SIZE * 1.4
    const boxH = padTop + labelToVerdictGap + (wrapped.length * lh) + padBottom
    ensure(boxH + 14)
    const boxY = Y
    doc.setFillColor(...C.verdictBg)
    doc.rect(ML, boxY, TW, boxH, 'F')
    doc.setFillColor(...C.verdictAccent)
    doc.rect(ML, boxY, 3, boxH, 'F')

    doc.setFont('Helvetica', 'bold')
    doc.setFontSize(labelSize)
    doc.setTextColor(...C.verdictAccent)
    doc.setCharSpace(0.8)
    doc.text('COUNCIL VERDICT', ML + padX, boxY + padTop + labelSize * 0.75)
    doc.setCharSpace(0)

    let ty = boxY + padTop + labelToVerdictGap + VERDICT_SIZE * 0.75
    doc.setFont('Helvetica', 'normal')
    doc.setFontSize(VERDICT_SIZE)
    doc.setTextColor(...C.bodyText)
    for (const wl of wrapped) {
      doc.text(wl, ML + padX, ty)
      ty += lh
    }
    Y = boxY + boxH + 14
  }

  // Renders one paragraph as continuous prose with a highlighted background
  // run behind the [hlStart, hlEnd) character range — used for the sentence
  // wrapped in <tension> tags. Word-level wrap with manual width measurement
  // since jsPDF has no native inline-span styling.
  const renderTensionParagraph = (full: string, hlStart: number, hlEnd: number, size: number, lh: number) => {
    doc.setFont('Helvetica', 'normal')
    doc.setFontSize(size)
    const rawTokens = full.split(/(\s+)/)
    let charPos = 0
    const tokens: { text: string; hl: boolean }[] = []
    for (const t of rawTokens) {
      const start = charPos, end = charPos + t.length
      tokens.push({ text: t, hl: t.trim().length > 0 && start < hlEnd && end > hlStart })
      charPos = end
    }
    const lines: (typeof tokens)[] = []
    let line: typeof tokens = []
    let lineW = 0
    for (const tok of tokens) {
      const w = doc.getTextWidth(tok.text)
      if (lineW + w > TW && line.length > 0) {
        lines.push(line); line = []; lineW = 0
        if (tok.text.trim().length === 0) continue   // drop leading space on wrapped line
      }
      line.push(tok); lineW += w
    }
    if (line.length) lines.push(line)

    for (const ln of lines) {
      ensure(lh + 4)
      // Pass 1 — highlight background runs (contiguous hl tokens share one rect)
      let cx = ML, runStart = -1, runX = ML
      for (let i = 0; i < ln.length; i++) {
        const w = doc.getTextWidth(ln[i].text)
        if (ln[i].hl) {
          if (runStart === -1) { runStart = i; runX = cx }
        } else if (runStart !== -1) {
          doc.setFillColor(...C.tensionHighlightBg)
          doc.rect(runX, Y - size * 0.82, cx - runX, size * 1.12, 'F')
          runStart = -1
        }
        cx += w
      }
      if (runStart !== -1) {
        doc.setFillColor(...C.tensionHighlightBg)
        doc.rect(runX, Y - size * 0.82, cx - runX, size * 1.12, 'F')
      }
      // Pass 2 — text on top
      cx = ML
      doc.setFont('Helvetica', 'normal')
      doc.setFontSize(size)
      doc.setTextColor(...C.bodyText)
      for (const tok of ln) {
        doc.text(tok.text, cx, Y)
        cx += doc.getTextWidth(tok.text)
      }
      Y += lh
    }
  }

  // Synthesis prose body — same paragraph/blank-line handling as bodyBlock,
  // but detects the paragraph containing <tension>...</tension> and routes it
  // through renderTensionParagraph for the inline highlight; all other
  // paragraphs render with the standard wrap.
  const renderSynthesisBody = (raw: string) => {
    const size = 10.5, lh = size * 1.58
    const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    for (const para of text.split('\n')) {
      if (!para.trim()) { Y += lh * 0.4; continue }
      const tStart = para.indexOf('<tension>')
      const tEnd   = para.indexOf('</tension>')
      if (tStart !== -1 && tEnd !== -1 && tEnd > tStart) {
        const before  = para.slice(0, tStart)
        const content = para.slice(tStart + '<tension>'.length, tEnd)
        const after   = para.slice(tEnd + '</tension>'.length)
        const full    = before + content + after
        renderTensionParagraph(full, before.length, before.length + content.length, size, lh)
      } else {
        const cleanPara = para.replace(/<\/?tension>/g, '')
        doc.setFont('Helvetica', 'normal')
        doc.setFontSize(size)
        const wrapped: string[] = doc.splitTextToSize(cleanPara, TW) as string[]
        for (const wl of wrapped) {
          ensure(lh + 2)
          doc.setFont('Helvetica', 'normal')
          doc.setFontSize(size)
          doc.setTextColor(...C.bodyText)
          doc.text(wl, ML, Y)
          Y += lh
        }
      }
    }
    Y += 5
  }


  type Seg = { text: string; bold: boolean; italic: boolean }
  const parseInline = (raw: string): Seg[] => {
    const segs: Seg[] = []
    // Replace **text** and *text* with markers, then split
    const re = /(\*\*(.+?)\*\*|\*(.+?)\*)/g
    let last = 0; let m: RegExpExecArray | null
    while ((m = re.exec(raw)) !== null) {
      if (m.index > last) segs.push({ text: raw.slice(last, m.index), bold: false, italic: false })
      if (m[0].startsWith('**')) segs.push({ text: m[2], bold: true, italic: false })
      else segs.push({ text: m[3], bold: false, italic: true })
      last = m.index + m[0].length
    }
    if (last < raw.length) segs.push({ text: raw.slice(last), bold: false, italic: false })
    return segs.filter(s => s.text)
  }

  const renderSegments = (segs: Seg[], x: number, size: number, color: [number,number,number]) => {
    let cx = x
    for (const seg of segs) {
      const style = seg.bold ? 'bold' : seg.italic ? 'italic' : 'normal'
      doc.setFont('Helvetica', style)
      doc.setFontSize(size)
      doc.setTextColor(...color)
      const w = doc.getTextWidth(sanitise(seg.text))
      doc.text(sanitise(seg.text), cx, Y)
      cx += w
    }
  }

  // ── Markdown renderer (for Decision Brief content) ────────────────────────────
  // Handles: **bold**, *italic*, ---, - bullets, 1. numbered, ## headings
  const renderMarkdown = (raw: string) => {
    const SIZE_BODY    = 10.5
    const SIZE_SMALL   = 9.5
    const SIZE_HEADING = 11.5
    const LH_BODY      = SIZE_BODY * 1.58
    const LH_SMALL     = SIZE_SMALL * 1.55
    const LH_HEAD      = SIZE_HEADING * 1.5

    const text = sanitise(raw).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const lines = text.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()

      // Blank line → small gap
      if (!trimmed) {
        Y += LH_BODY * 0.35
        continue
      }

      // Horizontal rule ---
      if (/^---+$/.test(trimmed)) {
        ensure(16)
        Y += 4
        doc.setDrawColor(...C.ruleGold)
        doc.setLineWidth(0.3)
        doc.line(ML, Y, PW - MR, Y)
        Y += 10
        continue
      }

      // ALL CAPS section label (e.g. KEY INSIGHTS, RISKS, RECOMMENDED DIRECTION)
      // Detect: trimmed line is ≥2 words, all uppercase letters/spaces/punctuation, no lowercase
      const isAllCaps = trimmed.length > 3
        && /^[A-Z][A-Z\s\-–:&/()]{2,}$/.test(trimmed)
        && !/^[-•*\d]/.test(trimmed)
      if (isAllCaps) {
        ensure(LH_HEAD + 10)
        Y += 6
        doc.setFont('Helvetica', 'bold')
        doc.setFontSize(SIZE_HEADING)
        doc.setTextColor(...C.gold)
        doc.setCharSpace(0.8)
        doc.text(trimmed, ML, Y)
        doc.setCharSpace(0)
        // Thin underline
        const labelW = doc.getTextWidth(trimmed)
        doc.setDrawColor(...C.ruleGold)
        doc.setLineWidth(0.4)
        doc.line(ML, Y + 4, ML + labelW, Y + 4)
        Y += LH_HEAD + 2
        continue
      }

      // ## Heading / **Heading** (whole line is bold heading)
      const headingMatch = trimmed.match(/^#{1,3}\s+(.+)$/)
      const boldLineMatch = trimmed.match(/^\*\*([^*]+)\*\*\s*$/)
      if (headingMatch || boldLineMatch) {
        const headText = headingMatch ? headingMatch[1] : boldLineMatch![1]
        ensure(LH_HEAD + 4)
        Y += 3
        doc.setFont('Helvetica', 'bold')
        doc.setFontSize(SIZE_HEADING)
        doc.setTextColor(...C.bodyText)
        const wLines = doc.splitTextToSize(sanitise(headText), TW) as string[]
        for (const wl of wLines) {
          ensure(LH_HEAD)
          doc.setFont('Helvetica', 'bold')
          doc.setFontSize(SIZE_HEADING)
          doc.setTextColor(...C.bodyText)
          doc.text(wl, ML, Y)
          Y += LH_HEAD
        }
        Y += 3
        continue
      }

      // - Bullet item (may contain inline bold/italic)
      const bulletMatch = trimmed.match(/^[-•*]\s+(.+)$/)
      if (bulletMatch) {
        const bulletText = bulletMatch[1]
        const INDENT = 20
        ensure(LH_BODY + 2)
        // Draw bullet dot
        doc.setFont('Helvetica', 'normal')
        doc.setFontSize(SIZE_BODY)
        doc.setFillColor(...C.gold)
        doc.circle(ML + 5, Y - 3.5, 1.5, 'F')
        // Parse inline bold in bullet text
        doc.setFont('Helvetica', 'normal')
        doc.setFontSize(SIZE_BODY)
        const wrapWidth = TW - INDENT
        const segs = parseInline(bulletText)
        // Measure total line in normal font to see if it fits
        const fullText = segs.map(s => sanitise(s.text)).join('')
        doc.setFont('Helvetica', 'normal')
        doc.setFontSize(SIZE_BODY)
        const wLines = doc.splitTextToSize(fullText, wrapWidth) as string[]
        if (wLines.length === 1) {
          // Single line — render inline segments
          renderSegments(segs, ML + INDENT, SIZE_BODY, C.bodyText)
          Y += LH_BODY
        } else {
          // Multi-line bullet — render plain (inline bold too complex to wrap)
          for (const wl of wLines) {
            ensure(LH_SMALL)
            doc.setFont('Helvetica', 'normal')
            doc.setFontSize(SIZE_SMALL)
            doc.setTextColor(...C.bodyText)
            doc.text(wl, ML + INDENT, Y)
            Y += LH_SMALL
          }
        }
        continue
      }

      // 1. Numbered list item
      const numMatch = trimmed.match(/^(\d+)\.\s+(.+)$/)
      if (numMatch) {
        const num = numMatch[1]
        const itemText = numMatch[2]
        const INDENT = 22
        ensure(LH_BODY + 2)
        doc.setFont('Helvetica', 'bold')
        doc.setFontSize(SIZE_BODY)
        doc.setTextColor(...C.gold)
        doc.text(`${num}.`, ML, Y)
        doc.setFont('Helvetica', 'normal')
        doc.setFontSize(SIZE_BODY)
        doc.setTextColor(...C.bodyText)
        const wLines = doc.splitTextToSize(sanitise(itemText), TW - INDENT) as string[]
        for (let j = 0; j < wLines.length; j++) {
          ensure(LH_SMALL)
          doc.setFont('Helvetica', 'normal')
          doc.setFontSize(j === 0 ? SIZE_BODY : SIZE_SMALL)
          doc.setTextColor(...C.bodyText)
          doc.text(wLines[j], ML + INDENT, Y)
          Y += j === 0 ? LH_BODY : LH_SMALL
        }
        continue
      }

      // Regular paragraph (may have inline bold/italic — e.g. **Label:** text)
      const segs = parseInline(trimmed)
      const hasInline = segs.some(s => s.bold || s.italic)

      if (hasInline) {
        // Measure as plain text first to check wrapping
        const fullText = segs.map(s => sanitise(s.text)).join('')
        doc.setFont('Helvetica', 'normal')
        doc.setFontSize(SIZE_BODY)
        const wLines = doc.splitTextToSize(fullText, TW) as string[]
        if (wLines.length === 1) {
          ensure(LH_BODY + 2)
          renderSegments(segs, ML, SIZE_BODY, C.bodyText)
          Y += LH_BODY
        } else {
          // Multi-line inline: render first line with segments, rest as normal
          ensure(LH_BODY + 2)
          // First line: render with inline formatting up to first wrap point
          // Simplification: render the first segment as bold if it ends with ':',
          // then the rest as normal wrapped text
          if (segs[0]?.bold && segs[0].text.trim().endsWith(':')) {
            const labelW = (() => {
              doc.setFont('Helvetica', 'bold')
              doc.setFontSize(SIZE_BODY)
              return doc.getTextWidth(sanitise(segs[0].text))
            })()
            doc.setFont('Helvetica', 'bold')
            doc.setFontSize(SIZE_BODY)
            doc.setTextColor(...C.bodyText)
            doc.text(sanitise(segs[0].text), ML, Y)
            // Wrap the rest after the bold label
            const rest = segs.slice(1).map(s => sanitise(s.text)).join('')
            doc.setFont('Helvetica', 'normal')
            doc.setFontSize(SIZE_SMALL)
            const restLines = doc.splitTextToSize(rest.trim(), TW - labelW - 4) as string[]
            if (restLines[0]) {
              doc.setTextColor(...C.bodyText)
              doc.text(restLines[0], ML + labelW + 4, Y)
            }
            Y += LH_BODY
            for (let k = 1; k < restLines.length; k++) {
              ensure(LH_SMALL)
              doc.setFont('Helvetica', 'normal')
              doc.setFontSize(SIZE_SMALL)
              doc.setTextColor(...C.bodyText)
              doc.text(restLines[k], ML, Y)
              Y += LH_SMALL
            }
          } else {
            // Render all lines as normal text (strip bold markers)
            for (const wl of wLines) {
              ensure(LH_SMALL)
              doc.setFont('Helvetica', 'normal')
              doc.setFontSize(SIZE_SMALL)
              doc.setTextColor(...C.bodyText)
              doc.text(wl, ML, Y)
              Y += LH_SMALL
            }
          }
        }
      } else {
        // Pure plain text paragraph
        doc.setFont('Helvetica', 'normal')
        doc.setFontSize(SIZE_BODY)
        const wLines = doc.splitTextToSize(sanitise(trimmed), TW) as string[]
        for (const wl of wLines) {
          ensure(LH_BODY)
          doc.setFont('Helvetica', 'normal')
          doc.setFontSize(SIZE_BODY)
          doc.setTextColor(...C.bodyText)
          doc.text(wl, ML, Y)
          Y += LH_BODY
        }
      }
      Y += 3
    }
    Y += 4
  }

  // ── Examiner Q&A renderer ────────────────────────────────────────────────────
  const renderExaminerQA = (qas: ExaminerQA[]) => {
    if (!qas.length) return
    ensure(24)
    doc.setFont('Helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...C.gold)
    doc.setCharSpace(1.2)
    doc.text('EXAMINER -- QUESTIONS & ANSWERS', ML, Y)
    doc.setCharSpace(0)
    Y += 8
    doc.setDrawColor(...C.ruleGold)
    doc.setLineWidth(0.3)
    doc.line(ML, Y, PW - MR, Y)
    Y += 14

    const sorted = [...qas].sort((a, b) => a.question_order - b.question_order)
    for (const qa of sorted) {
      const SIZE_Q = 9.5
      const SIZE_A = 9.5
      const LH_Q   = SIZE_Q * 1.5
      const LH_A   = SIZE_A * 1.5
      const qLabel = `Q${qa.question_order}  `

      // Question — gold label + body text
      ensure(LH_Q + 4)
      doc.setFont('Helvetica', 'bold')
      doc.setFontSize(SIZE_Q)
      doc.setTextColor(...C.gold)
      doc.text(qLabel, ML, Y)
      const qLabelW = doc.getTextWidth(qLabel)
      doc.setFont('Helvetica', 'bold')
      doc.setFontSize(SIZE_Q)
      doc.setTextColor(...C.bodyText)
      const qLines = doc.splitTextToSize(sanitise(qa.question_text), TW - qLabelW) as string[]
      for (let qi = 0; qi < qLines.length; qi++) {
        if (qi > 0) ensure(LH_Q)
        doc.setFont('Helvetica', qi === 0 ? 'bold' : 'normal')
        doc.setFontSize(SIZE_Q)
        doc.setTextColor(...C.bodyText)
        doc.text(qLines[qi], qi === 0 ? ML + qLabelW : ML + qLabelW, Y)
        Y += LH_Q
      }
      Y += 4

      // Answer — italicised, indented, muted colour
      const answerText = qa.response_text?.trim() || '(no answer provided)'
      ensure(LH_A + 4)
      doc.setFont('Helvetica', 'italic')
      doc.setFontSize(SIZE_A)
      doc.setTextColor(...C.mutedText)
      const aLines = doc.splitTextToSize(sanitise(answerText), TW - 12) as string[]
      for (const al of aLines) {
        ensure(LH_A)
        doc.setFont('Helvetica', 'italic')
        doc.setFontSize(SIZE_A)
        doc.setTextColor(...C.mutedText)
        doc.text(al, ML + 12, Y)
        Y += LH_A
      }
      Y += 10

      // Thin separator between questions
      doc.setDrawColor(...C.ruleMid)
      doc.setLineWidth(0.2)
      doc.line(ML + 12, Y, PW - MR, Y)
      Y += 8
    }
    Y += 6
  }

  // ── Thin rule ─────────────────────────────────────────────────────────────────
  const rule = (color = C.ruleGold, weight = 0.3) => {
    ensure(16)
    Y += 2
    doc.setDrawColor(...color)
    doc.setLineWidth(weight)
    doc.line(ML, Y, PW - MR, Y)
    Y += 12
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // COVER — full dark page with gold wordmark
  // ═══════════════════════════════════════════════════════════════════════════════

  // Gold top rule — clear of any text, sits at very top
  doc.setDrawColor(...C.gold)
  doc.setLineWidth(1.2)
  doc.line(ML, 22, PW - MR, 22)

  // QUORUM wordmark — baseline at 56, ascender clears 22pt rule with ~18pt of air
  Y = 56
  doc.setFont('Helvetica', 'bold')
  doc.setFontSize(22)
  doc.setTextColor(...C.gold)
  doc.setCharSpace(7)
  doc.text('QUORUM', ML, Y)
  doc.setCharSpace(0)

  // Extend gold rule rightward from end of wordmark to page edge
  const wordW = (() => {
    doc.setFont('Helvetica', 'bold')
    doc.setFontSize(22)
    // approximate: each char ~14pt wide at 22pt with charSpace 7
    return 0
  })()
  Y += 14

  // Subtitle
  doc.setFont('Helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...C.mutedText)
  doc.setCharSpace(2.5)
  doc.text('PRIVATE DECISION INTELLIGENCE', ML, Y)
  doc.setCharSpace(0)
  Y += 14

  // Thin separator rule
  doc.setDrawColor(...C.ruleMid)
  doc.setLineWidth(0.3)
  doc.line(ML, Y, PW - MR, Y)
  Y += 12

  // Date + session ID
  const dateStr = new Date(session.created_at).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata',
  })
  doc.setFont('Helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...C.mutedText)
  doc.text(`${sanitise(dateStr)}  \xB7  Session ${session.id.slice(0, 8).toUpperCase()}`, ML, Y)
  Y += 36  // generous breathing space before THE DECISION label

  drawFooter()

  // ── Decision block (box height computed upfront, then drawn) ────────────────

  // "THE DECISION" eyebrow label
  doc.setFont('Helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...C.mutedText)
  doc.setCharSpace(1.5)
  doc.text('THE DECISION', ML, Y)
  doc.setCharSpace(0)
  Y += 14  // clear gap between label and box top

  const decText = sanitise(session.decision_text)
  const decSize = 10.5
  const decLH   = decSize * 1.58
  const decPadTop = 11, decPadBottom = 11, decPadX = 14
  doc.setFont('Helvetica', 'normal')
  doc.setFontSize(decSize)
  const decLines = doc.splitTextToSize(decText, TW - decPadX * 2) as string[]
  const decBoxH  = decPadTop + (decLines.length * decLH) + decPadBottom
  ensure(decBoxH + 10)

  const decBoxTop = Y
  doc.setFillColor(...C.decisionBg)
  doc.rect(ML, decBoxTop, TW, decBoxH, 'F')
  doc.setFillColor(...C.gold)
  doc.rect(ML, decBoxTop, 3, decBoxH, 'F')

  let decTy = decBoxTop + decPadTop + decSize * 0.75
  doc.setFont('Helvetica', 'normal')
  doc.setFontSize(decSize)
  doc.setTextColor(...C.bodyText)
  for (const dl of decLines) {
    doc.text(dl, ML + decPadX, decTy)
    decTy += decLH
  }
  Y = decBoxTop + decBoxH + 6

  if (session.context_text?.trim()) {
    ensure(20)
    doc.setFont('Helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...C.mutedText)
    doc.setCharSpace(0.8)
    doc.text('CONTEXT', ML, Y)
    doc.setCharSpace(0)
    Y += 10
    bodyBlock(session.context_text, 0, 9.5, C.mutedText)
  }

  Y += 14

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 0 — Examiner Q&A (before Decision Brief, if answers exist)
  // ═══════════════════════════════════════════════════════════════════════════════

  if (examinerQAs.length > 0) {
    doc.addPage()
    fillPage()
    page++
    Y = 52
    drawFooter()
    renderExaminerQA(examinerQAs)
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 1 — Decision Brief
  // ═══════════════════════════════════════════════════════════════════════════════

  // Deduplicate: if synthesis (or any persona) was re-run multiple times,
  // multiple initial assistant messages exist. Keep only the LAST initial assistant
  // per persona (before any user/pushback message), then all pushback exchanges.
  const rawByPersona: Record<string, Array<{ role: string; content: string }>> = {}
  for (const msg of messages) {
    if (!rawByPersona[msg.persona]) rawByPersona[msg.persona] = []
    rawByPersona[msg.persona].push({ role: msg.role, content: msg.content })
  }
  const byPersona: Record<string, Array<{ role: string; content: string }>> = {}
  for (const [key, msgs] of Object.entries(rawByPersona)) {
    const firstUserIdx = msgs.findIndex(m => m.role === 'user')
    const initialBlock = firstUserIdx === -1 ? msgs : msgs.slice(0, firstUserIdx)
    const exchanges    = firstUserIdx === -1 ? []   : msgs.slice(firstUserIdx)
    const latestInitial = initialBlock.filter(m => m.role === 'assistant').slice(-1)
    byPersona[key] = [...latestInitial, ...exchanges]
  }

  const briefMsgs = byPersona['decision_brief']
  if (briefMsgs && briefMsgs.length > 0) {
    // Always start the Decision Brief on its own page — never inline after the cover
    doc.addPage()
    fillPage()
    page++
    Y = ML
    drawFooter()

    const bandH = 44
    doc.setFillColor(...C.briefBg)
    doc.rect(0, Y, PW, bandH, 'F')
    doc.setDrawColor(...C.gold)
    doc.setLineWidth(1)
    doc.line(0, Y, PW, Y)
    doc.setFillColor(...C.gold)
    doc.rect(0, Y, 4, bandH, 'F')

    doc.setFont('Helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(...C.gold)
    doc.setCharSpace(2)
    doc.text('DECISION BRIEF', ML, Y + 18)
    doc.setCharSpace(0)

    doc.setFont('Helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...C.mutedText)
    doc.text('Prepared by Quorum Council  \xB7  Confidential', ML, Y + 33)

    Y += bandH + 16

    for (const msg of briefMsgs) {
      if (msg.role === 'user') {
        ensure(32)
        doc.setFont('Helvetica', 'bold')
        doc.setFontSize(7.5)
        doc.setTextColor(...C.goldLight)
        doc.setCharSpace(0.8)
        doc.text('YOUR PUSHBACK', ML, Y)
        doc.setCharSpace(0)
        Y += 12
        bodyBlock(cleanPushbackText(msg.content), 4, 9.5, C.pushbackText)
      } else {
        // Strip any redundant "DECISION BRIEF" / "THE DECISION BRIEF" first line
        // the AI sometimes echoes it back; we already render it in the header band
        const cleaned = msg.content
          .replace(/^\s*\*{0,2}(THE\s+)?DECISION BRIEF\*{0,2}\s*\n?/i, '')
          .replace(/^\s*#{1,3}\s*(THE\s+)?DECISION BRIEF\s*\n?/i, '')
          .trimStart()
        renderMarkdown(cleaned)
      }
    }

    Y += 10
    rule(C.goldDim, 0.5)
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 2 — Appendix
  // ═══════════════════════════════════════════════════════════════════════════════

  const hasAppendix = APPENDIX_ORDER.some(k => byPersona[k]?.length > 0)
  if (hasAppendix) {
    // Appendix divider — new dark page, centred
    doc.addPage()
    fillPage()
    page++
    drawFooter()

    const midY = PH / 2 - 20
    doc.setDrawColor(...C.ruleMid)
    doc.setLineWidth(0.4)
    doc.line(ML, midY, PW - MR, midY)

    doc.setFont('Helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...C.mutedText)
    doc.setCharSpace(3)
    doc.text('APPENDIX', ML, midY + 18)
    doc.setCharSpace(0)

    doc.setFont('Helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...C.dimText)
    doc.text('Full Council Analysis  \xB7  Synthesis  \xB7  Advisor Responses', ML, midY + 32)

    doc.setDrawColor(...C.ruleMid)
    doc.setLineWidth(0.4)
    doc.line(ML, midY + 44, PW - MR, midY + 44)

    // ── Appendix: Examiner Q&A page ──────────────────────────────────────────
    if (examinerQAs.length > 0) {
      doc.addPage()
      fillPage()
      page++
      Y = 52
      drawFooter()

      doc.setFont('Helvetica', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(...C.gold)
      doc.setCharSpace(2)
      doc.text('EXAMINER', ML, Y)
      doc.setCharSpace(0)
      doc.setFont('Helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...C.mutedText)
      doc.text('Questions posed and answers provided before the Council ran', ML, Y + 14)
      Y += 30

      doc.setDrawColor(...C.ruleGold)
      doc.setLineWidth(0.3)
      doc.line(ML, Y, PW - MR, Y)
      Y += 16

      renderExaminerQA(examinerQAs)
    }

    // ── One page per appendix persona ─────────────────────────────────────────
    for (const key of APPENDIX_ORDER) {
      const msgs = byPersona[key]
      if (!msgs || msgs.length === 0) continue

      const persona     = PERSONAS[key as PersonaKey]
      const accentRgb   = PERSONA_ACCENT[key] ?? [11, 16, 32]
      const isSynthesis = key === 'synthesis'

      doc.addPage()
      fillPage()
      page++
      Y = ML
      drawFooter()

      // Guard: if less than 120pt left, start a fresh page for this persona
      if (Y + 120 > PH - BOTTOM_MARGIN) {
        doc.addPage(); fillPage(); page++; Y = ML; drawFooter()
      }

      // Persona header band — height now has enough bottom margin under the
      // tagline baseline so the colored band background fully covers both
      // lines of text (previously the tagline's descenders sat right at, or
      // past, the band's bottom edge, making the fill look like it "cut off"
      // before the text ended).
      const hBg  = isSynthesis ? C.synthBg : accentRgb
      const hH   = isSynthesis ? 30 : 26
      doc.setFillColor(...hBg)
      doc.rect(0, Y - 4, PW, hH, 'F')
      doc.setDrawColor(...C.gold)
      doc.setLineWidth(isSynthesis ? 1.5 : 0.6)
      doc.line(0, Y - 4, PW, Y - 4)

      doc.setFont('Helvetica', 'bold')
      doc.setFontSize(isSynthesis ? 13 : 11)
      doc.setTextColor(...C.gold)
      doc.text(sanitise(persona.label.toUpperCase()), ML, Y + 7)

      doc.setFont('Helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...C.mutedText)
      doc.text(sanitise(persona.tagline ?? ''), ML, Y + 17)

      Y += hH + 6

      // Gold rule — drawn AFTER Y is past the header band
      doc.setDrawColor(...C.ruleGold)
      doc.setLineWidth(0.3)
      doc.line(ML, Y, PW - MR, Y)
      Y += 12

      for (const msg of msgs) {
        if (msg.role === 'user') {
          ensure(28)
          Y += 4
          doc.setFont('Helvetica', 'bold')
          doc.setFontSize(7.5)
          doc.setTextColor(...C.goldLight)
          doc.setCharSpace(0.8)
          doc.text('YOUR PUSHBACK', ML, Y)
          doc.setCharSpace(0)
          Y += 10
          bodyBlock(cleanPushbackText(msg.content), 0, 9.5, C.pushbackText)
        } else if (isSynthesis) {
          const { verdict, rest } = parseVerdictTension(msg.content)
          if (verdict) renderVerdictBoxPdf(verdict)
          renderSynthesisBody(rest)
        } else {
          bodyBlock(stripAdvisorTags(msg.content))
        }
      }
    }
  }

  // ── Closing line ──────────────────────────────────────────────────────────────
  ensure(28)
  Y += 6
  doc.setFont('Helvetica', 'italic')
  doc.setFontSize(8.5)
  doc.setTextColor(...C.dimText)
  const closingText = sanitise('This record is private. The views expressed represent structured analysis, not professional advice.')
  const closingLines = doc.splitTextToSize(closingText, TW) as string[]
  for (const line of closingLines) { doc.text(line, ML, Y); Y += 13 }

  return Buffer.from(doc.output('arraybuffer'))
}


// ── Route handler ─────────────────────────────────────────────────────────────

interface Params { params: Promise<{ id: string }> }

export async function GET(req: Request, { params }: Params) {
  const { id }  = await params
  const url     = new URL(req.url)
  const theme   = url.searchParams.get('theme') === 'light' ? 'light' : 'dark'

  // ── Token gate removed (Sprint: Brief freemium) ───────────────────────────
  // Brief is now free for all users. BRIEF_ACCESS_TOKEN env var is no longer
  // checked here. The /api/brief-access route can be decommissioned separately.

  const supabase = createServiceClient()

  const [sessionResult, messagesResult, examinerResult] = await Promise.all([
    supabase.from('sessions').select('*').eq('id', id).single(),
    supabase
      .from('messages')
      .select('persona, role, content, created_at')
      .eq('session_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('examiner_responses')
      .select('question_text, response_text, question_order')
      .eq('session_id', id)
      .order('question_order', { ascending: true }),
  ])

  if (sessionResult.error || !sessionResult.data) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  // Decrypt raw user input fields before any use (AI prompt, PDF rendering)
  const session = {
    ...sessionResult.data,
    decision_text: decrypt(sessionResult.data.decision_text) ?? '',
    context_text:  decrypt(sessionResult.data.context_text)  ?? null,
  }
  let messages = (messagesResult.data ?? []).map(m => ({
    ...m,
    content: decrypt(m.content) ?? '',
  }))

  // ── Auto-generate Decision Brief if not yet created ─────────────────────────
  const hasBrief = messages.some(m => m.persona === 'decision_brief' && m.role === 'assistant')
  if (!hasBrief) {
    // Build context string from all existing persona assistant messages
    const personaContext = APPENDIX_ORDER
      .map(key => {
        const persona = PERSONAS[key as PersonaKey]
        const msgs = messages.filter(m => m.persona === key && m.role === 'assistant')
        if (!msgs.length) return null
        return `=== ${persona.label.toUpperCase()} ===\n${msgs.map(m => m.content).join('\n')}`
      })
      .filter(Boolean)
      .join('\n\n')

    if (personaContext) {
      const briefPrompt = `${DECISION_BRIEF}

THE DECISION:
${session.decision_text}

COUNCIL ANALYSIS:
${personaContext}

Generate the Decision Brief now.`

      try {
        const briefContent = await createCompletion(briefPrompt, 1200, { provider: 'deepseek' })
        if (briefContent) {
          // Save encrypted to DB
          await supabase.from('messages').insert({
            session_id: id,
            persona: 'decision_brief',
            role: 'assistant',
            content: encrypt(briefContent),
          })
          // Use plaintext in-memory for this request
          messages = [...messages, {
            persona: 'decision_brief',
            role: 'assistant',
            content: briefContent,
            created_at: new Date().toISOString(),
          }]
        }
      } catch (err) {
        console.error('[brief/route] Auto-generation error:', err)
        // Continue — PDF will still render without brief section
      }
    }
  }

  const examinerQAs = (examinerResult.data ?? []).map(r => ({
    question_text:  decrypt(r.question_text)  ?? '',
    response_text:  decrypt(r.response_text)  ?? null,
    question_order: r.question_order,
  }))

  let pdfBuffer: Buffer
  try {
    pdfBuffer = await buildPdf(session, messages, examinerQAs, theme)
  } catch (err) {
    console.error('[brief/route] PDF build error:', err)
    return NextResponse.json({ error: 'PDF generation failed' }, { status: 500 })
  }

  const filename = `quorum-brief-${id.slice(0, 8)}.pdf`

  return new Response(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      String(pdfBuffer.byteLength),
      'Cache-Control':       'no-store',
    },
  })
}
