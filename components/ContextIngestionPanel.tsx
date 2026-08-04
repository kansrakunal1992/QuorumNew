'use client'
// components/ContextIngestionPanel.tsx
// ── Context Ingestion (Elite) ────────────────────────────────────────────────
// Mounted in app/mirror/page.tsx (welcome screen, paywall/CTA screen, and
// unlocked Mirror) and, in a locked-only form, referenced from
// ProfileCaptureOverlay's onboarding teaser line. Self-contained: fetches
// its own status/tier from GET /api/context-ingestion rather than taking
// tier as a prop, so it renders correctly wherever it's placed.
//
// v2 additions:
//   - Real polling for large/async imports (see runSubmit/pollUntilDone) —
//     v1's progress bar was a fixed client-side timer; a large file now
//     genuinely reflects the background job's actual status.
//   - "Reject all & start over" on the review screen — previously the only
//     way to discard everything was unchecking every box and hitting a
//     button that read "Save 0 insights", which doesn't read as "start
//     over" at all.
//   - "Still true?" freshness nudge for facts past the freshness window.
//   - Reanalyze now shows a before/after diff to accept/reject per fact,
//     instead of silently rewriting facts in place.
//   - Upload accepts ChatGPT/Claude exports (.zip/.json), plus Markdown,
//     HTML, and Word transcripts (.md/.html/.docx) — see
//     lib/context-export-parser.ts. Accepted types are listed in the UI
//     (ACCEPTED_FILE_TYPES_LABEL) so this isn't a guessing game.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  parseExportFile, parsePlainText, ACCEPTED_FILE_TYPES_LABEL, ACCEPTED_FILE_EXTENSIONS,
} from '@/lib/context-export-parser'
import type {
  ContextIngestionStatusResponse, ContextIngestionSource, UserMemoryFact, MemoryFactCategory,
} from '@/lib/types'
import type { ReanalyzeRevision } from '@/app/api/context-ingestion/reanalyze/route'

interface Props {
  authToken: string | null
}

const CATEGORY_LABELS: Record<MemoryFactCategory, string> = {
  goal: 'Goal', value: 'Value', constraint: 'Constraint',
  decision_pattern: 'Decision pattern', communication_style: 'Communication style',
  relationship: 'Relationship', long_term_context: 'Long-term context', other: 'Context',
}

const CONFIDENCE_PRECHECK_THRESHOLD = 0.75
const STEPS = ['Uploading', 'Analyzing', 'Insights extracted', 'Raw conversation discarded']
const POLL_INTERVAL_MS = 3000
const POLL_TIMEOUT_MS  = 5 * 60_000   // give up surfacing progress after 5 min — the job keeps running server-side regardless
const TERMINAL_STATUSES = ['review_pending', 'saved', 'discarded', 'failed', 'forgotten']

// v2 — soft "may reference someone by name" flag for the review screen.
// The extraction prompt already instructs the model not to extract facts
// about third parties, but that instruction didn't hold on a real import
// (a colleague's name leaked into a "Constraint" fact) — this is a second,
// independent layer of defense: a plain heuristic, not a hard filter, that
// visually flags a fact for extra scrutiny rather than silently stripping
// it (false positives are expected and fine; false negatives are the
// acceptable failure mode for a "worth a second look" signal, not a
// guarantee). Two signals: a capitalized, non-stoplisted word that either
// (a) takes a possessive "'s" — the strongest signal, since that's exactly
// the shape "Abhilash's ramp-up time" took — or (b) appears anywhere other
// than the start of a sentence.
const NAME_FLAG_STOPLIST = new Set([
  'Quorum', 'Council', 'Mirror', 'Elite', 'WhatsApp', 'LinkedIn', 'Instagram', 'Twitter', 'Facebook',
  'Google', 'Slack', 'Notion', 'Zoom', 'ChatGPT', 'Claude', 'OpenAI', 'Anthropic',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
])

