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

  // ── Body text renderer ────────────────────────────────────────────────────────
  const bodyBlock = (raw: string, indent = 0, size = 10.5, color = C.bodyText) => {
    const text  = sanitise(raw)
    const lh    = size * 1.62
    const lines = doc.splitTextToSize(text, TW - indent) as string[]
    for (const line of lines) {
      ensure(lh)
      doc.setFont('Helvetica', 'normal')
      doc.setFontSize(size)
      doc.setTextColor(...color)
      doc.text(line, ML + indent, Y)
      Y += lh
    }
    Y += 4
  }

  // ── Thin rule ─────────────────────────────────────────────────────────────────
  const rule = (color = C.ruleGold, weight = 0.3) => {
    ensure(8)
    doc.setDrawColor(...color)
    doc.setLineWidth(weight)
    doc.line(ML, Y, PW - MR, Y)
    Y += 14
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

  // ── Decision block ────────────────────────────────────────────────────────────
  doc.setFont('Helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...C.mutedText)
  doc.setCharSpace(1)
  doc.text('THE DECISION', ML, Y)
  doc.setCharSpace(0)
  Y += 11

  const decText  = sanitise(session.decision_text)
  doc.setFontSize(10.5)
  const decLines = doc.splitTextToSize(decText, TW - 20) as string[]
  const decLH    = 10.5 * 1.62
  const decBoxH  = decLines.length * decLH + 22

  ensure(decBoxH + 8)
  doc.setFillColor(...C.decisionBg)
  doc.rect(ML, Y, TW, decBoxH, 'F')
  doc.setFillColor(...C.gold)
  doc.rect(ML, Y, 3, decBoxH, 'F')

  doc.setFont('Helvetica', 'normal')
  doc.setFontSize(10.5)
  doc.setTextColor(...C.bodyText)
  decLines.forEach((line, i) => { doc.text(line, ML + 14, Y + 14 + i * decLH) })
  Y += decBoxH + 10

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
        doc.setFillColor(...C.pushbackBg)
        doc.setFont('Helvetica', 'bold')
        doc.setFontSize(7.5)
        doc.setTextColor(...C.mutedText)
        doc.setCharSpace(0.8)
        doc.text('YOUR PUSHBACK', ML, Y)
        doc.setCharSpace(0)
        Y += 10
        bodyBlock(msg.content, 4, 9.5, C.mutedText)
      } else {
        bodyBlock(msg.content)
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

      // Persona header band
      const hBg = isSynthesis ? C.synthBg : accentRgb
      doc.setFillColor(...hBg)
      doc.rect(0, Y - 4, PW, isSynthesis ? 24 : 20, 'F')
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
      doc.text(sanitise(persona.tagline ?? ''), ML, isSynthesis ? Y + 18 : Y + 16)

      Y += isSynthesis ? 30 : 26

      // Thin gold divider under header
      doc.setDrawColor(...C.ruleGold)
      doc.setLineWidth(0.3)
      doc.line(ML, Y, PW - MR, Y)
      Y += 10

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
