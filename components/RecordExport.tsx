'use client'

import { useState } from 'react'
import type { DecisionRecord } from '@/lib/types'
import { PERSONAS }    from '@/lib/personas'
import { formatLongDate } from '@/lib/dates'

export interface ExaminerQA {
  question_text: string
  response_text: string | null
  question_order: number
}

interface Props {
  record: DecisionRecord
  examinerResponses?: ExaminerQA[]
}

// ── Segment type for inline bold rendering ─────────────────────
type Segment = { text: string; bold: boolean }

// Parse a line into plain + bold segments  (**word** → bold)
function parseInline(line: string): Segment[] {
  const segments: Segment[] = []
  const regex = /\*\*(.+?)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = regex.exec(line)) !== null) {
    if (m.index > last) segments.push({ text: line.slice(last, m.index), bold: false })
    segments.push({ text: m[1], bold: true })
    last = regex.lastIndex
  }
  if (last < line.length) segments.push({ text: line.slice(last), bold: false })
  return segments.length ? segments : [{ text: line, bold: false }]
}

// Strip markdown for plain-text contexts
// Strip verdict/tension/persona tags that should never appear in the PDF.
// Verdict is removed entirely (it's a UI-only gold box on the session page).
// Tension wrapper tags are stripped; the sentence text is kept inline.
function stripSynthesisTags(raw: string): string {
  return raw
    .replace(/<verdict>[\s\S]*?<\/verdict>\n*/g, '')
    .replace(/<verdict>[\s\S]*/g, '')     // guard: open tag without close
    .replace(/<\/?tension>/g, '')
    .replace(/<lens>[\s\S]*?<\/lens>/g, '')
    .replace(/<position>[\s\S]*?<\/position>/g, '')
    .replace(/<realcost>[\s\S]*?<\/realcost>/g, '')
    .replace(/<lean>[\s\S]*?<\/lean>/g, '')
    .replace(/<(?:lens|position|realcost|lean)>[\s\S]*$/, '') // guard: open tag without close
    .replace(/<\/?(?:proceed|wait|mixed)>\s*/gi, '')          // guard: stray malformed lean-value tag (see PersonaPanel.tsx)
    .replace(/^\s+/, '')
}

function stripMd(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/^[-*]\s+/gm, '• ')
    .replace(/`(.+?)`/g, '$1')
    .trim()
}

// Is this line a standalone section header:  **Header**  or  **Header**:
function extractHeader(line: string): string | null {
  const m = line.match(/^\*\*(.+?)\*\*:?\s*$/)
  return m ? m[1] : null
}