function mayReferenceAName(text: string): boolean {
  const words = text.split(/\s+/)
  let afterSentenceEnd = true
  for (const raw of words) {
    const hasPossessive = /['’]s$/i.test(raw)
    const clean = raw.replace(/^[^A-Za-z]+|[^A-Za-z'’]+$/g, '').replace(/['’]s$/i, '')
    if (!clean) { afterSentenceEnd = /[.!?]$/.test(raw); continue }
    const isSentenceStart = afterSentenceEnd
    afterSentenceEnd = /[.!?]$/.test(raw)
    const looksCapitalized = /^[A-Z][a-z]{2,}$/.test(clean)
    if (!looksCapitalized || NAME_FLAG_STOPLIST.has(clean)) continue
    if (hasPossessive || !isSentenceStart) return true
  }
  return false
}

type ReviewAction = { id: string; action: 'accept' | 'edit' | 'reject'; editedText?: string }

function authHeaders(token: string | null): Record<string, string> {
  return token ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } : { 'Content-Type': 'application/json' }
}
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

export default function ContextIngestionPanel({ authToken }: Props) {
  const [data, setData]           = useState<ContextIngestionStatusResponse | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)

  // Submission flow
  const [inputMode, setInputMode] = useState<'text' | 'file'>('text')
  const [pastedText, setPastedText] = useState('')
  // v3 — per-import consent for specific details. Deliberately local state,
  // reset to false on every mount/re-render of the start screen (i.e. every
  // fresh import) rather than read from a previous choice — see UI copy
  // just above the toggle for why this isn't made sticky.
  const [allowSpecificDetails, setAllowSpecificDetails] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [asyncPolling, setAsyncPolling] = useState(false)
  const [progressStep, setProgressStep] = useState(0)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Review flow
  const [reviewFacts, setReviewFacts] = useState<UserMemoryFact[]>([])
  const [checked, setChecked]         = useState<Record<string, boolean>>({})
  const [editingId, setEditingId]     = useState<string | null>(null)
  const [editDraft, setEditDraft]     = useState('')
  const [editDrafts, setEditDrafts]   = useState<Record<string, string>>({})
  const [saving, setSaving]           = useState(false)
  const [confirmRejectAll, setConfirmRejectAll] = useState(false)

  // Forget / reanalyze
  const [confirmForget, setConfirmForget] = useState(false)
  const [busyAction, setBusyAction]       = useState<'forget' | 'reanalyze' | null>(null)

  // v2 — reanalyze diff view
  const [reanalyzeRevisions, setReanalyzeRevisions] = useState<ReanalyzeRevision[] | null>(null)
  const [reanalyzeModel, setReanalyzeModel]         = useState<string | null>(null)
  const [reanalyzeChecked, setReanalyzeChecked]     = useState<Record<string, boolean>>({})
  const [reanalyzeNote, setReanalyzeNote]           = useState<string | null>(null)

  // v2 — "still true?" freshness nudge
  const [freshnessBusyId, setFreshnessBusyId] = useState<string | null>(null)

  const fetchStatus = useCallback(async (): Promise<ContextIngestionStatusResponse | null> => {
    if (!authToken) { setLoadingStatus(false); return null }
    try {
      const res = await fetch('/api/context-ingestion', { headers: authHeaders(authToken) })
      if (!res.ok) { setLoadingStatus(false); return null }
      const json = await res.json() as ContextIngestionStatusResponse
      setData(json)
      if (json.ingestion?.status === 'review_pending') {
        setReviewFacts(json.facts)
        setChecked(Object.fromEntries(json.facts.map(f => [f.id, f.confidence >= CONFIDENCE_PRECHECK_THRESHOLD])))
      }
      return json
    } catch { return null }
    finally { setLoadingStatus(false) }
  }, [authToken])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  if (!authToken || loadingStatus || !data) return null
  if (!data.enabled) return null

  // ── Locked (Free tier) — upsell teaser ─────────────────────────────────────
  if (data.locked) {
    return (
      <div style={cardStyle()}>
        <p style={eyebrow('var(--gold)')}>Elite</p>
        <h3 style={heading()}>Accelerate your Council by teaching Quorum who you are</h3>
        <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.55, marginBottom: 16 }}>
          Skip months of rebuilding context — optionally import what another AI already knows about you, or describe yourself in a few sentences. Only distilled insights are ever kept; nothing raw is stored.
        </p>
        <a href="/mirror#mirror-cta" className="btn-primary" style={{ display: 'inline-block', fontSize: 13, padding: '10px 18px', textDecoration: 'none' }}>
          Unlock with Elite →
        </a>
      </div>
    )
  }

  const ingestion = data.ingestion
  const status = ingestion?.status ?? null

  // ── Submit handlers ─────────────────────────────────────────────────────────

  async function pollUntilDone(): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < POLL_TIMEOUT_MS) {
      await sleep(POLL_INTERVAL_MS)
      const json = await fetchStatus()
      const st = json?.ingestion?.status
      if (st && TERMINAL_STATUSES.includes(st)) {
        if (st === 'failed') setSubmitError(json?.ingestion?.error_message ?? 'Import failed. Please try again.')
        return
      }
    }
    setSubmitError("This is taking longer than expected — it's still processing in the background. Check back in a bit; you'll see the review screen here once it's ready.")
  }

  async function runSubmit(mode: ContextIngestionSource, text: string) {
    setSubmitError(null)
    setSubmitting(true)
    setAsyncPolling(false)
    setProgressStep(0)
    const ticker = setInterval(() => setProgressStep(s => Math.min(s + 1, STEPS.length - 2)), 900)
    try {
      const res = await fetch('/api/context-ingestion', {
        method: 'POST', headers: authHeaders(authToken),
        body: JSON.stringify({ mode, text, allowSpecificDetails }),
      })
      const json = await res.json()
      if (!res.ok) {
        setSubmitError(json.message ?? json.error ?? 'Import failed. Please try again.')
        return
      }
      if (json.error) { setSubmitError(json.message ?? json.error); return }

      if (json.async) {
        clearInterval(ticker)
        setAsyncPolling(true)
        setProgressStep(1)   // "Analyzing" — the one real state visible while polling
        await pollUntilDone()
        setSubmitting(false)
        setAsyncPolling(false)
        return
      }

      setProgressStep(STEPS.length - 1)
      await sleep(500)   // let the last tick be visible
      const facts = json.facts as UserMemoryFact[]
      setReviewFacts(facts)
      setChecked(Object.fromEntries(facts.map(f => [f.id, f.confidence >= CONFIDENCE_PRECHECK_THRESHOLD])))
      await fetchStatus()
    } catch {
      setSubmitError('Import failed. Please try again.')
    } finally {
      clearInterval(ticker)
      setSubmitting(false)
    }
  }

  async function handleFileChosen(file: File) {
    setSubmitError(null)
    try {
      const parsed = await parseExportFile(file)
      await runSubmit(parsed.sourceType, parsed.text)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not read that file.')
    }
  }

  function handlePastedSubmit() {
    if (!pastedText.trim()) return
    const parsed = parsePlainText(pastedText, 'manual')
    runSubmit('manual', parsed.text)
  }

  // ── Review handlers ──────────────────────────────────────────────────────────

  async function submitReview(actions: ReviewAction[]) {
    setSaving(true)
    try {
      const res = await fetch('/api/context-ingestion/confirm', {
        method: 'POST', headers: authHeaders(authToken),
        body: JSON.stringify({ facts: actions }),
      })
      if (res.ok) { setReviewFacts([]); setConfirmRejectAll(false); setAllowSpecificDetails(false); await fetchStatus() }
    } finally { setSaving(false) }
  }

  function handleSaveReview() {
    const actions: ReviewAction[] = reviewFacts.map(f => {
      if (!checked[f.id]) return { id: f.id, action: 'reject' as const }
      if (editDrafts[f.id]?.trim()) return { id: f.id, action: 'edit' as const, editedText: editDrafts[f.id] }
      return { id: f.id, action: 'accept' as const }
    })
    submitReview(actions)
  }

  // v2 — dedicated path, distinct from "uncheck everything then Save" so the
  // action reads as what it is rather than a zero-count save.
  function handleRejectAll() {
    submitReview(reviewFacts.map(f => ({ id: f.id, action: 'reject' as const })))
  }

  function startEdit(f: UserMemoryFact) { setEditingId(f.id); setEditDraft(editDrafts[f.id] ?? f.insight_text) }
  function commitEdit() {
    if (editingId) setEditDrafts(prev => ({ ...prev, [editingId]: editDraft.trim() }))
    setEditingId(null)
  }

  async function handleForget() {
    setBusyAction('forget')
    try {
      const res = await fetch('/api/context-ingestion', { method: 'DELETE', headers: authHeaders(authToken) })
      if (res.ok) { setConfirmForget(false); setAllowSpecificDetails(false); await fetchStatus() }
    } finally { setBusyAction(null) }
  }

  // v2 — reanalyze now fetches a diff for review, doesn't write anything itself
  async function handleReanalyze() {
    setBusyAction('reanalyze')
    setReanalyzeNote(null)
    try {
      const res = await fetch('/api/context-ingestion/reanalyze', { method: 'POST', headers: authHeaders(authToken) })
      const json = await res.json()
      if (!res.ok) { setReanalyzeNote(json.message ?? json.error ?? 'Reanalyze failed. Please try again.'); return }
      const revisions = json.revisions as ReanalyzeRevision[]
      if (revisions.length === 0) {
        setReanalyzeNote('Nothing to update — your insights still hold up.')
        return
      }
      setReanalyzeRevisions(revisions)
      setReanalyzeModel(json.model ?? null)
      setReanalyzeChecked(Object.fromEntries(revisions.map(r => [r.id, true])))
    } finally { setBusyAction(null) }
  }

  async function handleApplyReanalyze() {
    if (!reanalyzeRevisions) return
    setBusyAction('reanalyze')
    try {
      const applied = reanalyzeRevisions
        .filter(r => reanalyzeChecked[r.id])
        .map(r => ({ id: r.id, category: r.after.category, insight_text: r.after.insight_text, confidence: r.after.confidence, importance: r.after.importance }))
      const res = await fetch('/api/context-ingestion/reanalyze/apply', {
        method: 'POST', headers: authHeaders(authToken),
        body: JSON.stringify({ model: reanalyzeModel, applied }),
      })
      if (res.ok) {
        setReanalyzeRevisions(null); setReanalyzeModel(null)
        await fetchStatus()
      }
    } finally { setBusyAction(null) }
  }

  // v2 — "still true?" freshness nudge actions
  async function handleFreshnessAction(id: string, action: 'still_true' | 'remove') {
    setFreshnessBusyId(id)
    try {
      const res = await fetch('/api/context-ingestion/freshness', {
        method: 'POST', headers: authHeaders(authToken),
        body: JSON.stringify({ id, action }),
      })
      if (res.ok) await fetchStatus()
    } finally { setFreshnessBusyId(null) }
  }

  // ── Render: mid-submission progress bar ──────────────────────────────────────
  if (submitting) {
    return (
      <div style={cardStyle()}>
        <p style={eyebrow('var(--gold)')}>Elite · Context Import</p>
        <h3 style={heading()}>{asyncPolling ? 'Analyzing…' : `${STEPS[progressStep]}…`}</h3>
        <div style={{ display: 'flex', gap: 6, marginTop: 16 }}>
          {STEPS.map((s, i) => (
            <div key={s} style={{
              flex: 1, height: 4, borderRadius: 2,
              background: i <= progressStep ? 'var(--gold)' : 'var(--border-dim)',
              transition: 'background 0.3s',
            }} />
          ))}
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 10 }}>
          {asyncPolling
            ? "This is a large import, so it's processing in the background — feel free to navigate away, it'll keep going. Your raw text is processed in memory only and is never written to storage."
            : 'Your raw text is processed in memory only and is never written to storage.'}
        </p>
        {submitError && (
          <p style={{ fontSize: 12, color: 'var(--error)', marginTop: 10 }}>{submitError}</p>
        )}
      </div>
    )
  }

  // ── Render: review screen ────────────────────────────────────────────────────
  if (status === 'review_pending' && reviewFacts.length > 0) {
    const acceptedNow = Object.values(checked).filter(Boolean).length
    return (
      <div style={cardStyle()}>
        <p style={eyebrow('var(--gold)')}>Elite · Context Import</p>
        <h3 style={heading()}>Review what Quorum learned</h3>
        <p style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 16, lineHeight: 1.5 }}>
          Uncheck anything that's off. Nothing here enters the Council until you save.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {reviewFacts.map(f => (
            <div key={f.id} style={{
              display: 'flex', gap: 10, alignItems: 'flex-start',
              padding: '10px 12px', borderRadius: 9,
              border: '1px solid var(--border-dim)',
              background: checked[f.id] ? 'transparent' : 'var(--bg-inset)',
              opacity: checked[f.id] ? 1 : 0.55,
            }}>
              <input
                type="checkbox" checked={!!checked[f.id]}
                onChange={e => setChecked(prev => ({ ...prev, [f.id]: e.target.checked }))}
                style={{ marginTop: 3, cursor: 'pointer' }}
              />
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {CATEGORY_LABELS[f.category]}
                  {f.is_specific && (
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'none', letterSpacing: 'normal', padding: '1px 6px', borderRadius: 4, border: '1px solid var(--border-dim)' }}>
                      Specific detail
                    </span>
                  )}
                  {mayReferenceAName(editDrafts[f.id] ?? f.insight_text) && (
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--error)', textTransform: 'none', letterSpacing: 'normal' }}>
                      ⚠ may reference someone by name
                    </span>
                  )}
                </p>
                {editingId === f.id ? (
                  <div>
                    <textarea
                      value={editDraft} onChange={e => setEditDraft(e.target.value)}
                      style={{ width: '100%', minHeight: 54, fontSize: 12.5, padding: 6, borderRadius: 6, border: '1px solid var(--border-dim)', background: 'var(--bg-card)', color: 'var(--text-1)', fontFamily: 'inherit', boxSizing: 'border-box' }}
                    />
                    <button type="button" onClick={commitEdit} style={{ fontSize: 11, color: 'var(--gold)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' }}>Done</button>
                  </div>
                ) : (
                  <p style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.45 }}>
                    {editDrafts[f.id] ?? f.insight_text}
                    <button type="button" onClick={() => startEdit(f)} style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-4)', background: 'none', border: 'none', cursor: 'pointer' }}>
                      Edit
                    </button>
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
        <button type="button" onClick={handleSaveReview} disabled={saving} className="btn-primary" style={{ width: '100%', fontSize: 14, padding: '12px', marginBottom: 10 }}>
          {saving ? 'Saving…' : `Save ${acceptedNow} insight${acceptedNow === 1 ? '' : 's'} →`}
        </button>

        {/* v2 — dedicated reject-all path */}
        {!confirmRejectAll ? (
          <button type="button" onClick={() => setConfirmRejectAll(true)} disabled={saving}
            style={{ width: '100%', fontSize: 12, color: 'var(--text-4)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' }}>
            Reject all &amp; start over
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>
            <span style={{ color: 'var(--text-3)' }}>Discard all {reviewFacts.length} and start over?</span>
            <button type="button" onClick={handleRejectAll} disabled={saving} style={{ color: 'var(--error)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
              {saving ? 'Discarding…' : 'Yes, discard'}
            </button>
            <button type="button" onClick={() => setConfirmRejectAll(false)} style={{ color: 'var(--text-4)', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
          </div>
        )}
      </div>
    )
  }

  // ── Render: reanalyze diff view (v2) ─────────────────────────────────────────
  if (reanalyzeRevisions && reanalyzeRevisions.length > 0) {
    const acceptedNow = Object.values(reanalyzeChecked).filter(Boolean).length
    return (
      <div style={cardStyle()}>
        <p style={eyebrow('var(--gold)')}>Elite · Context Import</p>
        <h3 style={heading()}>What changed</h3>
        <p style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 16, lineHeight: 1.5 }}>
          The current model suggests these updates. Uncheck anything you'd rather keep as-is.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          {reanalyzeRevisions.map(r => (
            <div key={r.id} style={{
              display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px',
              borderRadius: 9, border: '1px solid var(--border-dim)',
              opacity: reanalyzeChecked[r.id] ? 1 : 0.5,
            }}>
              <input type="checkbox" checked={!!reanalyzeChecked[r.id]}
                onChange={e => setReanalyzeChecked(prev => ({ ...prev, [r.id]: e.target.checked }))}
                style={{ marginTop: 3, cursor: 'pointer' }} />
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {CATEGORY_LABELS[r.after.category]}{r.before.category !== r.after.category && ` (was ${CATEGORY_LABELS[r.before.category]})`}
                  {r.is_specific && (
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'none', letterSpacing: 'normal', padding: '1px 6px', borderRadius: 4, border: '1px solid var(--border-dim)' }}>
                      Specific detail
                    </span>
                  )}
                </p>
                <p style={{ fontSize: 12.5, color: 'var(--text-4)', textDecoration: 'line-through', marginBottom: 3, lineHeight: 1.4 }}>{r.before.insight_text}</p>
                <p style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.4 }}>{r.after.insight_text}</p>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" onClick={handleApplyReanalyze} disabled={busyAction !== null} className="btn-primary" style={{ flex: 1, fontSize: 14, padding: '11px' }}>
            {busyAction === 'reanalyze' ? 'Applying…' : `Apply ${acceptedNow} change${acceptedNow === 1 ? '' : 's'} →`}
          </button>
          <button type="button" onClick={() => { setReanalyzeRevisions(null); setReanalyzeModel(null) }}
            style={{ fontSize: 13, padding: '11px 16px', borderRadius: 8, border: '1px solid var(--border-dim)', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer' }}>
            Dismiss
          </button>
        </div>
      </div>
    )
  }

  // ── Render: saved state — retained summary + manage ──────────────────────────
  if (status === 'saved') {
    const acceptedCount = data.facts.length
    const specificCount = data.facts.filter(f => f.is_specific).length
    const byCategory: Partial<Record<MemoryFactCategory, number>> = {}
    for (const f of data.facts) byCategory[f.category] = (byCategory[f.category] ?? 0) + 1

    return (
      <div style={cardStyle()}>
        <p style={eyebrow('var(--green-text)')}>Elite · Context Import</p>
        <h3 style={heading()}>{acceptedCount} insight{acceptedCount === 1 ? '' : 's'} retained</h3>
        <p style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 4, lineHeight: 1.5 }}>
          {Object.entries(byCategory).map(([cat, n]) => `${n} ${CATEGORY_LABELS[cat as MemoryFactCategory]}${n === 1 ? '' : 's'}`).join(' · ')}
        </p>
        <p style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: specificCount > 0 ? 4 : 16 }}>
          Raw source content was never stored. These insights now inform your Council sessions.
        </p>
        {specificCount > 0 && (
          <p style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 16 }}>
            {specificCount} include{specificCount === 1 ? 's' : ''} a specific detail you opted into — these are checked for freshness sooner than the rest.
          </p>
        )}

        {/* v2 — reanalyze note (e.g. "nothing to update") */}
        {reanalyzeNote && (
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>{reanalyzeNote}</p>
        )}

        {/* v2 — "Still true?" freshness nudge */}
        {data.staleFacts.length > 0 && (
          <div style={{ marginBottom: 16, padding: '10px 12px', borderRadius: 9, border: '1px solid var(--gold-dim)', background: 'color-mix(in srgb, var(--gold) 6%, transparent)' }}>
            <p style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--gold)', marginBottom: 8 }}>
              Still true? {data.staleFacts.length} insight{data.staleFacts.length === 1 ? '' : 's'} {data.staleFacts.length === 1 ? "hasn't" : "haven't"} been reconfirmed in a while.
            </p>
            {data.staleFacts.map(f => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.4, flex: 1 }}>{f.insight_text}</p>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button type="button" disabled={freshnessBusyId === f.id} onClick={() => handleFreshnessAction(f.id, 'still_true')}
                    style={{ fontSize: 11, color: 'var(--gold)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Still true</button>
                  <button type="button" disabled={freshnessBusyId === f.id} onClick={() => handleFreshnessAction(f.id, 'remove')}
                    style={{ fontSize: 11, color: 'var(--text-4)', background: 'none', border: 'none', cursor: 'pointer' }}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={handleReanalyze} disabled={busyAction !== null}
            style={{ fontSize: 12, padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border-dim)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer' }}>
            {busyAction === 'reanalyze' ? 'Checking…' : 'Refresh with latest model'}
          </button>
          {data.cooldownDaysRemaining === 0 ? (
            <button type="button" onClick={() => { setAllowSpecificDetails(false); setInputMode('text') }}
              style={{ fontSize: 12, padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border-dim)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer' }}>
              Import again
            </button>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--text-4)', alignSelf: 'center' }}>
              Fresh import available in {data.cooldownDaysRemaining} day{data.cooldownDaysRemaining === 1 ? '' : 's'}
            </span>
          )}
          {!confirmForget ? (
            <button type="button" onClick={() => setConfirmForget(true)}
              style={{ fontSize: 12, padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border-dim)', background: 'transparent', color: 'var(--error)', cursor: 'pointer' }}>
              Forget imported context
            </button>
          ) : (
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Permanently delete all {acceptedCount} insights?</span>
              <button type="button" onClick={handleForget} disabled={busyAction !== null} style={{ fontSize: 12, color: 'var(--error)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                {busyAction === 'forget' ? 'Deleting…' : 'Yes, forget it'}
              </button>
              <button type="button" onClick={() => setConfirmForget(false)} style={{ fontSize: 12, color: 'var(--text-4)', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
            </span>
          )}
        </div>
      </div>
    )
  }

  // ── Render: start screen (no ingestion yet, or failed/discarded/forgotten) ───
  return (
    <div style={cardStyle()}>
      <p style={eyebrow('var(--gold)')}>Elite · Context Import</p>
      <h3 style={heading()}>Accelerate your Council by teaching Quorum who you are</h3>
      <p style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 14, lineHeight: 1.5 }}>
        Paste a description of yourself, or upload a ChatGPT/Claude conversation export. Only distilled insights are kept — raw content is processed in memory and never stored. You'll review everything before it's saved.
      </p>
      {submitError && (
        <p style={{ fontSize: 12, color: 'var(--error)', marginBottom: 12 }}>{submitError}</p>
      )}

      {/* v3 — specific-details opt-in. Off by default, asked fresh every import. */}
      <label style={{
        display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer',
        padding: '10px 12px', borderRadius: 9, border: '1px solid var(--border-dim)',
        background: 'var(--bg-inset)', marginBottom: 14,
      }}>
        <input
          type="checkbox" checked={allowSpecificDetails}
          onChange={e => setAllowSpecificDetails(e.target.checked)}
          style={{ marginTop: 3, cursor: 'pointer' }}
        />
        <span>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-1)', display: 'block', marginBottom: 3 }}>
            Let insights include specific details
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-4)', lineHeight: 1.5, display: 'block' }}>
            Off by default. When on, insights may include concrete details — names, employers, dates, amounts — where they matter to a real decision. Sharper right now, but they age faster, so you&rsquo;ll be asked again on your next import. Still reviewed before saving, still encrypted, still deletable anytime.
          </span>
        </span>
      </label>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button type="button" onClick={() => setInputMode('text')}
          style={tabStyle(inputMode === 'text')}>Describe myself</button>
        <button type="button" onClick={() => setInputMode('file')}
          style={tabStyle(inputMode === 'file')}>Upload export</button>
      </div>

      {inputMode === 'text' ? (
        <>
          <textarea
            value={pastedText} onChange={e => setPastedText(e.target.value)}
            placeholder="A few sentences about your values, goals, and how you tend to approach decisions…"
            style={{ width: '100%', minHeight: 90, fontSize: 13, padding: 10, borderRadius: 8, border: '1px solid var(--border-dim)', background: 'var(--bg-inset)', color: 'var(--text-1)', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 12 }}
          />
          <button type="button" onClick={handlePastedSubmit} disabled={!pastedText.trim()} className="btn-primary" style={{ width: '100%', fontSize: 14, padding: '11px' }}>
            Analyze →
          </button>
        </>
      ) : (
        <>
          <input
            ref={fileInputRef} type="file" accept={ACCEPTED_FILE_EXTENSIONS} style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFileChosen(f) }}
          />
          <button type="button" onClick={() => fileInputRef.current?.click()} className="btn-primary" style={{ width: '100%', fontSize: 14, padding: '11px' }}>
            Choose a file →
          </button>
          <p style={{ fontSize: 10.5, color: 'var(--text-4)', marginTop: 8, lineHeight: 1.5 }}>
            Accepted: {ACCEPTED_FILE_TYPES_LABEL}. Your export is parsed in your browser — the original file never leaves your device. Only the extracted insights below are sent.
          </p>
        </>
      )}
    </div>
  )
}

// ── Shared style helpers (matches BriefCTA/UnlockNotice tokens) ────────────────

function cardStyle(): React.CSSProperties {
  return {
    background: 'var(--bg-card)', border: '1px solid var(--border-dim)',
    borderRadius: 14, padding: '20px 20px 18px', marginBottom: 20,
  }
}
function eyebrow(color: string): React.CSSProperties {
  return { fontSize: 10.5, fontWeight: 600, color, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }
}
function heading(): React.CSSProperties {
  return { fontSize: 16, fontWeight: 700, color: 'var(--text-1)', margin: '0 0 8px', lineHeight: 1.35 }
}
function tabStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1, fontSize: 12, padding: '8px 10px', borderRadius: 8,
    border: `1px solid ${active ? 'var(--gold)' : 'var(--border-dim)'}`,
    background: active ? 'color-mix(in srgb, var(--gold) 12%, transparent)' : 'transparent',
    color: active ? 'var(--gold)' : 'var(--text-3)',
    cursor: 'pointer', fontFamily: 'inherit',
  }
}
