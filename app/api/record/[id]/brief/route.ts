// app/api/record/[id]/brief/route.ts
// ── Sprint 8: Decision Brief PDF ─────────────────────────────────────────────
//
// GET /api/record/[id]/brief?token=<BRIEF_ACCESS_TOKEN>
//
// Token validated against BRIEF_ACCESS_TOKEN env var (same pattern as Mirror).
// Returns a formatted PDF via jsPDF — already in package.json (v2.5.2).
//
// Dynamic import used so jsPDF initialises after module load,
// avoiding "window is not defined" in Next.js server context.
//
// PDF structure:
//   Header  → QUORUM wordmark, date, session ref
//   Block   → decision text + optional context
//   Sections→ each persona: label, tagline, analysis, pushbacks
//   Footer  → page number + "Private · Quorum" on every page
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { PERSONAS }            from '@/lib/personas'
import type { PersonaKey }     from '@/lib/types'

// ── Persona render order ──────────────────────────────────────────────────────

const PERSONA_ORDER: PersonaKey[] = [
  'synthesis',
  'contrarian',
  'risk_architect',
  'pattern_analyst',
  'stakeholder_mirror',
  'elder',
  'competitor',
]

// ── Colour palette ────────────────────────────────────────────────────────────

const GOLD:  [number, number, number] = [180, 145, 60]
const BLACK: [number, number, number] = [10,  10,  12]
const INK:   [number, number, number] = [30,  30,  36]
const MID:   [number, number, number] = [80,  80,  90]
const DIM:   [number, number, number] = [130, 130, 140]
const FAINT: [number, number, number] = [220, 220, 225]

// ── PDF builder ───────────────────────────────────────────────────────────────