export default function RecordExport({ record, examinerResponses = [] }: Props) {
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    setExporting(true)
    try {
      const { jsPDF } = await import('jspdf')
      const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })

      const pageW = doc.internal.pageSize.getWidth()   // 210
      const pageH = doc.internal.pageSize.getHeight()  // 297
      const ML = 18   // left margin
      const MR = 18   // right margin
      const CW = pageW - ML - MR  // content width ~174mm
      let y = ML

      const checkBreak = (needed: number) => {
        if (y + needed > pageH - MR) { doc.addPage(); y = ML }
      }

      // ── Helpers ──────────────────────────────────────────────

      // Render a single wrapped line with inline bold segments
      const renderLine = (
        rawLine: string,
        opts: { size: number; colorR: number; colorG: number; colorB: number; indent?: number }
      ) => {
        const { size, colorR, colorG, colorB, indent = 0 } = opts
        const xStart = ML + indent
        const lineW  = CW - indent

        // Split into wrapped words using splitTextToSize on plain text
        const plain = stripMd(rawLine)
        const wrapped: string[] = doc.setFontSize(size).splitTextToSize(plain, lineW) as string[]

        for (const wLine of wrapped) {
          checkBreak(size * 0.4)
          doc.setFontSize(size)
          doc.setTextColor(colorR, colorG, colorB)

          // Try to render with inline bold if original had **marks**
          if (rawLine.includes('**')) {
            // We render the plain version (jsPDF doesn't support inline styles natively)
            // Bold segments: if the whole wrapped line came from a bold region, render bold
            const segs = parseInline(rawLine)
            const isAllBold = segs.every(s => s.bold)
            doc.setFont('helvetica', isAllBold ? 'bold' : 'normal')
          } else {
            doc.setFont('helvetica', 'normal')
          }

          doc.text(wLine, xStart, y)
          y += size * 0.42
        }
      }

      // Render a full persona response, parsing markdown properly
      const renderContent = (content: string, baseSize: number) => {
        const lines = content.split('\n')

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trimEnd()

          // Skip empty lines — add small vertical space
          if (!line.trim()) { y += baseSize * 0.25; continue }

          // Horizontal rule  ---
          if (/^---+$/.test(line.trim())) {
            checkBreak(4)
            doc.setDrawColor(26, 38, 69)
            doc.setLineWidth(0.3)
            doc.line(ML, y, ML + CW, y)
            y += 3
            continue
          }

          // Standalone section header:  **Header**  or  **Header**:
          const header = extractHeader(line.trim())
          if (header) {
            checkBreak(baseSize * 0.7)
            y += baseSize * 0.18  // small gap before header
            doc.setFont('helvetica', 'bold')
            doc.setFontSize(baseSize + 0.5)
            doc.setTextColor(212, 168, 67)  // gold
            const hLines: string[] = doc.splitTextToSize(header, CW) as string[]
            for (const hl of hLines) {
              checkBreak(baseSize * 0.5)
              doc.text(hl, ML, y)
              y += (baseSize + 0.5) * 0.42
            }
            y += baseSize * 0.1
            continue
          }

          // Bullet list item: starts with - , * , or •
          if (/^[-*•]\s+/.test(line.trim())) {
            const bulletText = line.trim().replace(/^[-*•]\s+/, '')
            const cleanText = stripMd(bulletText)
            checkBreak(baseSize * 0.45)
            doc.setFont('helvetica', 'normal')
            doc.setFontSize(baseSize)
            doc.setTextColor(180, 188, 212)
            const bulletLines: string[] = doc.splitTextToSize(cleanText, CW - 5) as string[]
            for (let bi = 0; bi < bulletLines.length; bi++) {
              checkBreak(baseSize * 0.42)
              if (bi === 0) doc.text('•', ML, y)
              doc.text(bulletLines[bi], ML + 4, y)
              y += baseSize * 0.42
            }
            continue
          }

          // Normal paragraph line — strip markdown, render with appropriate weight
          const hasInlineBold = line.includes('**')
          const cleanLine = stripMd(line)

          doc.setFontSize(baseSize)
          doc.setTextColor(195, 205, 220)

          if (hasInlineBold) {
            // Check if first segment is bold (paragraph starts with bold label like "**Execution risk**:")
            const segs = parseInline(line)
            const firstIsBold = segs[0]?.bold

            if (firstIsBold && segs.length > 1) {
              // Render first bold part, then rest normal
              const boldPart  = segs.filter(s => s.bold).map(s => s.text).join(' ')
              const normalPart = segs.filter(s => !s.bold).map(s => s.text).join('').replace(/^:\s*/, ': ')
              const fullLine   = `${boldPart}: ${normalPart.trimStart()}`
              const wrapped: string[] = doc.splitTextToSize(fullLine, CW) as string[]
              for (let wi = 0; wi < wrapped.length; wi++) {
                checkBreak(baseSize * 0.42)
                // Bold the first wrapped line (contains the label)
                doc.setFont('helvetica', wi === 0 ? 'bold' : 'normal')
                doc.setTextColor(wi === 0 ? 220 : 195, wi === 0 ? 210 : 205, wi === 0 ? 230 : 220)
                doc.text(wrapped[wi], ML, y)
                y += baseSize * 0.42
              }
              continue
            }
          }

          // Plain text
          doc.setFont('helvetica', 'normal')
          const wrapped: string[] = doc.splitTextToSize(cleanLine, CW) as string[]
          for (const wl of wrapped) {
            checkBreak(baseSize * 0.42)
            doc.text(wl, ML, y)
            y += baseSize * 0.42
          }
        }
      }

      // ── Cover page ────────────────────────────────────────────
      doc.setFillColor(4, 6, 15)
      doc.rect(0, 0, pageW, pageH, 'F')

      // Gold top rule
      doc.setDrawColor(201, 168, 76)
      doc.setLineWidth(0.8)
      doc.line(ML, y + 3, pageW - MR, y + 3)
      y += 10

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(22)
      doc.setTextColor(201, 168, 76)
      doc.text('QUORUM', ML, y + 8)
      y += 14

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(74, 85, 104)
      doc.text('PRIVATE DECISION INTELLIGENCE', ML, y)
      y += 5

      doc.setDrawColor(28, 43, 74)
      doc.setLineWidth(0.4)
      doc.line(ML, y, pageW - MR, y)
      y += 9

      // Date + session ID
      const dateStr = formatLongDate(record.session.created_at)
      doc.setFontSize(8)
      doc.setTextColor(74, 85, 104)
      doc.text(`${dateStr}  ·  Session ${record.session.id.slice(0, 8)}`, ML, y)
      y += 10

      // Decision label
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(232, 234, 240)
      doc.text('THE DECISION', ML, y)
      y += 7

      // Decision text
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(176, 188, 212)
      const decLines: string[] = doc.splitTextToSize(record.session.decision_text, CW) as string[]
      for (const dl of decLines) {
        checkBreak(5)
        doc.text(dl, ML, y)
        y += 5
      }
      y += 6

      // Context block
      if (record.session.context_text) {
        checkBreak(16)
        doc.setDrawColor(28, 43, 74)
        doc.setLineWidth(0.3)
        doc.line(ML, y, ML, y + 10)
        doc.setFont('helvetica', 'italic')
        doc.setFontSize(8.5)
        doc.setTextColor(74, 85, 104)
        const ctxLines: string[] = doc.splitTextToSize(record.session.context_text, CW - 4) as string[]
        const shown = ctxLines.slice(0, 8)
        for (const cl of shown) {
          checkBreak(4.5)
          doc.text(cl, ML + 3, y)
          y += 4.5
        }
        if (ctxLines.length > 8) {
          doc.text(`… (${ctxLines.length - 8} more lines)`, ML + 3, y)
          y += 4.5
        }
        y += 5
      }

      // ── Group messages by persona, deduplicating re-runs ────────
      // If synthesis was re-run multiple times, multiple initial assistant messages exist.
      // Keep only the LAST initial assistant per persona, then all pushback exchanges.
      // This mirrors the deduplication logic in the record page.
      const rawByPersona: Record<string, { role: string; content: string }[]> = {}
      for (const msg of record.messages) {
        if (!rawByPersona[msg.persona]) rawByPersona[msg.persona] = []
        rawByPersona[msg.persona].push({ role: msg.role, content: msg.content })
      }
      const byPersona: Record<string, { assistant: string[]; user: string[] }> = {}
      for (const [key, msgs] of Object.entries(rawByPersona)) {
        const firstUserIdx = msgs.findIndex(m => m.role === 'user')
        const initialBlock = firstUserIdx === -1 ? msgs : msgs.slice(0, firstUserIdx)
        const exchanges    = firstUserIdx === -1 ? []   : msgs.slice(firstUserIdx)
        // Of potentially multiple initial assistant rows, keep only the last
        const latestInitial = initialBlock.filter(m => m.role === 'assistant').slice(-1)
        const dedupedMsgs = [...latestInitial, ...exchanges]
        byPersona[key] = { assistant: [], user: [] }
        for (const msg of dedupedMsgs) {
          byPersona[key][msg.role as 'assistant' | 'user'].push(msg.content)
        }
      }

      // ── EXAMINER Q&A helper ──────────────────────────────────────
      const renderExaminerQA = (qas: ExaminerQA[]) => {
        if (!qas.length) return
        checkBreak(14)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(9)
        doc.setTextColor(201, 168, 76)
        doc.text('FOLLOW-UP QUESTIONS & ANSWERS', ML, y)
        y += 6
        doc.setDrawColor(42, 38, 18)
        doc.setLineWidth(0.3)
        doc.line(ML, y, ML + CW, y)
        y += 5

        for (const qa of qas.sort((a, b) => a.question_order - b.question_order)) {
          checkBreak(16)
          // Question
          doc.setFont('helvetica', 'bold')
          doc.setFontSize(8.5)
          doc.setTextColor(180, 188, 212)
          const qLines: string[] = doc.splitTextToSize(`Q${qa.question_order}  ${qa.question_text}`, CW) as string[]
          for (const ql of qLines) { checkBreak(4); doc.text(ql, ML, y); y += 4 }
          y += 2
          // Answer
          doc.setFont('helvetica', 'italic')
          doc.setFontSize(8.5)
          doc.setTextColor(120, 130, 155)
          const answerText = qa.response_text?.trim() || '(skipped)'
          const aLines: string[] = doc.splitTextToSize(answerText, CW - 4) as string[]
          for (const al of aLines) { checkBreak(4); doc.text(al, ML + 4, y); y += 4 }
          y += 4
        }
        y += 4
      }

      // ── SECTION 0: Examiner Q&A (brief main page) ───────────────
      if (examinerResponses.length > 0) {
        doc.addPage()
        doc.setFillColor(4, 6, 15)
        doc.rect(0, 0, pageW, pageH, 'F')
        y = ML
        renderExaminerQA(examinerResponses)
      }

      // ── SECTION 1: Decision Brief (main document body) ─────────
      const briefMsgs = byPersona['decision_brief']
      if (briefMsgs && briefMsgs.assistant.length > 0) {
        doc.addPage()
        doc.setFillColor(4, 6, 15)
        doc.rect(0, 0, pageW, pageH, 'F')
        y = ML

        // Premium brief header
        doc.setFillColor(8, 18, 8)
        doc.rect(0, y - 4, pageW, 30, 'F')
        doc.setDrawColor(201, 168, 76)
        doc.setLineWidth(1.0)
        doc.line(ML, y - 4, pageW - MR, y - 4)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(18)
        doc.setTextColor(201, 168, 76)
        doc.text('DECISION BRIEF', ML, y + 9)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8)
        doc.setTextColor(74, 85, 104)
        doc.text('Prepared by Quorum Council  ·  Confidential', ML, y + 18)
        y += 34

        doc.setDrawColor(42, 38, 18)
        doc.setLineWidth(0.3)
        doc.line(ML, y, ML + CW, y)
        y += 6

        for (let i = 0; i < briefMsgs.assistant.length; i++) {
          if (i > 0 && briefMsgs.user[i - 1]) {
            checkBreak(12)
            y += 3
            doc.setFillColor(7, 12, 24)
            doc.rect(ML - 1, y - 2, CW + 2, 10, 'F')
            doc.setFont('helvetica', 'italic')
            doc.setFontSize(8)
            doc.setTextColor(74, 85, 104)
            const pbLines: string[] = doc.splitTextToSize(`Your pushback: ${briefMsgs.user[i - 1]}`, CW - 2) as string[]
            doc.text(pbLines.slice(0, 2), ML + 1, y + 2)
            y += 12
          }
          renderContent(stripSynthesisTags(briefMsgs.assistant[i]), 9.5)
          y += 3
        }
      }

      // ── SECTION 2: Appendix divider page ──────────────────────
      const appendixPersonaOrder = [
        'synthesis',
        'contrarian', 'risk_architect', 'pattern_analyst',
        'stakeholder_mirror', 'elder', 'competitor',
      ]
      const hasAppendix = appendixPersonaOrder.some(k => byPersona[k]?.assistant.length > 0)

      if (hasAppendix) {
        doc.addPage()
        doc.setFillColor(4, 6, 15)
        doc.rect(0, 0, pageW, pageH, 'F')
        y = pageH / 2 - 20

        doc.setDrawColor(28, 43, 74)
        doc.setLineWidth(0.4)
        doc.line(ML, y - 6, pageW - MR, y - 6)

        doc.setFont('helvetica', 'bold')
        doc.setFontSize(11)
        doc.setTextColor(74, 85, 104)
        doc.text('APPENDIX', ML, y + 2)

        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8)
        doc.setTextColor(42, 58, 92)
        doc.text('Full Council Analysis  ·  Council Synthesis  ·  Advisor Responses', ML, y + 10)

        doc.setLineWidth(0.4)
        doc.line(ML, y + 16, pageW - MR, y + 16)

        // ── Appendix: Examiner Q&A page ───────────────────────
        if (examinerResponses.length > 0) {
          doc.addPage()
          doc.setFillColor(4, 6, 15)
          doc.rect(0, 0, pageW, pageH, 'F')
          y = ML
          renderExaminerQA(examinerResponses)
        }

        // ── Appendix persona pages ─────────────────────────────
        for (const key of appendixPersonaOrder) {
          const msgs = byPersona[key]
          if (!msgs || msgs.assistant.length === 0) continue
          const persona = PERSONAS[key as keyof typeof PERSONAS]

          doc.addPage()
          doc.setFillColor(4, 6, 15)
          doc.rect(0, 0, pageW, pageH, 'F')
          y = ML

          const isSynthesis = key === 'synthesis'

          doc.setFillColor(isSynthesis ? 15 : 11, isSynthesis ? 22 : 16, isSynthesis ? 15 : 32)
          doc.rect(0, y - 2, pageW, 18, 'F')
          doc.setDrawColor(201, 168, 76)
          doc.setLineWidth(isSynthesis ? 1.5 : 0.5)
          doc.line(0, y - 2, pageW, y - 2)
          doc.setFont('helvetica', 'bold')
          doc.setFontSize(isSynthesis ? 14 : 12)
          doc.setTextColor(201, 168, 76)
          doc.text(persona.label.toUpperCase(), ML, y + 7)
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(8)
          doc.setTextColor(74, 85, 104)
          doc.text(persona.tagline, ML, y + 13)
          y += 22

          doc.setDrawColor(42, 38, 18)
          doc.setLineWidth(0.3)
          doc.line(ML, y, ML + CW, y)
          y += 5

          for (let i = 0; i < msgs.assistant.length; i++) {
            if (i > 0 && msgs.user[i - 1]) {
              checkBreak(12)
              y += 3
              doc.setFillColor(7, 12, 24)
              doc.rect(ML - 1, y - 2, CW + 2, 10, 'F')
              doc.setFont('helvetica', 'italic')
              doc.setFontSize(8)
              doc.setTextColor(74, 85, 104)
              const pbText = `Your pushback: ${msgs.user[i - 1]}`
              const pbLines: string[] = doc.splitTextToSize(pbText, CW - 2) as string[]
              doc.text(pbLines.slice(0, 2), ML + 1, y + 2)
              y += 12
            }
            // Bug fix: previously only synthesis content was stripped here
            // (isSynthesis ? stripSynthesisTags(...) : raw). Advisor content was
            // rendered completely raw — <lens>/<position>/<realcost>/<lean> tags leaked
            // into the PDF appendix whenever the model emitted them, since nothing
            // upstream strips advisor content before DB storage either. stripSynthesisTags
            // is a safe superset for both cases (verdict/tension are no-ops on advisor text).
            renderContent(stripSynthesisTags(msgs.assistant[i]), 9.5)
            y += 3
          }
        }
      }

      // ── Final footer ──────────────────────────────────────────
      checkBreak(12)
      doc.setDrawColor(28, 43, 74)
      doc.setLineWidth(0.3)
      doc.line(ML, y, ML + CW, y)
      y += 5
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(42, 58, 92)
      doc.text('Generated by Quorum — Private Decision Intelligence', ML, y)
      doc.text(dateStr, pageW - MR, y, { align: 'right' })

      const filename = `quorum-record-${record.session.id.slice(0, 8)}.pdf`
      doc.save(filename)
    } catch (err) {
      console.error('PDF export error:', err)
      alert('PDF export failed. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <button
      className="btn-primary"
      onClick={handleExport}
      disabled={exporting}
      style={{ fontSize: '13px', padding: '10px 24px' }}
    >
      {exporting ? 'Generating PDF…' : 'Export Decision Record (PDF)'}
    </button>
  )
}
