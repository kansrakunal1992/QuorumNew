'use client'

import { useState } from 'react'
import type { DecisionRecord } from '@/lib/types'
import { PERSONAS } from '@/lib/personas'

interface Props {
  record: DecisionRecord
}

export default function RecordExport({ record }: Props) {
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    setExporting(true)
    try {
      // Dynamic import to avoid SSR issues
      const { jsPDF } = await import('jspdf')
      const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })

      const pageW = doc.internal.pageSize.getWidth()
      const pageH = doc.internal.pageSize.getHeight()
      const margin = 18
      const contentW = pageW - margin * 2
      let y = margin

      const addPage = () => {
        doc.addPage()
        y = margin
      }

      const checkPageBreak = (needed: number) => {
        if (y + needed > pageH - margin) addPage()
      }

      // ── Cover header ───────────────────────────────────────
      doc.setFillColor(4, 6, 15)
      doc.rect(0, 0, pageW, pageH, 'F')

      // Gold rule
      doc.setDrawColor(212, 168, 67)
      doc.setLineWidth(0.5)
      doc.line(margin, y + 4, pageW - margin, y + 4)
      y += 8

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(20)
      doc.setTextColor(212, 168, 67)
      doc.text('QUORUM', margin, y + 8)
      y += 12

      doc.setFontSize(8)
      doc.setTextColor(74, 85, 104)
      doc.setFont('helvetica', 'normal')
      doc.text('DECISION RECORD', margin, y)
      y += 6

      doc.setDrawColor(26, 38, 69)
      doc.line(margin, y, pageW - margin, y)
      y += 8

      // Date
      const dateStr = new Date(record.session.created_at).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
      doc.setFontSize(8)
      doc.setTextColor(74, 85, 104)
      doc.text(dateStr, margin, y)
      y += 10

      // Decision text
      doc.setFontSize(12)
      doc.setTextColor(232, 234, 240)
      doc.setFont('helvetica', 'bold')
      doc.text('The Decision', margin, y)
      y += 6

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9.5)
      doc.setTextColor(136, 146, 164)
      const decisionLines = doc.splitTextToSize(record.session.decision_text, contentW)
      checkPageBreak(decisionLines.length * 5 + 10)
      doc.text(decisionLines, margin, y)
      y += decisionLines.length * 5 + 8

      if (record.session.context_text) {
        checkPageBreak(20)
        doc.setFontSize(8)
        doc.setTextColor(42, 58, 92)
        doc.text('Context provided:', margin, y)
        y += 5
        doc.setTextColor(74, 85, 104)
        const ctxLines = doc.splitTextToSize(record.session.context_text, contentW)
        const ctxH = Math.min(ctxLines.length, 6) * 4.5
        checkPageBreak(ctxH)
        doc.text(ctxLines.slice(0, 6), margin, y)
        y += ctxH + 6
      }

      // ── Persona sections ───────────────────────────────────
      // Group messages by persona
      const personaMessages: Record<string, { assistant: string[]; user: string[] }> = {}
      for (const msg of record.messages) {
        if (!personaMessages[msg.persona]) {
          personaMessages[msg.persona] = { assistant: [], user: [] }
        }
        personaMessages[msg.persona][msg.role].push(msg.content)
      }

      const personaOrder = [
        'contrarian',
        'risk_architect',
        'pattern_analyst',
        'stakeholder_mirror',
        'elder',
        'competitor',
      ]

      for (const key of personaOrder) {
        const msgs = personaMessages[key]
        if (!msgs) continue
        const persona = PERSONAS[key as keyof typeof PERSONAS]

        // New page per persona for clean reading
        addPage()

        // Persona header
        doc.setFillColor(13, 20, 38)
        doc.rect(margin - 2, y - 2, contentW + 4, 14, 'F')

        doc.setFont('helvetica', 'bold')
        doc.setFontSize(11)
        doc.setTextColor(212, 168, 67)
        doc.text(persona.label.toUpperCase(), margin, y + 6)

        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8)
        doc.setTextColor(74, 85, 104)
        doc.text(persona.tagline, margin, y + 11)
        y += 18

        // Assistant responses
        for (let i = 0; i < msgs.assistant.length; i++) {
          const content = msgs.assistant[i]
          const lines = doc.splitTextToSize(content, contentW)

          // If there was a prior user pushback, show it first
          if (i > 0 && msgs.user[i - 1]) {
            checkPageBreak(16)
            doc.setFillColor(8, 13, 26)
            doc.rect(margin, y, contentW, 12, 'F')
            doc.setFont('helvetica', 'italic')
            doc.setFontSize(8)
            doc.setTextColor(74, 85, 104)
            const pbLines = doc.splitTextToSize(
              `Your pushback: ${msgs.user[i - 1]}`,
              contentW - 4
            )
            doc.text(pbLines.slice(0, 2), margin + 2, y + 4)
            y += 14
          }

          doc.setFont('helvetica', 'normal')
          doc.setFontSize(9)
          doc.setTextColor(200, 208, 220)

          for (const line of lines) {
            checkPageBreak(5)
            doc.text(line, margin, y)
            y += 5
          }
          y += 4
        }
      }

      // ── Footer on last page ────────────────────────────────
      checkPageBreak(16)
      doc.setDrawColor(26, 38, 69)
      doc.line(margin, y, pageW - margin, y)
      y += 6
      doc.setFontSize(7)
      doc.setTextColor(42, 58, 92)
      doc.text('Generated by Quorum — Private Decision Intelligence', margin, y)
      doc.text(dateStr, pageW - margin, y, { align: 'right' })

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