async function buildPdf(
  session: { decision_text: string; context_text?: string | null; created_at: string; id: string },
  messages: { persona: string; role: string; content: string }[],
): Promise<Buffer> {
  // Dynamic import — defers jsPDF initialisation until after module load,
  // preventing "window is not defined" in Next.js server environment.
  const { jsPDF } = await import('jspdf')

  const doc  = new jsPDF({ unit: 'pt', format: 'a4', putOnlyUsedFonts: true })
  const PW   = doc.internal.pageSize.getWidth()   // 595pt
  const PH   = doc.internal.pageSize.getHeight()  // 842pt
  const ML   = 52
  const MR   = 52
  const TW   = PW - ML - MR                       // 491pt
  let   Y    = 0
  let   pageNum = 1

  // ── Footer drawn on current page ──────────────────────────────────────────
  const drawFooter = () => {
    doc.setDrawColor(...FAINT)
    doc.setLineWidth(0.5)
    doc.line(ML, PH - 42, PW - MR, PH - 42)
    doc.setFont('Helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...DIM)
    doc.text('Private · Quorum', ML, PH - 28)
    doc.text(String(pageNum), PW - MR, PH - 28, { align: 'right' })
  }

  // ── Auto page-break guard ─────────────────────────────────────────────────
  const ensure = (needed: number) => {
    if (Y + needed > PH - 70) {
      doc.addPage()
      pageNum++
      Y = 56
      drawFooter()
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE 1 HEADER
  // ═══════════════════════════════════════════════════════════════════════════

  doc.setFillColor(...BLACK)
  doc.rect(0, 0, PW, 88, 'F')

  // Wordmark
  doc.setFont('Helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(...GOLD)
  doc.setCharSpace(4)
  doc.text('QUORUM', ML, 38)
  doc.setCharSpace(0)

  doc.setFont('Helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...DIM)
  doc.text('Decision Intelligence · Private Record', ML, 54)

  // Date + session ref
  const dateStr = new Date(session.created_at).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
  doc.setFontSize(8)
  doc.setTextColor(...DIM)
  doc.text(dateStr, PW - MR, 38, { align: 'right' })
  doc.text(`Session ${session.id.slice(0, 8).toUpperCase()}`, PW - MR, 52, { align: 'right' })

  // Gold rule below header
  doc.setDrawColor(...GOLD)
  doc.setLineWidth(0.75)
  doc.line(ML, 88, PW - MR, 88)

  Y = 112
  drawFooter()

  // ═══════════════════════════════════════════════════════════════════════════
  // DECISION BLOCK
  // ═══════════════════════════════════════════════════════════════════════════

  doc.setFont('Helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...MID)
  doc.setCharSpace(1.5)
  doc.text('THE DECISION', ML, Y)
  doc.setCharSpace(0)
  Y += 14

  const decLines  = doc.splitTextToSize(session.decision_text, TW - 28) as string[]
  const decBlockH = decLines.length * (11.5 * 1.55) + 28

  ensure(decBlockH + 20)
  doc.setFillColor(248, 248, 249)
  doc.setDrawColor(...FAINT)
  doc.setLineWidth(0.5)
  doc.roundedRect(ML, Y, TW, decBlockH, 4, 4, 'FD')

  doc.setFont('Helvetica', 'normal')
  doc.setFontSize(11.5)
  doc.setTextColor(...INK)
  decLines.forEach((line, i) => {
    doc.text(line, ML + 14, Y + 18 + i * (11.5 * 1.55))
  })
  Y += decBlockH + 10

  // Context (optional)
  if (session.context_text?.trim()) {
    ensure(30)
    doc.setFont('Helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...MID)
    doc.text('Context:', ML, Y)
    Y += 13

    const ctxLines = doc.splitTextToSize(session.context_text, TW) as string[]
    doc.setFont('Helvetica', 'italic')
    doc.setFontSize(9.5)
    doc.setTextColor(...MID)
    ctxLines.forEach(line => {
      ensure(14)
      doc.text(line, ML, Y)
      Y += 14
    })
    Y += 4
  }

  Y += 24

  // ═══════════════════════════════════════════════════════════════════════════
  // PERSONA SECTIONS
  // ═══════════════════════════════════════════════════════════════════════════

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

    ensure(60)

    // Header bar
    const barH = 32
    if (isSynthesis) {
      doc.setFillColor(18, 40, 22)
    } else {
      doc.setFillColor(245, 245, 247)
    }
    doc.setDrawColor(...FAINT)
    doc.setLineWidth(0.4)
    doc.roundedRect(ML, Y, TW, barH, 3, 3, 'FD')

    // Gold left accent on Synthesis
    if (isSynthesis) {
      doc.setFillColor(...GOLD)
      doc.rect(ML, Y, 3, barH, 'F')
    }

    // Persona label
    doc.setFont('Helvetica', 'bold')
    doc.setFontSize(isSynthesis ? 10.5 : 9.5)
    if (isSynthesis) {
      doc.setTextColor(...GOLD)
    } else {
      doc.setTextColor(...INK)
    }
    doc.text(persona.label, ML + 12, Y + 13)

    // Tagline
    doc.setFont('Helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...MID)
    doc.text(persona.tagline ?? '', ML + 12, Y + 25)

    Y += barH + 12

    // Messages
    for (const msg of msgs) {
      if (msg.role === 'user') {
        // Pushback — indented grey box
        ensure(36)
        doc.setFont('Helvetica', 'italic')
        doc.setFontSize(8.5)
        doc.setTextColor(...MID)
        doc.text('Your pushback:', ML + 16, Y)
        Y += 11

        const pbLines = doc.splitTextToSize(msg.content, TW - 36) as string[]
        const pbH     = pbLines.length * (9 * 1.45) + 16

        ensure(pbH)
        doc.setFillColor(240, 240, 243)
        doc.setDrawColor(...FAINT)
        doc.setLineWidth(0.4)
        doc.roundedRect(ML + 16, Y, TW - 32, pbH, 2, 2, 'FD')

        doc.setFont('Helvetica', 'normal')
        doc.setFontSize(9)
        doc.setTextColor(...MID)
        pbLines.forEach((line, i) => {
          doc.text(line, ML + 26, Y + 10 + i * (9 * 1.45))
        })
        Y += pbH + 8

      } else {
        // Advisor analysis body text
        const bodyLines = doc.splitTextToSize(msg.content, TW - 16) as string[]
        const lh        = 10.5 * 1.58

        doc.setFont('Helvetica', 'normal')
        doc.setFontSize(10.5)
        doc.setTextColor(...INK)

        for (const line of bodyLines) {
          ensure(lh)
          doc.text(line, ML + 8, Y)
          Y += lh
        }
        Y += 4
      }
    }

    // Section divider
    Y += 10
    ensure(6)
    doc.setDrawColor(...FAINT)
    doc.setLineWidth(0.4)
    doc.line(ML, Y, PW - MR, Y)
    Y += 22
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLOSING NOTE
  // ═══════════════════════════════════════════════════════════════════════════

  ensure(40)
  Y += 4
  doc.setFont('Helvetica', 'italic')
  doc.setFontSize(9)
  doc.setTextColor(...DIM)
  const closing = 'This record is private. The views expressed represent structured analysis, not professional advice.'
  const closingLines = doc.splitTextToSize(closing, TW) as string[]
  closingLines.forEach(line => {
    doc.text(line, ML, Y)
    Y += 9 * 1.5
  })

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

  return new Response(pdfBuffer, {
    status: 200,
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      String(pdfBuffer.byteLength),
      'Cache-Control':       'no-store',
    },
  })
}
