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

// ── Colour palette (dark premium theme) ───────────────────────────────────────
const C = {
  gold:        [201, 168, 76]  as [number, number, number],
  goldDim:     [100, 82,  30]  as [number, number, number],
  goldText:    [201, 168, 76]  as [number, number, number],
  pageBg:      [4,   6,   15]  as [number, number, number],
  headerBg:    [4,   6,   15]  as [number, number, number],
  briefBg:     [8,   18,  8]   as [number, number, number],
  synthBg:     [15,  22,  15]  as [number, number, number],
  decisionBg:  [7,   10,  22]  as [number, number, number],
  pushbackBg:  [7,   12,  24]  as [number, number, number],
  bodyText:    [188, 200, 220] as [number, number, number],
  mutedText:   [74,  85,  104] as [number, number, number],
  dimText:     [42,  58,  92]  as [number, number, number],
  ruleGold:    [42,  38,  18]  as [number, number, number],
  ruleMid:     [28,  43,  74]  as [number, number, number],
  white:       [232, 234, 240] as [number, number, number],
}

// Persona accent colours (rgb)
const PERSONA_ACCENT: Record<string, [number, number, number]> = {
  synthesis:         [15,  22,  15],
  contrarian:        [60,  18,  18],
  risk_architect:    [11,  22,  56],
  pattern_analyst:   [11,  32,  22],
  stakeholder_mirror:[28,  12,  46],
  elder:             [38,  24,  8],
  competitor:        [22,  16,  6],
}

// ── PDF builder ───────────────────────────────────────────────────────────────
// v3 fixes:
//   A) Always set font BEFORE splitTextToSize — bold font metrics were bleeding
//      into normal-text wrapping, causing text to clip/overflow
//   B) Markdown renderer for Decision Brief — **bold**, *italic*, ---, - bullets,
//      numbered lists, ## headings all parsed and rendered correctly
//   C) Decision block rendered line-by-line (no pre-calc box height)

