// tests/v17-phase6.test.ts
// v17 (Nov 2026), Phase 6: "something we didn't ask", calibration and contradiction insights, the reasons behind an email ask,
// and the Mirror for people who are not signed in. Pure logic runs the real code; wiring tests read the source.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { composeLeftOutText, leftOutFor, MAX_LEFT_OUT } from '@/lib/left-out'
import { INTAKE_FLOW_VERSION, INTAKE_FLOW_VERSION_FAST } from '@/lib/chat-intake-depth'
import {
  buildContradictionInsight, buildInsights, confidenceNote,
  MIN_CALIBRATION_GAP, MIN_CALIBRATION_PAIRS, MIN_SURE_DECISIONS, MIN_SURE_WRONG, VERY_SURE,
} from '@/lib/mirror-insights'
import type { ContradictionSession, InsightRow, StoredContradiction } from '@/lib/mirror-insights'
import { CONNECT_REASON_LINES } from '@/components/ConnectCard'
import { sanitizeIntakeProps } from '@/lib/event-props'
import type { ChatDecisionState } from '@/lib/types'

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const stripAllComments = (code: string) => code.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
const UNVERIFIED_CLAIM = /\b(free|no\s*sign-?\s*up|no\s*signup|no\s*account|without\s+(an\s+)?account|\d+\s*(min|minute|minutes|sec|seconds)\b|in\s+minutes|instant(ly)?|guarantee[sd]?|unlock)\b/i

const NOW = new Date(2026, 10, 22, 12, 0, 0)
const iso = (daysAgo: number) => new Date(2026, 10, 22 - daysAgo, 9, 0, 0).toISOString()
let seq = 0
const row = (o: Partial<InsightRow> = {}): InsightRow => ({
  id: `p${++seq}`, created_at: iso(5), optimization_priority: null, initial_instinct: null, final_decision_plain: null,
  prediction_matched_final: null, decision_snippet: `Decision ${seq}`, session_depth: null, locked: false, review_date: null,
  has_outcome: false, pre_confidence: null, retro_confidence: null, outcome_quality: null, ...o,
})
const settled = (o: Partial<InsightRow> = {}) => row({ has_outcome: true, ...o })

