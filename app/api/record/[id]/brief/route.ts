// app/api/record/[id]/brief/route.ts
// ── Sprint 8: Decision Brief PDF (v2) ────────────────────────────────────────
//
// Fixes vs v1:
//   1. Unicode sanitiser — replaces Rs./₹ and all non-Latin-1 chars before
//      passing to jsPDF (Latin-1 encoding; anything outside it renders as garbage)
//   2. Line-by-line rendering throughout — no pre-calculated box heights that
//      go wrong when text wraps more than estimated
//   3. Premium light layout — white background, charcoal ink, gold accents only
//      at structural points (header rule, synthesis bar accent)
//   4. Dynamic import — avoids "window is not defined" in Next.js server context
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { PERSONAS }            from '@/lib/personas'
import type { PersonaKey }     from '@/lib/types'

const PERSONA_ORDER: PersonaKey[] = [
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

// ── Colour palette (light theme) ──────────────────────────────────────────────
const C = {
  gold:        [160, 125, 45]  as [number, number, number],
  goldLight:   [210, 180, 100] as [number, number, number],
  black:       [18,  18,  20]  as [number, number, number],
  charcoal:    [36,  36,  42]  as [number, number, number],
  bodyText:    [45,  45,  52]  as [number, number, number],
  midGrey:     [90,  90,  100] as [number, number, number],
  mutedGrey:   [140, 140, 150] as [number, number, number],
  ruleGrey:    [210, 210, 215] as [number, number, number],
  bgDecision:  [248, 247, 244] as [number, number, number],
  bgPushback:  [243, 243, 246] as [number, number, number],
  bgSynthesis: [245, 248, 245] as [number, number, number],
  bgHeader:    [24,  24,  28]  as [number, number, number],
  white:       [255, 255, 255] as [number, number, number],
}

// ── PDF builder ───────────────────────────────────────────────────────────────

async function buildPdf(
  session: { decision_text: string; context_text?: string | null; created_at: string; id: string },
  messages: { persona: string; role: string; content: string }[],
): Promise<Buffer> {
  const { jsPDF } = await import('jspdf')

  const doc  = new jsPDF({ unit: 'pt', format: 'a4', putOnlyUsedFonts: true })
  const PW   = doc.internal.pageSize.getWidth()    // 595.28 pt
  const PH   = doc.internal.pageSize.getHeight()   // 841.89 pt
  const ML   = 56   // left margin
  const MR   = 56   // right margin
  const TW   = PW - ML - MR                        // 483.28 pt
  const BOTTOM_MARGIN = 66
  let   Y    = 0
  let   page = 1

  // ── White page background (default) ──────────────────────────────────────────
  const fillPageWhite = () => {
    doc.setFillColor(...C.white)
    doc.rect(0, 0, PW, PH, 'F')
  }
  fillPageWhite()

  // ── Footer ────────────────────────────────────────────────────────────────────
  const drawFooter = () => {
    doc.setDrawColor(...C.ruleGrey)
    doc.setLineWidth(0.4)
    doc.line(ML, PH - 44, PW - MR, PH - 44)
    doc.setFont('Helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...C.mutedGrey)
    doc.text('Private · Quorum', ML, PH - 30)
    doc.text(String(page), PW - MR, PH - 30, { align: 'right' })
  }

  // ── Page break guard ──────────────────────────────────────────────────────────
  const ensure = (needed: number) => {
    if (Y + needed > PH - BOTTOM_MARGIN) {
      doc.addPage()
      fillPageWhite()
      page++
      Y = 52
      drawFooter()
    }
  }

  // ── Paragraph renderer — splits and renders line by line ──────────────────────
  // Returns total height consumed (for callers that need to advance Y themselves).
  const para = (
    raw: string,
    x: number,
    opts: {
      size?:      number
      style?:     'normal' | 'bold' | 'italic' | 'bolditalic'
      color?:     [number, number, number]
      maxWidth?:  number
      leading?:   number   // multiplier on font size
      indent?:    number   // additional left offset inside x
    } = {},
  ): number => {
    const {
      size     = 10.5,
      style    = 'normal',
      color    = C.bodyText,
      maxWidth = TW,
      leading  = 1.58,
      indent   = 0,
    } = opts
    const text  = sanitise(raw)
    const lh    = size * leading
    const lines = doc.splitTextToSize(text, maxWidth - indent) as string[]
    for (const line of lines) {
      ensure(lh)
      // Re-apply after ensure() — page breaks reset jsPDF graphics state
      doc.setFont('Helvetica', style)
      doc.setFontSize(size)
      doc.setTextColor(...color)
      doc.text(line, x + indent, Y)
      Y += lh
    }
    return lines.length * lh
  }

  // ── Small label (caps) ────────────────────────────────────────────────────────
  const label = (text: string, x: number) => {
    doc.setFont('Helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...C.mutedGrey)
    doc.setCharSpace(1.2)
    doc.text(text.toUpperCase(), x, Y)
    doc.setCharSpace(0)
    Y += 14
  }

  // ── Horizontal rule ───────────────────────────────────────────────────────────
  const rule = (color: [number, number, number] = C.ruleGrey, weight = 0.4) => {
    ensure(8)
    doc.setDrawColor(...color)
    doc.setLineWidth(weight)
    doc.line(ML, Y, PW - MR, Y)
    Y += 16
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // HEADER (dark bar, first page only)
  // ═══════════════════════════════════════════════════════════════════════════════

  doc.setFillColor(...C.bgHeader)
  doc.rect(0, 0, PW, 80, 'F')

  // Wordmark
  doc.setFont('Helvetica', 'bold')
  doc.setFontSize(15)
  doc.setTextColor(...C.gold)
  doc.setCharSpace(5)
  doc.text('QUORUM', ML, 34)
  doc.setCharSpace(0)

  // Sub-tagline
  doc.setFont('Helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...C.mutedGrey)
  doc.text('Decision Intelligence', ML, 50)

  // Date + session ref — right side
  const dateStr = new Date(session.created_at).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
  doc.setFontSize(8)
  doc.setTextColor(...C.mutedGrey)
  doc.text(sanitise(dateStr), PW - MR, 34, { align: 'right' })
  doc.text(`Session ${session.id.slice(0, 8).toUpperCase()}`, PW - MR, 50, { align: 'right' })

  // Gold rule below header
  doc.setDrawColor(...C.gold)
  doc.setLineWidth(1)
  doc.line(0, 80, PW, 80)

  Y = 100
  drawFooter()

  // ═══════════════════════════════════════════════════════════════════════════════
  // DECISION BLOCK
  // ═══════════════════════════════════════════════════════════════════════════════

  label('The Decision', ML)

  // Light tinted box — render line by line so height is always correct
  // We need the box to wrap the text. Measure first, draw box, then text.
  const decText   = sanitise(session.decision_text)
  doc.setFontSize(11)
  const decLines  = doc.splitTextToSize(decText, TW - 28) as string[]
  const decLH     = 11 * 1.6
  const decBoxH   = decLines.length * decLH + 24

  ensure(decBoxH + 8)
  doc.setFillColor(...C.bgDecision)
  doc.setDrawColor(...C.ruleGrey)
  doc.setLineWidth(0.4)
  doc.roundedRect(ML, Y, TW, decBoxH, 4, 4, 'FD')

  // Left gold accent bar
  doc.setFillColor(...C.gold)
  doc.rect(ML, Y, 3, decBoxH, 'F')

  doc.setFont('Helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(...C.charcoal)
  decLines.forEach((line, i) => {
    doc.text(line, ML + 16, Y + 16 + i * decLH)
  })
  Y += decBoxH + 8

  // Context (optional)
  if (session.context_text?.trim()) {
    ensure(20)
    doc.setFont('Helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...C.mutedGrey)
    doc.setCharSpace(0.8)
    doc.text('CONTEXT', ML, Y)
    doc.setCharSpace(0)
    Y += 12
    para(session.context_text, ML, { size: 9.5, color: C.midGrey, style: 'italic', maxWidth: TW - 20 })
  }

  Y += 22

  // ═══════════════════════════════════════════════════════════════════════════════
  // PERSONA SECTIONS
  // ═══════════════════════════════════════════════════════════════════════════════

  const byPersona: Record<string, Array<{ role: string; content: string }>> = {}
  for (const msg of messages) {
    if (!byPersona[msg.persona]) byPersona[msg.persona] = []
    byPersona[msg.persona].push({ role: msg.role, content: msg.content })
  }

  for (const key of PERSONA_ORDER) {
    const msgs = byPersona[key]
    if (!msgs || msgs.length === 0) continue

    const persona     = PERSONAS[key as PersonaKey]
    const isSynthesis = key === 'synthesis'

    ensure(70)

    // ── Section header ──────────────────────────────────────────────────────────

    if (isSynthesis) {
      // Synthesis: tinted green bar with left gold accent
      const barH = 36
      doc.setFillColor(...C.bgSynthesis)
      doc.setDrawColor(...C.ruleGrey)
      doc.setLineWidth(0.4)
      doc.roundedRect(ML, Y, TW, barH, 3, 3, 'FD')
      doc.setFillColor(...C.gold)
      doc.rect(ML, Y, 3, barH, 'F')

      doc.setFont('Helvetica', 'bold')
      doc.setFontSize(10.5)
      doc.setTextColor(...C.charcoal)
      doc.text(sanitise(persona.label), ML + 14, Y + 14)

      doc.setFont('Helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...C.midGrey)
      doc.text(sanitise(persona.tagline ?? ''), ML + 14, Y + 27)

      Y += barH + 14
    } else {
      // All other personas: label in charcoal, tagline in grey, thin rule below
      doc.setFont('Helvetica', 'bold')
      doc.setFontSize(10)
      doc.setTextColor(...C.charcoal)
      doc.text(sanitise(persona.label), ML, Y)
      Y += 13

      doc.setFont('Helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...C.mutedGrey)
      doc.text(sanitise(persona.tagline ?? ''), ML, Y)
      Y += 11

      doc.setDrawColor(...C.goldLight)
      doc.setLineWidth(0.6)
      doc.line(ML, Y, ML + 140, Y)
      Y += 12
    }

    // ── Messages ────────────────────────────────────────────────────────────────

    for (const msg of msgs) {
      if (msg.role === 'user') {
        // Pushback box
        ensure(32)

        doc.setFont('Helvetica', 'bold')
        doc.setFontSize(7.5)
        doc.setTextColor(...C.mutedGrey)
        doc.setCharSpace(0.8)
        doc.text('YOUR PUSHBACK', ML + 14, Y)
        doc.setCharSpace(0)
        Y += 11

        // Measure height first so we can draw the box
        const pbText  = sanitise(msg.content)
        doc.setFontSize(9.5)
        const pbLines = doc.splitTextToSize(pbText, TW - 36) as string[]
        const pbLH    = 9.5 * 1.55
        const pbBoxH  = pbLines.length * pbLH + 18

        ensure(pbBoxH)
        doc.setFillColor(...C.bgPushback)
        doc.setDrawColor(...C.ruleGrey)
        doc.setLineWidth(0.4)
        doc.roundedRect(ML + 14, Y, TW - 14, pbBoxH, 2, 2, 'FD')

        let pbTextY = Y + 12
        for (const pbLine of pbLines) {
          // Re-apply after ensure() — page breaks reset jsPDF graphics state
          doc.setFont('Helvetica', 'italic')
          doc.setFontSize(9.5)
          doc.setTextColor(...C.midGrey)
          doc.text(pbLine, ML + 24, pbTextY)
          pbTextY += pbLH
        }
        Y += pbBoxH + 10

      } else {
        // Main advisor text — line by line
        const bodyText = sanitise(msg.content)
        doc.setFontSize(10.5)
        const bodyLines = doc.splitTextToSize(bodyText, TW - 8) as string[]
        const bodyLH    = 10.5 * 1.62

        for (const line of bodyLines) {
          ensure(bodyLH)
          // Re-apply after ensure() — page breaks reset jsPDF graphics state
          doc.setFont('Helvetica', 'normal')
          doc.setFontSize(10.5)
          doc.setTextColor(...C.bodyText)
          doc.text(line, ML + 4, Y)
          Y += bodyLH
        }
        Y += 4
      }
    }

    // Section divider
    Y += 12
    rule()
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // CLOSING
  // ═══════════════════════════════════════════════════════════════════════════════

  ensure(28)
  Y += 2
  para(
    'This record is private. The views expressed represent structured analysis, not professional advice.',
    ML,
    { size: 8.5, color: C.mutedGrey, style: 'italic' },
  )

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
  const messages = messagesResult.data ?? []

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