async function buildPdf(
  session: { decision_text: string; context_text?: string | null; created_at: string; id: string },
  messages: { persona: string; role: string; content: string }[],
): Promise<Buffer> {
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

  // ── Dark page fill ────────────────────────────────────────────────────────────
  const fillPageDark = () => {
    doc.setFillColor(...C.pageBg)
    doc.rect(0, 0, PW, PH, 'F')
  }
  fillPageDark()

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
      fillPageDark()
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

  // ── Inline segment renderer (for markdown bold/italic within a line) ──────────
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

  // Gold top rule
  doc.setDrawColor(...C.gold)
  doc.setLineWidth(0.8)
  doc.line(ML, 28, PW - MR, 28)
  Y = 38

  // Wordmark
  doc.setFont('Helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(...C.gold)
  doc.setCharSpace(6)
  doc.text('QUORUM', ML, Y)
  doc.setCharSpace(0)
  Y += 15

  // Subtitle
  doc.setFont('Helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...C.mutedText)
  doc.setCharSpace(1.5)
  doc.text('PRIVATE DECISION INTELLIGENCE', ML, Y)
  doc.setCharSpace(0)
  Y += 6

  // Thin mid rule
  doc.setDrawColor(...C.ruleMid)
  doc.setLineWidth(0.3)
  doc.line(ML, Y, PW - MR, Y)
  Y += 10

  // Date + session ID
  const dateStr = new Date(session.created_at).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
  doc.setFont('Helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...C.mutedText)
  doc.text(`${sanitise(dateStr)}  \xB7  Session ${session.id.slice(0, 8).toUpperCase()}`, ML, Y)
  Y += 14

  drawFooter()

  // ── Decision block (line-by-line, no pre-calc box height) ───────────────────
  doc.setFont('Helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...C.mutedText)
  doc.setCharSpace(1)
  doc.text('THE DECISION', ML, Y)
  doc.setCharSpace(0)
  Y += 12

  const decText = sanitise(session.decision_text)
  const decSize = 10.5
  const decLH   = decSize * 1.58
  // Set font BEFORE split
  doc.setFont('Helvetica', 'normal')
  doc.setFontSize(decSize)
  const decLines = doc.splitTextToSize(decText, TW - 18) as string[]
  const decStartY = Y

  for (const dl of decLines) {
    ensure(decLH + 2)
    // Draw bg rect for this line (left-to-right fill per line)
    doc.setFillColor(...C.decisionBg)
    doc.rect(ML, Y - decLH + 3, TW, decLH + 1, 'F')
    doc.setFont('Helvetica', 'normal')
    doc.setFontSize(decSize)
    doc.setTextColor(...C.bodyText)
    doc.text(dl, ML + 14, Y)
    Y += decLH
  }
  // Close the box with a bottom pad
  doc.setFillColor(...C.decisionBg)
  doc.rect(ML, Y, TW, 6, 'F')
  Y += 6
  // Gold left accent bar (drawn after, over the bg)
  const decEndY = Y
  doc.setFillColor(...C.gold)
  doc.rect(ML, decStartY - decLH + 3, 3, decEndY - decStartY + decLH - 3, 'F')

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
  // SECTION 1 — Decision Brief
  // ═══════════════════════════════════════════════════════════════════════════════

  const byPersona: Record<string, Array<{ role: string; content: string }>> = {}
  for (const msg of messages) {
    if (!byPersona[msg.persona]) byPersona[msg.persona] = []
    byPersona[msg.persona].push({ role: msg.role, content: msg.content })
  }

  const briefMsgs = byPersona['decision_brief']
  if (briefMsgs && briefMsgs.length > 0) {
    // Full-width dark green header band
    ensure(52)
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
        doc.setTextColor(...C.mutedText)
        doc.setCharSpace(0.8)
        doc.text('YOUR PUSHBACK', ML, Y)
        doc.setCharSpace(0)
        Y += 12
        bodyBlock(msg.content, 4, 9.5, C.mutedText)
      } else {
        renderMarkdown(msg.content)
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
    fillPageDark()
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

    // ── One page per appendix persona ─────────────────────────────────────────
    for (const key of APPENDIX_ORDER) {
      const msgs = byPersona[key]
      if (!msgs || msgs.length === 0) continue

      const persona     = PERSONAS[key as PersonaKey]
      const accentRgb   = PERSONA_ACCENT[key] ?? [11, 16, 32]
      const isSynthesis = key === 'synthesis'

      doc.addPage()
      fillPageDark()
      page++
      Y = ML
      drawFooter()

      // Guard: if less than 120pt left, start a fresh page for this persona
      if (Y + 120 > PH - BOTTOM_MARGIN) {
        doc.addPage(); fillPageDark(); page++; Y = ML; drawFooter()
      }

      // Persona header band
      const hBg  = isSynthesis ? C.synthBg : accentRgb
      const hH   = isSynthesis ? 26 : 22
      doc.setFillColor(...hBg)
      doc.rect(0, Y - 4, PW, hH, 'F')
      doc.setDrawColor(...C.gold)
      doc.setLineWidth(isSynthesis ? 1.5 : 0.6)
      doc.line(0, Y - 4, PW, Y - 4)

      doc.setFont('Helvetica', 'bold')
      doc.setFontSize(isSynthesis ? 13 : 11)
      doc.setTextColor(...C.gold)
      doc.text(sanitise(persona.label.toUpperCase()), ML, Y + 8)

      doc.setFont('Helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...C.mutedText)
      doc.text(sanitise(persona.tagline ?? ''), ML, Y + 18)

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
          doc.setFillColor(...C.pushbackBg)
          doc.setFont('Helvetica', 'bold')
          doc.setFontSize(7.5)
          doc.setTextColor(...C.mutedText)
          doc.setCharSpace(0.8)
          doc.text('YOUR PUSHBACK', ML, Y)
          doc.setCharSpace(0)
          Y += 10
          bodyBlock(msg.content, 0, 9.5, C.mutedText)
        } else {
          bodyBlock(msg.content)
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
  const { id }     = await params
  const token      = new URL(req.url).searchParams.get('token') ?? ''
  const validToken = process.env.BRIEF_ACCESS_TOKEN

  if (validToken && token !== validToken) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 403 })
  }

  const supabase = createServiceClient()

  const [sessionResult, messagesResult] = await Promise.all([
    supabase.from('sessions').select('*').eq('id', id).single(),
    supabase
      .from('messages')
      .select('persona, role, content, created_at')
      .eq('session_id', id)
      .order('created_at', { ascending: true }),
  ])

  if (sessionResult.error || !sessionResult.data) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const session  = sessionResult.data
  let messages = messagesResult.data ?? []

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
        const briefContent = await createCompletion(briefPrompt, 1200)
        if (briefContent) {
          // Save to DB so it appears on the record page too
          await supabase.from('messages').insert({
            session_id: id,
            persona: 'decision_brief',
            role: 'assistant',
            content: briefContent,
          })
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

  let pdfBuffer: Buffer
  try {
    pdfBuffer = await buildPdf(session, messages)
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
