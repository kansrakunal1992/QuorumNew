// tests/judgment-record-delete.test.ts
// -- Judgment record on the new landing screen: Delete (one tap + Undo) and Share on each row (Nov 2026) --------
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const root = join(__dirname, '..')
const src = (rel: string) => readFileSync(join(root, rel), 'utf-8')

const strip = src('components/JudgmentRecordStrip.tsx')
const ci    = src('components/ChatIntake.tsx')
const nic   = src('app/NaturalIntakeClient.tsx')

describe('1. the strip: one tap, then Undo, and nothing is deleted before the window ends', () => {
  it('has an Undo window of a few seconds and a real delete only when it passes', () => {
    expect(strip).toContain('export const UNDO_WINDOW_MS = 6000')
    expect(strip).toContain('setTimeout(() => {')
    expect(strip).toContain('onDeleteRef.current?.(id)')
    expect(strip).not.toContain('window.confirm')        // no browser pop-up
  })
  it('the tap itself only hides the row (it never calls the parent directly)', () => {
    const start = strip.indexOf('function startDelete(')
    const end   = strip.indexOf('function undoDelete(')
    const body  = strip.slice(start, end)
    expect(body).toContain('setDeletingIds(')
    expect(body.indexOf('onDeleteRef.current?.(id)')).toBeGreaterThan(body.indexOf('setTimeout('))
  })
  it('Undo clears the timer and shows the row again; the row is replaced in the same spot by a status line', () => {
    const body = strip.slice(strip.indexOf('function undoDelete('), strip.indexOf('if (!sessions.length) return null'))
    expect(body).toContain('clearTimeout(t)')
    expect(strip).toContain('Decision deleted.')
    expect(strip).toContain('role="status"')
    expect(strip).toContain('>\n                  Undo\n                </button>')
  })
  it('leaving the page during the window commits the delete (pagehide and unmount), once', () => {
    expect(strip).toContain("window.addEventListener('pagehide', flush)")
    expect(strip).toContain("window.removeEventListener('pagehide', flush); flush()")
    expect(strip).toContain('timers.current.delete(id)')
  })
  it('the counts ignore rows being deleted; every decision can be deleted, with or without an outcome', () => {
    expect(strip).toContain('const live     = sessions.filter(s => !deletingIds.includes(s.id))')
    expect(strip).toContain('`All ${live.length}`')
    expect(strip).not.toMatch(/onDeleteSession[^\n]*s\.outcome|s\.outcome[^\n]*onDeleteSession/)
  })
  it('each row has Share (compact, as on the classic page) and Delete, and neither opens the record', () => {
    expect(strip).toContain('<ShareRecordButton sessionId={s.id} decisionText={s.decision_text} compact />')
    expect(strip).toContain('title="Delete this decision"')
    expect(strip).toContain('onClick={e => e.stopPropagation()}')
    expect(strip).toContain('{onDeleteSession && (')
  })
})

describe('2. the parent does the real delete, the same three steps as the classic page', () => {
  it('ChatIntake passes the handler through, optional', () => {
    expect(ci).toContain('onDeleteSession?:      (sessionId: string) => void')
    expect(ci).toContain('<JudgmentRecordStrip sessions={historySessions} onDeleteSession={onDeleteSession} />')
  })
  it('NaturalIntakeClient removes it from the list, from this device and from the server (with the auth header)', () => {
    const body = nic.slice(nic.indexOf('const handleDeleteSession = (sessionId: string) => {'), nic.indexOf('const sessionCount   ='))
    expect(body).toContain('setHistorySessions(prev => prev.filter(s => s.id !== sessionId))')
    expect(body).toContain('removeSessionId(sessionId)')
    expect(body).toContain("fetch('/api/record', { method: 'DELETE'")
    expect(body).toContain("headers['Authorization'] = `Bearer ${authToken}`")
    expect(body).toContain('keepalive: true')
    expect(nic).toContain('onDeleteSession={handleDeleteSession}')
  })
  it('the server route it calls still checks ownership', () => {
    const r = src('app/api/record/route.ts')
    expect(r).toContain('export async function DELETE')
    expect(r).toContain("session.user_id !== callerId")
  })
})
