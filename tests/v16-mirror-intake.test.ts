// tests/v16-mirror-intake.test.ts
// v16 (Nov 2026), Phases 4 and 5: the Mirror as three questions, a lighter retrieval tier, and the intake fast path.
// Pure logic runs the real code; wiring tests read the source, like the earlier journey tests.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  buildInsights, confidenceFor, confidenceNote, emptyOverviewLine,
  MAX_NEXT_STEPS, MIN_INSTINCT_STRENGTH, MIN_REPEAT_SHARE,
} from '@/lib/mirror-insights'
import type { InsightRow } from '@/lib/mirror-insights'
import { earlyContextNote, isEarlyRetrieval, retrievalPlan } from '@/lib/structural-retrieval'
import {
  INTAKE_FLOW_VERSION, INTAKE_FLOW_VERSION_FAST, assignFlowVersion, ceilingFor, criticalOpen, deferrableOpen,
  isFastFlow, parseIntakeFastMode, slotRole,
} from '@/lib/chat-intake-depth'
import { slotsFor } from '@/lib/chat-intake-brief'
import type { ChatDecisionState } from '@/lib/types'
import { sanitizeIntakeProps } from '@/lib/event-props'

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const stripAllComments = (code: string) => code.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

const NOW = new Date(2026, 10, 21, 12, 0, 0)
const iso = (daysAgo: number) => new Date(2026, 10, 21 - daysAgo, 9, 0, 0).toISOString()
const ymd = (offset: number) => { const d = new Date(2026, 10, 21 + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
let seq = 0
const row = (over: Partial<InsightRow> = {}): InsightRow => ({
  id: `r${++seq}`, created_at: iso(5), optimization_priority: null, initial_instinct: null, final_decision_plain: null,
  prediction_matched_final: null, decision_snippet: `Decision ${seq}`, session_depth: null, locked: false, review_date: null, has_outcome: false,
  ...over,
})

describe('1. Mirror insights (lib/mirror-insights.ts): only what the record supports', () => {
  it('nothing from zero or one decision, and the empty line says what would change that', () => {
    expect(buildInsights([], { now: NOW }).learned).toHaveLength(0)
    expect(buildInsights([row({ optimization_priority: 'money' })], { now: NOW }).learned).toHaveLength(0)
    expect(emptyOverviewLine(0)).toMatch(/first decision/)
    expect(emptyOverviewLine(1)).toMatch(/second/)
    expect(emptyOverviewLine(4)).toMatch(/Nothing here is solid enough/)
  })

  it('confidence never reaches "established" below five decisions, and says how thin early evidence is', () => {
    expect(confidenceFor(2, 1)).toBe('early')
    expect(confidenceFor(3, 1)).toBe('emerging')
    expect(confidenceFor(4, 1)).toBe('emerging')
    expect(confidenceFor(5, 0.59)).toBe('emerging')
    expect(confidenceFor(5, 0.6)).toBe('established')
    for (let n = 0; n < 5; n++) expect(confidenceFor(n, 1)).not.toBe('established')
    expect(confidenceNote('early', 2)).toMatch(/only 2 decisions/)
    expect(confidenceNote('emerging', 3)).toMatch(/Not yet proven/)
    expect(confidenceNote('fact', 1)).toMatch(/not a pattern/)
  })

  it('a repeated priority is shown only when it is a majority, with the decisions behind it', () => {
    const mk = (prios: string[]) => prios.map((p, i) => row({ optimization_priority: p, created_at: iso(i + 1) }))
    // 2 of 8: a coincidence, not a pattern -> not shown
    const weak = buildInsights(mk(['money', 'money', 'time', 'family', 'health', 'growth', 'risk', 'freedom']), { now: NOW })
    expect(weak.learned.find(i => i.kind === 'priority_repeat')).toBeUndefined()
    // 3 of 4: shown, emerging, evidence = the 3 decisions that named it
    const rows = mk(['money', 'money', 'money', 'time'])
    const strong = buildInsights(rows, { now: NOW })
    const pr = strong.learned.find(i => i.kind === 'priority_repeat')!
    expect(pr).toBeDefined()
    expect(MIN_REPEAT_SHARE).toBe(0.5)
    expect(pr.confidence).toBe('emerging')
    expect(pr.evidenceCount).toBe(3)
    expect(pr.evidence).toHaveLength(3)
    expect(pr.evidence.every(e => rows.some(r => r.id === e.id && r.optimization_priority === 'money'))).toBe(true)
    expect(pr.nextTime).toMatch(/Next time/)
  })

  it('"both times" on only two decisions is labelled early', () => {
    const two = buildInsights([row({ optimization_priority: 'money', created_at: iso(1) }), row({ optimization_priority: 'money', created_at: iso(2) })], { now: NOW })
    const pr = two.learned.find(i => i.kind === 'priority_repeat')!
    expect(pr.claim).toMatch(/Both times/)
    expect(pr.confidence).toBe('early')
  })

  it('an instinct split must be lopsided to be shown; direction decides the suggestion', () => {
    const mk = (flags: boolean[]) => flags.map((f, i) => row({ initial_instinct: 'accept', final_decision_plain: f ? 'Yes, do it' : 'No, reject it', created_at: iso(i + 1) }))
    expect(MIN_INSTINCT_STRENGTH).toBe(0.5)
    expect(buildInsights(mk([true, true, false]), { now: NOW }).learned.find(i => i.kind === 'instinct_follow')).toBeUndefined()   // 2 of 3: too close
    const followed = buildInsights(mk([true, true, true]), { now: NOW }).learned.find(i => i.kind === 'instinct_follow')!
    expect(followed.claim).toMatch(/first instinct/)
    expect(followed.nextTime).toMatch(/wrong/)
    const overrode = buildInsights(mk([false, false, false, true]), { now: NOW }).learned.find(i => i.kind === 'instinct_follow')!
    expect(overrode.nextTime).toMatch(/changed your mind/)
  })

  it('Quorum\'s prediction record is shown as about Quorum, with no suggestion attached', () => {
    const rows = [true, true, false].map((m, i) => row({ prediction_matched_final: m, created_at: iso(i + 1) }))
    const p = buildInsights(rows, { now: NOW }).learned.find(i => i.kind === 'prediction')!
    expect(p.claim).toMatch(/guessed right 2 of 3/)
    expect(p.confidenceNote).toMatch(/not a verdict on you/)
    expect(p.nextTime).toBeNull()
  })

  it('"never committed to" needs two or more examined decisions, old enough, with no outcome or lock', () => {
    const examined = (over: Partial<InsightRow>) => row({ session_depth: 'council', created_at: iso(6), ...over })
    const some = buildInsights([examined({}), examined({}), examined({ locked: true })], { now: NOW }).watch.find(i => i.kind === 'uncommitted')!
    expect(some.claim).toBe('2 of your 3 examined decisions were never committed to.')
    expect(some.evidenceCount).toBe(2)
    // one is not a pattern
    expect(buildInsights([examined({}), examined({ locked: true }), examined({ locked: true })], { now: NOW }).watch.find(i => i.kind === 'uncommitted')).toBeUndefined()
    // examined today is not "never committed to" yet
    expect(buildInsights([examined({ created_at: iso(0) }), examined({ created_at: iso(0) })], { now: NOW }).watch.find(i => i.kind === 'uncommitted')).toBeUndefined()
    // an outcome means it was closed
    expect(buildInsights([examined({ has_outcome: true }), examined({ has_outcome: true })], { now: NOW }).watch.find(i => i.kind === 'uncommitted')).toBeUndefined()
  })

  it('a check-in waiting is a plain fact, only when the date has arrived and no outcome is recorded', () => {
    const due = buildInsights([row({ review_date: ymd(-3) }), row({ review_date: ymd(0) }), row({ review_date: ymd(5) }), row({ review_date: ymd(-9), has_outcome: true })], { now: NOW })
    const w = due.watch.find(i => i.kind === 'checkins_due')!
    expect(w.confidence).toBe('fact')
    expect(w.claim).toBe('2 check-ins you set are waiting for you to record how they went.')
    expect(w.evidenceCount).toBe(2)
    expect(buildInsights([row({ review_date: ymd(4) })], { now: NOW }).watch).toHaveLength(0)
  })

  it('"what to try next" is capped, and every step comes from an insight that is actually shown', () => {
    const rows = [
      row({ optimization_priority: 'money', initial_instinct: 'accept', final_decision_plain: 'Yes', session_depth: 'council', created_at: iso(10), review_date: ymd(-2) }),
      row({ optimization_priority: 'money', initial_instinct: 'accept', final_decision_plain: 'Yes', session_depth: 'council', created_at: iso(9) }),
      row({ optimization_priority: 'money', initial_instinct: 'accept', final_decision_plain: 'Yes', session_depth: 'council', created_at: iso(8) }),
    ]
    const o = buildInsights(rows, { now: NOW })
    expect(o.next.length).toBeLessThanOrEqual(MAX_NEXT_STEPS)
    const ids = new Set([...o.learned, ...o.watch].map(i => i.id))
    for (const n of o.next) { expect(ids.has(n.fromInsightId)).toBe(true); expect(n.text.length).toBeGreaterThan(10) }
  })

  it('the anonymous form carries counts and claims but no decision text and no ids', () => {
    const rows = [1, 2, 3].map(i => row({ optimization_priority: 'money', created_at: iso(i), decision_snippet: 'A private thing about my cofounder' }))
    const anon = buildInsights(rows, { now: NOW, withEvidence: false })
    const pr = anon.learned.find(i => i.kind === 'priority_repeat')!
    expect(pr.evidenceCount).toBe(3)
    expect(pr.evidence).toEqual([])
    expect(JSON.stringify(anon)).not.toMatch(/cofounder|r\d+"/)
  })

  it('no insight text describes personality, motive or what kind of person someone is', () => {
    const rows = [
      row({ optimization_priority: 'money', initial_instinct: 'accept', final_decision_plain: 'Yes', prediction_matched_final: true, session_depth: 'council', created_at: iso(12), review_date: ymd(-4) }),
      row({ optimization_priority: 'money', initial_instinct: 'accept', final_decision_plain: 'Yes', prediction_matched_final: true, session_depth: 'council', created_at: iso(11) }),
      row({ optimization_priority: 'money', initial_instinct: 'accept', final_decision_plain: 'Yes', prediction_matched_final: false, session_depth: 'council', created_at: iso(10) }),
      row({ optimization_priority: 'time', initial_instinct: 'accept', final_decision_plain: 'Yes', session_depth: 'council', created_at: iso(9) }),
      row({ optimization_priority: 'money', initial_instinct: 'accept', final_decision_plain: 'Yes', session_depth: 'council', created_at: iso(8) }),
    ]
    const o = buildInsights(rows, { now: NOW })
    const all = JSON.stringify(o)
    expect(all).not.toMatch(/personality|type of person|kind of person|you are (a|an|the)\b|you tend to be|deep down|subconscious|your fear|you avoid because/i)
    // established is possible here (5 decisions, a clear majority) and says so plainly
    expect(o.learned.some(i => i.confidence === 'established')).toBe(true)
  })
})

describe('2. Retrieval: a light tier for the second decision, the full tier unchanged', () => {
  const env = (o: Record<string, string> = {}) => o
  it('none with no past session, light from the first, full from five', () => {
    expect(retrievalPlan(0, env()).mode).toBe('none')
    expect(retrievalPlan(1, env()).mode).toBe('light')
    expect(retrievalPlan(4, env()).mode).toBe('light')
    expect(retrievalPlan(5, env())).toEqual({ mode: 'full', threshold: 45, maxMatches: 2 })
    expect(retrievalPlan(40, env()).mode).toBe('full')
  })
  it('the light tier is stricter than the full tier: higher bar, one match', () => {
    expect(retrievalPlan(2, env())).toEqual({ mode: 'light', threshold: 60, maxMatches: 1 })
  })
  it('the light bar can be raised but never set below the full bar', () => {
    expect(retrievalPlan(2, env({ STRUCTURAL_LIGHT_MATCH_THRESHOLD: '70' })).threshold).toBe(70)
    expect(retrievalPlan(2, env({ STRUCTURAL_LIGHT_MATCH_THRESHOLD: '20' })).threshold).toBe(45)
    expect(retrievalPlan(2, env({ MATCH_THRESHOLD: '65', STRUCTURAL_LIGHT_MATCH_THRESHOLD: '60' })).threshold).toBe(65)
  })
  it('STRUCTURAL_LIGHT_MIN_SESSIONS=0 switches the light tier off and restores the old behaviour exactly', () => {
    for (let n = 0; n < 5; n++) expect(retrievalPlan(n, env({ STRUCTURAL_LIGHT_MIN_SESSIONS: '0' })).mode).toBe('none')
    expect(retrievalPlan(5, env({ STRUCTURAL_LIGHT_MIN_SESSIONS: '0' })).mode).toBe('full')
  })
  it('an operator who already lowered MIN_SESSIONS keeps that behaviour', () => {
    expect(retrievalPlan(2, env({ MIN_SESSIONS: '2' })).mode).toBe('full')
  })
  it('isEarlyRetrieval is true only for the light tier', () => {
    expect(isEarlyRetrieval(0, env())).toBe(false)
    expect(isEarlyRetrieval(3, env())).toBe(true)
    expect(isEarlyRetrieval(5, env())).toBe(false)
  })
  it('the advisors are told it is one comparison, not a pattern', () => {
    const note = earlyContextNote(1)
    expect(note).toMatch(/only 1 earlier decision on record/)
    expect(note).toMatch(/single comparison, not a pattern/)
    expect(note).toMatch(/do not generalise/i)
    expect(earlyContextNote(3)).toMatch(/only 3 earlier decisions/)
  })
  it('the light tier is wired into retrieval, the route and the banner', () => {
    const r = src('lib/structural-retrieval.ts')
    expect(r).toContain('const plan = retrievalPlan(pastSnapshots.length)')
    expect(r).toContain("(plan.mode === 'light' ? earlyContextNote(pastSnapshots.length) : '')")
    expect(r).toContain('early:              plan.mode === \'light\'')
    const route = src('app/api/structural-match/route.ts')
    expect(route).toContain('early_match:        !!cached.threshold_met && isEarlyRetrieval(cached.session_count_used ?? 0)')
    expect(route).toContain('early_match:        result.early === true')
    expect(src('components/SessionView.tsx')).toContain('setStructuralEarly(data.early_match === true)')
    const pp = src('components/PersonaPanel.tsx')
    expect(pp).toContain("{structuralEarly ? 'Early comparison' : 'Structural echo'}")
    expect(pp).toContain('One comparison, not a pattern.')
  })
})

describe('3. Intake fast path: shorter, never blind', () => {
  const state = (over: Partial<ChatDecisionState> = {}): ChatDecisionState =>
    ({ decisionKind: 'financial', stakes: 'medium', ...over } as ChatDecisionState)
  const fast = (over: Partial<ChatDecisionState> = {}) => state({ flowVersion: INTAKE_FLOW_VERSION_FAST, ...over })

  it('INTAKE_FAST_MODE parses safely: anything unknown is off', () => {
    expect(parseIntakeFastMode(undefined)).toBe('off')
    expect(parseIntakeFastMode('')).toBe('off')
    expect(parseIntakeFastMode('true')).toBe('off')
    expect(parseIntakeFastMode('FAST')).toBe('fast')
    expect(parseIntakeFastMode(' experiment ')).toBe('experiment')
  })

  it('off keeps everyone on today\'s flow; fast puts everyone on the fast path', () => {
    expect(assignFlowVersion('off', 'device-abcdefgh')).toBe(INTAKE_FLOW_VERSION)
    expect(assignFlowVersion('fast', null)).toBe(INTAKE_FLOW_VERSION_FAST)
  })

  it('experiment: the same device always gets the same arm, both arms are reachable, and no device id means random', () => {
    const a = assignFlowVersion('experiment', 'device-abcdefgh')
    for (let i = 0; i < 20; i++) expect(assignFlowVersion('experiment', 'device-abcdefgh')).toBe(a)
    const arms = new Set(Array.from({ length: 60 }, (_, i) => assignFlowVersion('experiment', `device-id-number-${i}`)))
    expect(arms).toEqual(new Set([INTAKE_FLOW_VERSION, INTAKE_FLOW_VERSION_FAST]))
    expect(assignFlowVersion('experiment', null, () => 0.1)).toBe(INTAKE_FLOW_VERSION_FAST)
    expect(assignFlowVersion('experiment', null, () => 0.9)).toBe(INTAKE_FLOW_VERSION)
    expect(assignFlowVersion('experiment', 'short', () => 0.9)).toBe(INTAKE_FLOW_VERSION)   // too short to be a real device id
  })

  it('ceilings: 3 / 4 / 5 on the fast path, 5 / 7 / 9 otherwise, and "Let me add more" restores the standard ceilings', () => {
    expect(ceilingFor(state({ stakes: 'low' }), 9)).toBe(5)
    expect(ceilingFor(state({ stakes: 'medium' }), 9)).toBe(7)
    expect(ceilingFor(state({ stakes: 'high' }), 9)).toBe(9)
    expect(ceilingFor(fast({ stakes: 'low' }), 9)).toBe(3)
    expect(ceilingFor(fast({ stakes: 'medium' }), 9)).toBe(4)
    expect(ceilingFor(fast({ stakes: 'high' }), 9)).toBe(5)
    expect(ceilingFor(fast({ stakes: 'medium' }), 9, true)).toBe(7)
    expect(ceilingFor(fast({ stakes: 'high', reversibility: 'irreversible' }), 9)).toBe(5)
  })

  it('a chat with no flowVersion behaves exactly as before (old chats in flight are unaffected)', () => {
    expect(isFastFlow(state())).toBe(false)
    expect(isFastFlow({ flowVersion: undefined })).toBe(false)
    expect(isFastFlow({ flowVersion: INTAKE_FLOW_VERSION })).toBe(false)
  })

  it('fast defers the lower-weight required slots at medium stakes; the standard flow asks them', () => {
    const slots = slotsFor('financial' as any)
    const alt = slots.find(s => s.key === 'alternatives')!, cons = slots.find(s => s.key === 'constraints')!, what = slots.find(s => s.key === 'what')!
    expect(alt.weight).toBe(65); expect(cons.weight).toBe(55)
    // standard, medium stakes: everything required is critical
    for (const sl of [alt, cons, what]) expect(slotRole(state(), sl)).toBe('critical')
    // fast, medium stakes: below 70 may be left to the Council; the high-weight slot is still asked
    expect(slotRole(fast(), alt)).toBe('deferrable')
    expect(slotRole(fast(), cons)).toBe('deferrable')
    expect(slotRole(fast(), what)).toBe('critical')
    expect(criticalOpen(fast()).map(s => s.key)).toEqual(['what', 'why_now'])
    expect(deferrableOpen(fast()).map(s => s.key).sort()).toEqual(['alternatives', 'constraints'])
  })

  it('at high stakes the fast path is more careful: only slots below 60 are left to the Council', () => {
    const slots = slotsFor('financial' as any)
    const alt = slots.find(s => s.key === 'alternatives')!, cons = slots.find(s => s.key === 'constraints')!
    expect(slotRole(fast({ stakes: 'high' }), alt)).toBe('critical')       // 65 >= 60
    expect(slotRole(fast({ stakes: 'high' }), cons)).toBe('deferrable')    // 55 < 60
  })

  it('what the person\'s own situation makes material is still asked on the fast path', () => {
    const runway = slotsFor('career_exit' as any).find(s => s.key === 'runway')!
    const leaving = fast({ decisionKind: 'career_exit' as any, stakes: 'medium', decisionStatement: 'Should I quit my job and go full-time on my own startup?' })
    expect(slotRole(leaving, runway)).toBe('critical')     // income at risk: never deferred
  })

  it('wiring: the server decides the arm once, from a runtime env var, and the client tags every event with it', () => {
    const route = src('app/api/chat-intake/route.ts')
    expect(route).toContain("assignFlowVersion(parseIntakeFastMode(process.env.INTAKE_FAST_MODE), deviceId)")
    expect(route).toContain('flowVersion: priorState?.flowVersion ??')
    expect(route).toContain('!!extraExchanges)')
    expect(route).not.toMatch(/NEXT_PUBLIC_INTAKE/)          // runtime only: no rebuild to change it
    const ci = src('components/ChatIntake.tsx')
    expect(ci).toContain('const flowVersionRef = useRef<string>(INTAKE_FLOW_VERSION)')
    expect(ci).toContain("if (typeof data?.flowVersion === 'string') flowVersionRef.current = data.flowVersion")
    expect(stripAllComments(ci)).not.toMatch(/flow_version:\s*INTAKE_FLOW_VERSION\b/)
  })
})

describe('4. The Mirror overview: wired, free of the paywall, and careful about who sees what', () => {
  const route = src('app/api/mirror/overview/route.ts')
  it('the signed-in owner gets the decisions behind each insight; an anonymous session gets counts only', () => {
    expect(route).toContain("{ limit: 12, withSnippets: true }")
    expect(route).toContain("buildInsights(rows, { withEvidence: true })")
    expect(route).toContain("{ limit: 12, withSnippets: false }")
    expect(route).toContain("buildInsights(rows, { withEvidence: false })")
  })
  it('it is not behind the Mirror paywall and makes no model call', () => {
    const code = stripAllComments(route)
    expect(code).not.toMatch(/getMirrorAccessState|mirror_access|anthropic|openai|mistral|fetch\(/i)
  })
  it('a failed lookup degrades to an empty overview, never an error page or a guess', () => {
    expect(route).toContain("const EMPTY: MirrorOverviewData = { decisionCount: 0, learned: [], watch: [], next: [] }")
    expect(route).toContain('catch (err)')
    expect(src('lib/decision-history.ts')).toContain('has_outcome:              outcomesKnown ? outcomeIds.has(r.id as string) : true')
  })
  it('the Mirror page shows it to everyone signed in, above the existing sections; the Desk shows one compact insight', () => {
    const m = src('app/mirror/page.tsx')
    expect(m).toContain("{status.gateState !== 'auth' && (")
    expect(m).toContain('<MirrorOverview authToken={authToken} deviceId={getStoredDeviceId()} surface="mirror" hasDetail={status.gateState === \'unlocked\'} />')
    expect(m.indexOf('<MirrorOverview')).toBeLessThan(m.indexOf("status.gateState === 'locked'   && ("))
    const d = src('components/DecisionDesk.tsx')
    expect(d).toContain('<MirrorOverview sessionId={latestId} surface="desk" compact signedIn={signedIn} />')
    expect(stripAllComments(d)).not.toMatch(/authToken/)
  })
  it('the component adds no claims of its own, states empty honestly, and labels early evidence', () => {
    const c = stripAllComments(src('components/MirrorOverview.tsx'))
    expect(c).toContain('emptyOverviewLine(data.decisionCount)')
    expect(c).toContain("early: 'Early'")
    expect(c).toContain('Sign in to see which ones.')
    expect(c).not.toMatch(/\bknows? you\b|\bunderstands? you\b|\bpredicts? (you|your)\b/i)
  })
  it('the new events are registered and survive the privacy guard with counts and labels only', () => {
    for (const f of ['lib/track.ts', 'app/api/events/route.ts', 'lib/event-props.ts']) {
      expect(src(f)).toContain("'mirror_overview_viewed'")
      expect(src(f)).toContain("'mirror_insight_expanded'")
    }
    const v = sanitizeIntakeProps('mirror_overview_viewed', { surface: 'mirror', total_count: 4, learned_count: 2, watch_count: 1, mode: 'owner', claim: 'You put money first in 3 of 4' })
    expect(v).toMatchObject({ surface: 'mirror', total_count: 4, learned_count: 2, watch_count: 1, mode: 'owner' })
    expect(v).not.toHaveProperty('claim')
    const x = sanitizeIntakeProps('mirror_insight_expanded', { kind: 'priority_repeat', confidence: 'emerging', surface: 'mirror' })
    expect(x).toMatchObject({ kind: 'priority_repeat', confidence: 'emerging', surface: 'mirror' })
  })
})