// ── 1. Something we didn't ask ──────────────────────────────────────────────────────────────────────────────────────────
describe('1. "Something we didn\'t ask": exactly the questions the intake left out', () => {
  const base = (o: Partial<ChatDecisionState> = {}): ChatDecisionState =>
    ({ decisionKind: 'financial', stakes: 'medium', facts: { what: 'Put savings into a flat', why_now: 'The seller wants an answer' }, ...o } as ChatDecisionState)

  it('the fast path leaves lower-weight required slots out, and they come back as the real questions, heaviest first', () => {
    const items = leftOutFor(base({ flowVersion: INTAKE_FLOW_VERSION_FAST }))
    expect(items.map(i => i.key)).toEqual(['alternatives', 'constraints'])   // weights 65, 55
    expect(items[0]).toMatchObject({ key: 'alternatives', label: 'Other routes' })
    expect(items[0].ask.length).toBeGreaterThan(10)
  })

  it('a chat that asked everything has nothing to offer, so the card never appears', () => {
    const asked = base({ facts: { what: 'x', why_now: 'y', alternatives: 'z', constraints: 'w' } })
    expect(leftOutFor(asked)).toEqual([])
    expect(leftOutFor(null)).toEqual([])
    expect(leftOutFor({} as ChatDecisionState)).toEqual([])
  })

  it('never re-asks what the person answered, did not know, said did not apply, or chose to skip', () => {
    const fast = { flowVersion: INTAKE_FLOW_VERSION_FAST }
    expect(leftOutFor(base({ ...fast, facts: { what: 'x', why_now: 'y', alternatives: 'Rent instead' } })).map(i => i.key)).toEqual(['constraints'])
    expect(leftOutFor(base({ ...fast, unknownFacts: ['constraints'] })).map(i => i.key)).toEqual(['alternatives'])
    expect(leftOutFor(base({ ...fast, naSlots: ['alternatives', 'constraints'] }))).toEqual([])
    expect(leftOutFor(base({ ...fast, skippedSlots: ['alternatives'] })).map(i => i.key)).toEqual(['constraints'])
    expect(leftOutFor(base({ ...fast, cardAnswers: { alternatives: { selectedIds: ['a'] } } as any })).map(i => i.key)).toEqual(['constraints'])
  })

  it('a material slot the chat had to stop without is offered too, and is not capped away by lighter ones', () => {
    const exit = { decisionKind: 'career_exit', stakes: 'high', flowVersion: INTAKE_FLOW_VERSION_FAST, gapSlots: ['runway'], facts: { role: 'Engineer', next_step: 'Start a company', why_now: 'Burnt out' } } as ChatDecisionState
    expect(leftOutFor(exit).map(i => i.key)).toContain('runway')
    expect(leftOutFor(exit, 1)).toHaveLength(1)
    expect(MAX_LEFT_OUT).toBe(4)
    expect(leftOutFor(exit).length).toBeLessThanOrEqual(MAX_LEFT_OUT)
  })

  it('the standard flow can leave gaps too (ceiling reached), and the same card handles it', () => {
    const std = base({ flowVersion: INTAKE_FLOW_VERSION, stakes: 'high', gapSlots: ['constraints'], facts: { what: 'x', why_now: 'y', alternatives: 'z' } })
    expect(leftOutFor(std).map(i => i.key)).toEqual(['constraints'])
  })

  it('composes plain new-information text from only the answers given, and nothing when there are none', () => {
    const items = [{ key: 'alternatives', label: 'Other routes' }, { key: 'constraints', label: 'Limits' }]
    expect(composeLeftOutText(items, {})).toBe('')
    expect(composeLeftOutText(items, { alternatives: '   ' })).toBe('')
    const t = composeLeftOutText(items, { alternatives: '  Rent for a year  ', constraints: '' })
    expect(t).toContain('not asked about earlier')
    expect(t).toContain('- Other routes: Rent for a year')
    expect(t).not.toContain('Limits')
  })

  it('the endpoint returns questions only: no decision text, no answers, and nothing for sessions that did not come from the chat', () => {
    const route = src('app/api/session/[id]/left-out/route.ts')
    expect(route).toContain('items: leftOutFor(state)')
    expect(route).toContain("if (!session?.chat_intake_id) return NextResponse.json({ items: [], flowVersion: null, closedBy: null }")
    expect(route).toContain("select('id, chat_intake_id')")
    expect(stripAllComments(route)).not.toMatch(/decision_text|context_text|facts/)
    expect(route).toContain("UUID_RE.test(id)")
  })

  it('it is optional, quiet when empty, and answers go through the existing new-information pipeline in the same session', () => {
    const c = src('components/LeftOutCard.tsx')
    expect(c).toContain('if (!items || items.length === 0 || state === \'dismissed\') return null')
    expect(c).toContain('Not now')
    expect(c).toContain('Entirely optional.')
    expect(c).toContain('disabled={answered.length === 0 || busy}')
    const sv = src('components/SessionView.tsx')
    expect(sv).toContain("import LeftOutCard from '@/components/LeftOutCard'")
    expect(sv).toContain("onSubmit={(text) => handleShareContext('synthesis', text)}")
    expect(sv).toContain('busy={pendingAdvisorUpdates > 0}')
    expect(sv).toMatch(/\{synthesisDone && \(\s*<div className="sv-fade sv-fade-2" style=\{\{ marginBottom: 12 \}\}>\s*<LeftOutCard/)
    // no second decision is created: it never calls the reanalyze / session-create path
    expect(stripAllComments(c)).not.toMatch(/\/api\/session['"`]|handleReanalyze|parent_session_id/)
  })

  it('its events carry counts and the flow cohort, never what was typed', () => {
    const c = stripAllComments(src('components/LeftOutCard.tsx'))
    expect(c).toContain("track('left_out_shown', { items_count: items.length")
    expect(c).toContain("track('left_out_submitted', { answered_count: answered.length, items_count: items.length")
    expect(c).not.toMatch(/track\([^)]*(answers|text)\b/)
    for (const f of ['lib/track.ts', 'app/api/events/route.ts', 'lib/event-props.ts']) {
      for (const e of ['left_out_shown', 'left_out_submitted', 'left_out_dismissed']) expect(src(f)).toContain(`'${e}'`)
    }
    const kept = sanitizeIntakeProps('left_out_submitted', { answered_count: 2, items_count: 3, flow_version: 'v9_fast_path', typed: 'my runway is six months' })
    expect(kept).toMatchObject({ answered_count: 2, items_count: 3, flow_version: 'v9_fast_path' })
    expect(kept).not.toHaveProperty('typed')
  })
})

// ── 2. Calibration insights ────────────────────────────────────────────────────────────────────────────────────────────
describe('2. Calibration: "sure and wrong" and the confidence gap, each with its own evidence rule', () => {
  it('"sure and wrong" needs three very-sure decisions, at least two worse than expected, and at least half', () => {
    expect([VERY_SURE, MIN_SURE_DECISIONS, MIN_SURE_WRONG]).toEqual([8, 3, 2])
    const mk = (spec: Array<[number, string]>) => spec.map(([pre, q], i) => settled({ pre_confidence: pre, outcome_quality: q, created_at: iso(i + 1) }))
    const shown = buildInsights(mk([[9, 'worse_than_expected'], [8, 'worse_than_expected'], [9, 'as_expected']]), { now: NOW }).watch.find(i => i.kind === 'sure_and_wrong')!
    expect(shown.claim).toBe('2 of the 3 decisions you felt very sure about (8 or more out of 10) turned out worse than you expected.')
    expect(shown.evidenceCount).toBe(2)
    expect(shown.evidence).toHaveLength(2)
    expect(shown.confidence).toBe('emerging')
    expect(shown.nextTime).toMatch(/what you would have to see to change your mind/)
    const none = (spec: Array<[number, string]>) => buildInsights(mk(spec), { now: NOW }).watch.find(i => i.kind === 'sure_and_wrong')
    expect(none([[9, 'worse_than_expected'], [9, 'as_expected']])).toBeUndefined()                                     // only two sure
    expect(none([[9, 'worse_than_expected'], [9, 'as_expected'], [9, 'better_than_expected']])).toBeUndefined()      // only one wrong
    expect(none([[9, 'worse_than_expected'], [9, 'worse_than_expected'], [9, 'as_expected'], [9, 'as_expected'], [9, 'as_expected']])).toBeUndefined()   // 2 of 5 is under half
    expect(none([[7, 'worse_than_expected'], [7, 'worse_than_expected'], [7, 'worse_than_expected']])).toBeUndefined()   // 7 is not "very sure"
  })

  it('too-early outcomes, missing confidence, and decisions with no outcome never count', () => {
    const rows = [
      settled({ pre_confidence: 9, outcome_quality: 'too_early' }), settled({ pre_confidence: 9, outcome_quality: 'too_early' }),
      settled({ pre_confidence: null, outcome_quality: 'worse_than_expected' }), row({ pre_confidence: 9, outcome_quality: 'worse_than_expected', has_outcome: false }),
    ]
    const o = buildInsights(rows, { now: NOW })
    expect(o.watch.find(i => i.kind === 'sure_and_wrong')).toBeUndefined()
    expect(o.learned.find(i => i.kind === 'calibration_gap')).toBeUndefined()
  })

  it('the confidence gap uses the Mirror\'s own thresholds: three pairs, and an average gap of 1.5 or more', () => {
    expect([MIN_CALIBRATION_PAIRS, MIN_CALIBRATION_GAP]).toEqual([3, 1.5])
    const pairs = (spec: Array<[number, number]>) => spec.map(([pre, retro], i) => settled({ pre_confidence: pre, retro_confidence: retro, created_at: iso(i + 1) }))
    const down = buildInsights(pairs([[8, 5], [8, 6], [9, 5]]), { now: NOW }).learned.find(i => i.kind === 'calibration_gap')!
    expect(down.claim).toBe('Across 3 decisions, your confidence averaged 8.3 out of 10 going in and 5.3 looking back. You tend to feel surer going in than you do afterwards.')
    expect(down.evidenceCount).toBe(3)
    expect(down.nextTime).toMatch(/write down your confidence and what would lower it/)
    const up = buildInsights(pairs([[4, 7], [5, 8], [4, 7]]), { now: NOW }).learned.find(i => i.kind === 'calibration_gap')!
    expect(up.claim).toMatch(/less sure going in/)
    const find = (spec: Array<[number, number]>) => buildInsights(pairs(spec), { now: NOW }).learned.find(i => i.kind === 'calibration_gap')
    expect(find([[8, 5], [8, 6]])).toBeUndefined()                      // two pairs
    expect(find([[7, 6], [7, 6], [7, 6]])).toBeUndefined()              // gap of 1: not enough
    expect(find([[8, 6.5], [8, 6.5], [8, 6.5]])).toBeDefined()          // gap of exactly 1.5 counts
  })

  it('calibration is only "established" with five or more decisions behind it', () => {
    const pairs = (n: number) => Array.from({ length: n }, (_, i) => settled({ pre_confidence: 9, retro_confidence: 4, created_at: iso(i + 1) }))
    expect(buildInsights(pairs(3), { now: NOW }).learned.find(i => i.kind === 'calibration_gap')!.confidence).toBe('emerging')
    expect(buildInsights(pairs(5), { now: NOW }).learned.find(i => i.kind === 'calibration_gap')!.confidence).toBe('established')
  })

  it('the anonymous form carries these as counts and averages only, with no decisions attached', () => {
    const rows = Array.from({ length: 3 }, (_, i) => settled({ pre_confidence: 9, retro_confidence: 4, outcome_quality: 'worse_than_expected', decision_snippet: 'Whether to tell my cofounder', created_at: iso(i + 1) }))
    const anon = buildInsights(rows, { now: NOW, withEvidence: false })
    for (const i of [...anon.learned, ...anon.watch]) expect(i.evidence).toEqual([])
    expect(JSON.stringify(anon)).not.toMatch(/cofounder/)
  })

  it('the loader reads the fields calibration rests on, and a failed outcome lookup produces no calibration at all', () => {
    const d = src('lib/decision-history.ts')
    expect(d).toContain("pre_decision_confidence`")
    expect(d).toContain(".select('session_id, retrospective_confidence, outcome_quality')")
    expect(d).toContain('retro_confidence:         outcomesKnown ?')
    expect(d).toContain('outcome_quality:          outcomesKnown ?')
  })
})

// ── 3. Contradictions ────────────────────────────────────────────────────────────────────────────────────────────────────
describe('3. Contradictions: stored readings only, owner only, one at a time, labelled as a reading', () => {
  const sessions: ContradictionSession[] = [
    { id: 's1', snippet: 'Whether to take the offer', created_at: iso(30) },
    { id: 's2', snippet: 'Whether to move cities', created_at: iso(10) },
    { id: 's3', snippet: 'Whether to hire now', created_at: iso(3) },
  ]
  const stored = (o: Partial<StoredContradiction> = {}): StoredContradiction => ({
    id: 'c1', principle_text: 'I do not commit without a written term sheet', principle_session_id: 's1',
    violation_text: 'agreed the terms on a call and moved ahead', violation_session_id: 's2', severity: 'notable', generated_at: iso(2), ...o,
  })

  it('shows a stored reading as a reading: labelled, with both decisions and a way to dismiss it', () => {
    const c = buildContradictionInsight([stored()], sessions)!
    expect(c.kind).toBe('contradiction')
    expect(c.group).toBe('watch')
    expect(c.confidence).toBe('reading')
    expect(c.confidenceNote).toBe(confidenceNote('reading', 2))
    expect(c.confidenceNote).toMatch(/not a fact/)
    expect(c.claim).toMatch(/^Quorum read a tension between two of your decisions\./)
    expect(c.dismissId).toBe('c1')
    expect(c.evidence.map(e => e.role)).toEqual(['Where you said it', 'Where it seems to differ'])
    expect(c.evidence.map(e => e.id)).toEqual(['s1', 's2'])
  })

  it('only sharp or notable, only when both decisions still exist and differ, and never an empty reading', () => {
    expect(buildContradictionInsight([stored({ severity: 'forming' })], sessions)).toBeNull()
    expect(buildContradictionInsight([stored({ severity: null })], sessions)).toBeNull()
    expect(buildContradictionInsight([stored({ violation_session_id: 's1' })], sessions)).toBeNull()      // same decision twice
    expect(buildContradictionInsight([stored({ violation_session_id: 'gone' })], sessions)).toBeNull()    // a decision was deleted
    expect(buildContradictionInsight([stored({ principle_session_id: null })], sessions)).toBeNull()
    expect(buildContradictionInsight([stored({ principle_text: '  ' })], sessions)).toBeNull()
    expect(buildContradictionInsight([], sessions)).toBeNull()
  })

  it('shows one: the sharpest, then the most recent', () => {
    const list = [
      stored({ id: 'a', severity: 'notable', generated_at: iso(1) }),
      stored({ id: 'b', severity: 'sharp', generated_at: iso(9), violation_session_id: 's3' }),
      stored({ id: 'c', severity: 'sharp', generated_at: iso(4), violation_session_id: 's3' }),
    ]
    expect(buildContradictionInsight(list, sessions)!.dismissId).toBe('c')
  })

  it('it is never part of the anonymous form: the pure builder does not make one, and the route adds it only for the signed-in owner', () => {
    const rows = Array.from({ length: 6 }, (_, i) => row({ optimization_priority: 'money', created_at: iso(i + 1) }))
    const all = buildInsights(rows, { now: NOW, withEvidence: false })
    expect([...all.learned, ...all.watch].some(i => i.kind === 'contradiction')).toBe(false)
    const route = src('app/api/mirror/overview/route.ts')
    const owner = route.indexOf('loadStoredContradictions(supabase, user.id)')
    expect(owner).toBeGreaterThan(-1)
    expect(owner).toBeLessThan(route.indexOf("const sid = url.searchParams.get('sid')"))
    expect(route.slice(route.indexOf("const sid = url.searchParams.get('sid')"))).not.toMatch(/contradiction/i)
  })

  it('it adds no detection: no model call, results read from what the existing pipeline stored, dismissed ones excluded', () => {
    const d = src('lib/decision-history.ts')
    const loader = d.slice(d.indexOf('export async function loadStoredContradictions'))
    expect(loader).toContain(".from('contradictions')")
    expect(loader).toContain(".is('dismissed_at', null)")
    expect(loader).toContain(".eq('user_id', userId)")
    expect(stripAllComments(loader)).not.toMatch(/detectContradictions|createCompletion|anthropic/i)
    expect(stripAllComments(src('app/api/mirror/overview/route.ts'))).not.toMatch(/detectContradictions|createCompletion|anthropic/i)
  })

  it('"That\'s not right" uses the existing dismiss endpoint, which needs only the signed-in owner, and is tracked', () => {
    const c = src('components/MirrorOverview.tsx')
    expect(c).toContain('/api/mirror/contradictions?id=${encodeURIComponent(insight.dismissId)}')
    expect(c).toContain("method: 'DELETE'")
    expect(c).toContain("track('mirror_insight_dismissed', { kind: insight.kind, surface })")
    expect(c).toContain("reading: 'Quorum’s reading'")
    // the dismiss handler of the existing route has no paywall check
    const del = src('app/api/mirror/contradictions/route.ts')
    const handler = del.slice(del.indexOf('export async function DELETE'))
    expect(handler).not.toContain('getMirrorAccessState')
    expect(handler).toContain(".eq('user_id', userId)")
  })
})

// ── 4. The reason behind each email ask ─────────────────────────────────────────────────────────────────────────────────
describe('4. Where should Quorum reach you? Asked at the moment it has a use, in plain words, never as a toll', () => {
  it('each reason says what the email is for, ends on the question, and makes no claim the product cannot keep', () => {
    expect(Object.keys(CONNECT_REASON_LINES).sort()).toEqual(['check_in_due', 'compare', 'open_decision'])
    for (const line of Object.values(CONNECT_REASON_LINES)) {
      expect(line).toMatch(/Where should it reach you\?$/)
      expect(line).not.toMatch(UNVERIFIED_CLAIM)
      expect(line).not.toMatch(/\bknows? you\b|\bunderstands? you\b|\bpredicts?\b/i)
    }
    expect(CONNECT_REASON_LINES.compare).toMatch(/only if it can tell they are yours/)
  })

  it('an explicit lead still wins, then the reason, then the earlier default', () => {
    const c = src('components/ConnectCard.tsx')
    expect(c).toContain("? (lead || (reason ? CONNECT_REASON_LINES[reason] : 'Keep your record connected")
    expect(c).toContain('(lead || reason) && !formattedDate')
    expect(c).toContain('reason: reason ?? null')
  })

  it('it is asked after "not ready to decide", on a due check-in for someone Quorum cannot reach, and after a second or later decision', () => {
    expect(src('components/PredictionReveal.tsx')).toContain('<ConnectCard mode="d1_soft" surface="commit_deferred" reason="open_decision" sessionId={sessionId} />')
    const desk = src('components/DecisionDesk.tsx')
    expect(desk).toContain('{!signedIn && model.due.length > 0 && (')
    expect(desk).toContain('<ConnectCard mode="d1_soft" surface="desk_due" reason="check_in_due" />')
    expect(src('components/ChatIntake.tsx')).toContain('<DeskTop model={deskModel} signedIn={!!authToken || hasEmail} />')
    expect(src('components/NextDecisionPrompt.tsx')).toContain("reason={count >= 2 ? 'compare' : undefined}")
  })

  it('it is never a requirement: the card keeps its "Not now" cooldown and hides itself for anyone signed in', () => {
    const c = src('components/ConnectCard.tsx')
    expect(c).toContain('const skippable = mode !== \'d3_gate\' && mode !== \'convene_gate\'')
    expect(c).toContain("const DISMISS_HOURS = 72")
    expect(c).toContain("if (cancelled || auth.Authorization) return")
    // soft modes only: none of the new moments uses a gate mode
    for (const f of ['components/DecisionDesk.tsx', 'components/PredictionReveal.tsx']) expect(src(f)).not.toMatch(/mode="(d3_gate|convene_gate)"/)
  })

  it('no endpoint was added that accepts an unverified email: linking stays on the existing verified path', () => {
    // there is no new route that writes user_email; verification stays with the magic link / Google
    const dirs = ['app/api/session/[id]/left-out/route.ts', 'app/api/mirror/overview/route.ts']
    for (const f of dirs) expect(stripAllComments(src(f))).not.toMatch(/user_email\s*:|\.update\(\s*\{[^}]*user_email/)
  })
})

// ── 5. The Mirror for people who are not signed in ─────────────────────────────────────────────────────────────────────
describe('5. /mirror is not a blank wall: a first look first, the ask to keep it second', () => {
  const page = src('app/mirror/page.tsx')
  it('signed out, the page shows the preview and then the ask, in that order', () => {
    expect(page).toContain("{status.gateState === 'auth'     && isMirrorPreviewEnabled() && <AnonymousMirrorPreview />}")
    expect(page).toContain("{status.gateState === 'auth'     && <AuthGate preview={isMirrorPreviewEnabled()} />}")
    expect(page.indexOf('<AnonymousMirrorPreview />')).toBeLessThan(page.indexOf('<AuthGate preview={isMirrorPreviewEnabled()} />'))
    expect(page).toContain('function AuthGate({ preview = false }: { preview?: boolean })')
    expect(page).toContain('Keep this, and see what it rests on')
  })
  it('with decisions on this browser it shows the real overview in its anonymous form; with none it explains and asks for nothing', () => {
    const p = src('components/AnonymousMirrorPreview.tsx')
    expect(p).toContain('getStoredSessionIds()')
    expect(p).toContain('<MirrorOverview sessionId={latest} surface="mirror" />')
    expect(stripAllComments(p)).not.toMatch(/authToken/)                   // session mode only: counts and claims, no decisions
    expect(p).toContain('Nothing here needs an account.')
    expect(p).toContain('The Mirror answers three questions about how you decide:')
    expect(p).toContain('It says nothing from one decision')
    expect(p).toContain('<Link href="/q"')
  })
  it('it reads storage (always permitted) and writes none, so no consent is bypassed', () => {
    const p = stripAllComments(src('components/AnonymousMirrorPreview.tsx'))
    expect(p).not.toMatch(/localStorage|sessionStorage|pushSessionId|getOrCreateDeviceId|setItem/)
  })
  it('what stays behind a linked email is said plainly in the preview, not hidden', () => {
    const p = src('components/AnonymousMirrorPreview.tsx')
    expect(p).toContain('which decisions each point rests on')
    expect(src('components/MirrorOverview.tsx')).toContain('Sign in to see which ones.')
  })
  it('the Desk\'s link now says what it opens, and the new event is registered', () => {
    expect(src('components/DecisionDesk.tsx')).toContain("'See a first look at your Mirror'")
    for (const f of ['lib/track.ts', 'app/api/events/route.ts', 'lib/event-props.ts']) {
      expect(src(f)).toContain("'mirror_preview_viewed'")
      expect(src(f)).toContain("'mirror_insight_dismissed'")
    }
  })
})

describe('6. Off switches: each new surface can be turned off without a code change', () => {
  it('the left-out card and the contradiction reading switch off at runtime; the anonymous preview switches off at build', async () => {
    expect(src('app/api/session/[id]/left-out/route.ts')).toContain("process.env.LEFT_OUT_CARD === 'off'")
    expect(src('app/api/mirror/overview/route.ts')).toContain("process.env.MIRROR_OVERVIEW_CONTRADICTIONS === 'off'")
    const { isMirrorPreviewEnabled } = await import('@/lib/feature-flags')
    const saved = process.env.NEXT_PUBLIC_MIRROR_PREVIEW
    try {
      delete process.env.NEXT_PUBLIC_MIRROR_PREVIEW
      expect(isMirrorPreviewEnabled()).toBe(true)
      process.env.NEXT_PUBLIC_MIRROR_PREVIEW = 'off'
      expect(isMirrorPreviewEnabled()).toBe(false)
      process.env.NEXT_PUBLIC_MIRROR_PREVIEW = 'false'
      expect(isMirrorPreviewEnabled()).toBe(false)
    } finally { if (saved === undefined) delete process.env.NEXT_PUBLIC_MIRROR_PREVIEW; else process.env.NEXT_PUBLIC_MIRROR_PREVIEW = saved }
  })
})
