// tests/v15-journey.test.ts
// v15 (Nov 2026), Phases 1-3: close the loop, the Decision Desk, the front door.
// Pure-logic tests run the real code; wiring tests read the source, the same way the earlier journey tests do.

import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildDesk, classifyDeskSession, daysUntilReview, deskHeadline, formatWhen, recordStage } from '@/lib/desk'
import type { DeskSession } from '@/lib/desk'
import { sanitizeIntakeProps } from '@/lib/event-props'
import { isDeskEnabled, isFrontDoorV15Enabled, isLockOptionalEnabled, isLockRequired } from '@/lib/feature-flags'

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const withoutComments = (code: string) => code.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/.*$/gm, '')
// Also strips /* ... */ and /** ... */ blocks, so a doc comment that says "overdue" is not mistaken for user-facing copy.
const stripAllComments = (code: string) => withoutComments(code).replace(/\/\*[\s\S]*?\*\//g, '')
const UNVERIFIED_CLAIM = /\b(free|no\s*sign-?\s*up|no\s*signup|no\s*account|without\s+(an\s+)?account|\d+\s*(min|minute|minutes|sec|seconds)\b|in\s+minutes|instant(ly)?|guarantee[sd]?)\b/i

// A fixed "now" (local noon, 20 Nov 2026) so day arithmetic is deterministic.
const NOW = new Date(2026, 10, 20, 12, 0, 0)
const day = (offset: number) => {
  const d = new Date(2026, 10, 20 + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const mk = (id: string, over: Partial<DeskSession> = {}): DeskSession => ({
  id, decision_text: `Decision ${id}`, created_at: `2026-11-${String(10 + Number(id.replace(/\D/g, '') || 0)).padStart(2, '0')}T10:00:00Z`,
  status: 'active', session_depth: null, final_decision_locked_at: null, commitment_review_date: null, outcome: null, ...over,
})

describe('1. Decision Desk model (lib/desk.ts)', () => {
  it('daysUntilReview counts local calendar days and rejects bad input', () => {
    expect(daysUntilReview(day(0), NOW)).toBe(0)
    expect(daysUntilReview(day(1), NOW)).toBe(1)
    expect(daysUntilReview(day(-3), NOW)).toBe(-3)
    expect(daysUntilReview(null, NOW)).toBeNull()
    expect(daysUntilReview('', NOW)).toBeNull()
    expect(daysUntilReview('not-a-date', NOW)).toBeNull()
    // an ISO timestamp is accepted for its date part
    expect(daysUntilReview(`${day(2)}T09:00:00Z`, NOW)).toBe(2)
  })

  it('classifies each state from fields that already exist on sessions', () => {
    expect(classifyDeskSession(mk('1', { commitment_review_date: day(-2) }), NOW).kind).toBe('due')
    expect(classifyDeskSession(mk('1', { commitment_review_date: day(0) }), NOW).kind).toBe('due')       // today counts as due
    expect(classifyDeskSession(mk('1', { commitment_review_date: day(5), final_decision_locked_at: 'x' }), NOW).kind).toBe('waiting')
    expect(classifyDeskSession(mk('1', { final_decision_locked_at: 'x' }), NOW).kind).toBe('waiting')    // decided, no date chosen
    expect(classifyDeskSession(mk('1', { session_depth: 'council' }), NOW).kind).toBe('open')            // examined, not decided
    expect(classifyDeskSession(mk('1', { session_depth: 'checkpoint', status: 'completed' }), NOW).kind).toBe('unexamined')
    expect(classifyDeskSession(mk('1'), NOW).kind).toBe('unexamined')
  })

  it('an outcome closes a decision even when its review date has passed', () => {
    const closed = classifyDeskSession(mk('1', { commitment_review_date: day(-9), outcome: { council_helped: 'yes', what_decided: 'x' } }), NOW)
    expect(closed.kind).toBe('closed')
  })

  it('orders groups: most overdue first, soonest check-in first, newest first for the rest', () => {
    const m = buildDesk([
      mk('1', { commitment_review_date: day(-1) }),
      mk('2', { commitment_review_date: day(-5) }),
      mk('3', { commitment_review_date: day(9), final_decision_locked_at: 'x' }),
      mk('4', { commitment_review_date: day(2), final_decision_locked_at: 'x' }),
      mk('5', { session_depth: 'council' }),
      mk('6', { session_depth: 'council' }),
    ], NOW)
    expect(m.due.map(i => i.session.id)).toEqual(['2', '1'])
    expect(m.waiting.map(i => i.session.id)).toEqual(['4', '3'])
    expect(m.open.map(i => i.session.id)).toEqual(['6', '5'])
    expect(m.total).toBe(6)
    expect(m.hasActive).toBe(true)
  })

  it('a record that is all closed has nothing active', () => {
    const m = buildDesk([mk('1', { outcome: { council_helped: 'yes', what_decided: 'x' } })], NOW)
    expect(m.hasActive).toBe(false)
    expect(deskHeadline(m, NOW)).toBe('Nothing open. Bring a decision when you have one.')
  })

  it('the headline puts what needs the person first and never invents urgency', () => {
    const due = buildDesk([mk('1', { commitment_review_date: day(-1) })], NOW)
    expect(deskHeadline(due, NOW)).toMatch(/ready for its check-in/)
    const open = buildDesk([mk('1', { session_depth: 'council' })], NOW)
    expect(deskHeadline(open, NOW)).toMatch(/examined but not decided/)
    const waiting = buildDesk([mk('1', { commitment_review_date: day(4), final_decision_locked_at: 'x' })], NOW)
    expect(deskHeadline(waiting, NOW)).toBe('Nothing is due. Next check-in in 4 days.')
    const unexamined = buildDesk([mk('1')], NOW)
    expect(deskHeadline(unexamined, NOW)).toMatch(/not been examined/)
    for (const m of [due, open, waiting, unexamined]) expect(deskHeadline(m, NOW)).not.toMatch(/streak|overdue|urgent|behind/i)
  })

  it('formatWhen reads naturally', () => {
    expect(formatWhen(0, null, NOW)).toBe('today')
    expect(formatWhen(1, null, NOW)).toBe('tomorrow')
    expect(formatWhen(6, null, NOW)).toBe('in 6 days')
    expect(formatWhen(-1, null, NOW)).toBe('yesterday')
    expect(formatWhen(-4, null, NOW)).toBe('4 days ago')
    expect(formatWhen(30, day(30), NOW)).toMatch(/^on /)
  })

  it('recordStage is honest about early evidence and never says Quorum knows the person', () => {
    expect(recordStage(1).label).toBe('Starting point')
    expect(recordStage(2).label).toBe('First comparison')
    expect(recordStage(3).label).toBe('Early signals')
    expect(recordStage(4).label).toBe('Early signals')
    expect(recordStage(5).label).toBe('Building evidence')
    for (let n = 0; n <= 12; n++) {
      const { line } = recordStage(n)
      expect(line).not.toMatch(/\bknows? you\b|\bunderstands? you\b|\bpredict/i)
    }
    expect(recordStage(3).line).toMatch(/early/i)
  })
})

describe('2. v15 feature flags: default ON, explicit off', () => {
  const keys = ['NEXT_PUBLIC_LOCK_OPTIONAL', 'NEXT_PUBLIC_DESK', 'NEXT_PUBLIC_FRONT_DOOR_V15', 'NEXT_PUBLIC_UNIFIED_SESSION_ENABLED', 'NEXT_PUBLIC_NATURAL_INTAKE_ENABLED']
  const saved: Record<string, string | undefined> = {}
  for (const k of keys) saved[k] = process.env[k]
  afterEach(() => { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } })

  it('lock optional and front door are on unless set to off', () => {
    delete process.env.NEXT_PUBLIC_LOCK_OPTIONAL; delete process.env.NEXT_PUBLIC_FRONT_DOOR_V15
    expect(isLockOptionalEnabled()).toBe(true)
    expect(isFrontDoorV15Enabled()).toBe(true)
    process.env.NEXT_PUBLIC_LOCK_OPTIONAL = 'off'; process.env.NEXT_PUBLIC_FRONT_DOOR_V15 = 'off'
    expect(isLockOptionalEnabled()).toBe(false)
    expect(isFrontDoorV15Enabled()).toBe(false)
    process.env.NEXT_PUBLIC_LOCK_OPTIONAL = 'false'
    expect(isLockOptionalEnabled()).toBe(false)
  })

  it('the lock is mandatory only when unified session is ON and the relaxation is OFF (the pre-v15 behaviour)', () => {
    process.env.NEXT_PUBLIC_UNIFIED_SESSION_ENABLED = 'true'
    delete process.env.NEXT_PUBLIC_LOCK_OPTIONAL
    expect(isLockRequired()).toBe(false)           // v15 default: finishing the Council is enough
    process.env.NEXT_PUBLIC_LOCK_OPTIONAL = 'off'
    expect(isLockRequired()).toBe(true)            // kill switch restores the old hard gate
    process.env.NEXT_PUBLIC_UNIFIED_SESSION_ENABLED = 'false'
    expect(isLockRequired()).toBe(false)           // without unified session there never was a gate
  })

  it('the Desk needs natural intake (it lives inside that front door) and can be switched off', () => {
    process.env.NEXT_PUBLIC_NATURAL_INTAKE_ENABLED = 'false'; delete process.env.NEXT_PUBLIC_DESK
    expect(isDeskEnabled()).toBe(false)
    process.env.NEXT_PUBLIC_NATURAL_INTAKE_ENABLED = 'true'
    expect(isDeskEnabled()).toBe(true)
    process.env.NEXT_PUBLIC_DESK = 'off'
    expect(isDeskEnabled()).toBe(false)
  })
})

describe('3. Phase 1: the lock no longer hides the Brief, Save, the Receipt or the continuity block', () => {
  const sv = src('components/SessionView.tsx')
  it('SessionView asks isLockRequired() once and uses it everywhere the old unified-only check stood', () => {
    expect(sv).toContain("import { isUnifiedSessionEnabled, isEarlyCouncilStartEnabled, isLockRequired } from '@/lib/feature-flags'")
    expect(sv).toContain('const lockMandatory = isLockRequired()')
    expect(sv).toContain('const showNextPrompt = synthesisDone && (!lockMandatory || decisionLocked)')
    expect(sv).toContain('decisionRequired={lockMandatory}')
    expect(sv).toContain('{synthesisDone && (!lockMandatory || decisionLocked) && (')
    expect(sv).toContain('if (lockMandatory && synthesisDone && !decisionLocked) {')
  })
  it('no gate on the old rule is left behind', () => {
    expect(sv).not.toMatch(/isUnifiedSessionEnabled\(\) && synthesisDone && !decisionLocked/)
    expect(sv).not.toContain('!isUnifiedSessionEnabled() || decisionLocked')
  })
  it('the reminder-channel ask is shown once: in the commit card, not again in the continuity block', () => {
    expect(sv).toContain('suppressConnect={decisionLocked && !!lockedReviewDate}')
    const ndp = src('components/NextDecisionPrompt.tsx')
    expect(ndp).toContain('{linked === false && !suppressConnect && (')
  })
})

describe('4. Phase 1: committing is one tap, optional, and keeps its promise', () => {
  const pr = src('components/PredictionReveal.tsx')
  it('a tapped option commits directly; typed text keeps its Review step', () => {
    expect(pr).toContain("void lock(picked, picked, 'tap')")
    expect(pr).toContain("Commit to this")
    expect(pr).toContain("onSubmit={(text) => { setDraft(text); setChosenOption(null); setPhase('review') }}")
    expect(pr).toContain("lock(draftDecision, chosenOption, chosenOption ? 'tap' : 'text')")
  })
  it('"Not ready to decide" is a real path that is tracked and leaves the decision open', () => {
    expect(pr).toContain("Not ready to decide — leave it open")
    expect(pr).toContain("track('commit_deferred', { stage: 'council_result' }, { sessionId })")
    expect(pr).toContain('Left open')
  })
  it('"required" wording appears only when the lock is mandatory', () => {
    expect(pr).toContain("lockMandatory ? 'Make your decision \\u2014 required to close this record' : 'Your call'")
    expect(pr).toContain("lockMandatory ? 'When should Quorum bring this back to you? (required)' : 'When should Quorum check back?'")
    expect(pr).toContain('{!lockMandatory && (')
  })
  it('the commitment is its own event, and the existing review-date event and endpoints are unchanged', () => {
    expect(pr).toContain("track('decision_locked', { via, days_out: daysOut, signed_in: !!authToken }, { sessionId })")
    expect(pr).toContain("track('review_date_chosen'")
    expect(pr).toContain('/api/session/${sessionId}/decide')
    expect(pr).toContain("fetch('/api/session/commitment'")
  })
  it('an anonymous person is asked where Quorum can reach them, so the check-back promise can be kept', () => {
    expect(pr).toContain('<ConnectCard mode="d1_soft" surface="commit_reveal" reviewDate={reviewDate} sessionId={sessionId} defaultExpanded />')
    expect(pr).toContain("That\\u2019s recorded on this device and will be on your desk when you return.")
    // the "Quorum will bring it back on your review date" sentence is only for someone who can be reached
    expect(pr).toContain('{authToken')
  })
  it('the default review date is still pre-filled, so one tap is enough', () => {
    expect(pr).toContain('useState(todayPlusDays(defaultReviewDays ?? 30))')
  })
})

describe('5. new events are registered everywhere an event must be, and stay free of free text', () => {
  const events = ['decision_locked', 'commit_deferred', 'desk_viewed', 'desk_card_clicked', 'nav_clicked', 'front_door_section_opened']
  it('each event is in the client type, the server allow-list and the privacy guard', () => {
    const track = src('lib/track.ts'), route = src('app/api/events/route.ts'), props = src('lib/event-props.ts')
    for (const e of events) {
      expect(track).toContain(`'${e}'`)
      expect(route).toContain(`'${e}'`)
      expect(props).toContain(`'${e}'`)
    }
  })
  it('the guard keeps counts and identifiers and drops anything sentence-like', () => {
    const kept = sanitizeIntakeProps('desk_viewed', { due_count: 2, open_count: 1, waiting_count: 0, unexamined_count: 0, total_count: 3, note: 'my cofounder and I disagree' })
    expect(kept).toMatchObject({ due_count: 2, open_count: 1, waiting_count: 0, unexamined_count: 0, total_count: 3 })
    expect(kept).not.toHaveProperty('note')
    const locked = sanitizeIntakeProps('decision_locked', { via: 'tap', days_out: 7, signed_in: false, decision: 'Quit my job' })
    expect(locked).toMatchObject({ via: 'tap', days_out: 7, signed_in: false })
    expect(locked).not.toHaveProperty('decision')
    const click = sanitizeIntakeProps('desk_card_clicked', { section: 'due', action: 'open' })
    expect(click).toMatchObject({ section: 'due', action: 'open' })
    const sentence = sanitizeIntakeProps('nav_clicked', { to: 'Open my private mirror now', surface: 'desk' })
    expect(sentence).not.toHaveProperty('to')
  })
})

describe('6. Phase 2: the Decision Desk is the returning visitor home and is built from what exists', () => {
  const ci = src('components/ChatIntake.tsx')
  const hero = ci.slice(ci.indexOf('Hero \u2014 "Quorum is ready to think with me,'))
  it('/api/history returns the fields the Desk needs, from columns that already exist', () => {
    const h = src('app/api/history/route.ts')
    expect(h).toContain("'id, decision_text, created_at, status, session_depth, final_decision_locked_at, commitment_review_date'")
    for (const col of ['final_decision_locked_at', 'commitment_review_date', 'session_depth']) {
      expect(['supabase/sprint_prediction_layer.sql', 'supabase/sprint_chunk1_commitment.sql', 'supabase/sprint_natural_intake_v1.sql']
        .some(f => src(f).includes(col))).toBe(true)
    }
  })
  it('due check-ins come first, the box follows, the rest of the Desk sits below it', () => {
    const top = hero.indexOf('<DeskTop'), box = hero.indexOf('{inputForm}'), body = ci.indexOf('<DeskBody')
    expect(top).toBeGreaterThan(-1)
    expect(top).toBeLessThan(box)
    expect(body).toBeGreaterThan(ci.indexOf('Private \u00b7 nothing is shared without your permission'))
  })
  it('it only shows for someone with decisions, and holds its place instead of flashing the first-visit screen', () => {
    expect(ci).toContain('const deskActive  = deskOn && !started && historySessions.length > 0')
    expect(ci).toContain('const deskPending = deskOn && !started && !historyLoaded && historySessions.length === 0 && localDecisionCount > 0')
    expect(ci).toContain('Opening your desk')
    const nic = src('app/NaturalIntakeClient.tsx')
    expect(nic).toContain('historyLoaded={historyLoaded}')
    expect(nic).toContain('setHistoryLoaded(true)')
  })
  it('the first-visit sign-in rules still hold: nothing sign-in-ish is added above the box', () => {
    const before = hero.slice(0, hero.indexOf('{inputForm}'))
    expect(before).not.toContain('<AuthPanel')
    expect(before.match(/<ConnectCard/g) ?? []).toHaveLength(1)
  })
  it('the Desk is not a task board: no priorities, counters of work to do, or streaks in its copy', () => {
    const d = stripAllComments(src('components/DecisionDesk.tsx')) + stripAllComments(src('lib/desk.ts'))
    expect(d).not.toMatch(/streak|priority|to-?do|overdue|badge|points|level up/i)
  })
  it('Desk and Mirror are the two destinations, with a persistent way to bring a decision; the Council is not a tab', () => {
    const nav = src('components/AppNav.tsx')
    expect(nav).toContain("item('desk', '/', 'Desk')")
    expect(nav).toContain("item('mirror', '/mirror', 'Mirror')")
    expect(nav).toContain('href="/q"')
    expect(nav).not.toMatch(/'Council'/)
    expect(src('app/mirror/page.tsx')).toContain('<AppNav current="mirror" surface="mirror" />')
    expect(src('app/record/[id]/page.tsx')).toContain('<AppNav current="record" surface="record" />')
  })
  it('a due check-in lands on the outcome tracker', () => {
    expect(src('components/DecisionDesk.tsx')).toContain('`/record/${id}#outcome`')
    expect(src('app/record/[id]/page.tsx')).toContain('<div id="outcome"')
  })
})

describe('7. Phase 3: the front door names the Council and says what happens, without overclaiming', () => {
  const ci = src('components/ChatIntake.tsx')
  const fd = src('components/FrontDoorExplainer.tsx')
  it('the headline and sub-line name the proposition and the Council; the old copy remains behind the flag', () => {
    expect(ci).toContain('Bring a hard decision. Have it challenged, and remembered.')
    expect(ci).toContain('Six independent advisors and an Examiner pressure-test it.')
    expect(ci).toContain("What's the decision you're circling?")           // flag-off fallback
    expect(ci).toContain('{frontDoorV15 && !deskActive && !deskPending && <FrontDoorExplainer />}')
  })
  it('first-screen copy has no free / sign-up / timing / instant / guarantee claims', () => {
    const copy = withoutComments(fd)
    expect(copy).not.toMatch(UNVERIFIED_CLAIM)
    const heroCopy = withoutComments(ci.slice(ci.indexOf('v15 Phase 3: say what this is before anyone types'), ci.indexOf('Landing simplification')))
    expect(heroCopy).not.toMatch(UNVERIFIED_CLAIM)
  })
  it('it never says Quorum knows, understands or predicts the person, and calls thin evidence early', () => {
    const copy = stripAllComments(fd).replace(/\s+/g, ' ')
    // the one sentence that mentions knowing the person is the disclaimer itself; check the rest of the copy without it
    expect(copy).toContain('does not claim to know you from one or two decisions')
    const rest = copy.replace('does not claim to know you from one or two decisions', '')
    expect(rest).not.toMatch(/\bknows? you\b|\bunderstands? you\b|\bpredicts? (you|your)\b|reads? your (mind|personality)/i)
    expect(copy).toMatch(/marked as early/)
  })
  it('the example result is labelled as invented, and names all three parts a first-time visitor needs to see', () => {
    expect(fd).toContain('An invented example')
    expect(fd).toContain('Not a real person’s decision')
    for (const part of ['The Examiner first asks', 'Where they split', 'The Council’s read']) expect(fd).toContain(part)
  })
  it('the three steps are examined -> decided -> remembered, and the explainer is tracked', () => {
    expect(fd).toContain("lead: 'Examined.'")
    expect(fd).toContain("lead: 'Decided.'")
    expect(fd).toContain("lead: 'Remembered.'")
    expect(fd).toContain("track('front_door_section_opened', { section })")
  })
  it('the box is still the first thing to act on: the explainer sits after it', () => {
    const hero = ci.slice(ci.indexOf('Hero \u2014 "Quorum is ready to think with me,'))
    expect(hero.indexOf('<FrontDoorExplainer')).toBeGreaterThan(hero.indexOf('{inputForm}'))
  })
})

describe('8. The Desk works without an account, and decisions follow the person when they create one', () => {
  const ci = src('components/ChatIntake.tsx')
  const nic = src('app/NaturalIntakeClient.tsx')

  it('seeing the Desk never depends on being signed in', () => {
    // activation is "has decisions", not "has an account"
    expect(ci).toContain('const deskActive  = deskOn && !started && historySessions.length > 0')
    expect(ci).not.toMatch(/deskActive\s*=[^\n]*(authToken|hasEmail|userEmail)/)
    // the Desk components import nothing about auth and make no authenticated request
    const desk = stripAllComments(src('components/DecisionDesk.tsx'))
    expect(desk).not.toMatch(/authToken|getAuthHeaders|Authorization|supabase/i)
    expect(stripAllComments(src('lib/desk.ts'))).not.toMatch(/authToken|Authorization|supabase/i)
  })
  it('history for the Desk is loaded from locally stored ids with no token, and merged with the account when there is one', () => {
    expect(nic).toContain('getStoredSessionIds()')
    expect(nic).toContain("if (!ids.length && !authToken) { if (!cancelled) setHistoryLoaded(true); return }")
    const h = src('app/api/history/route.ts')
    expect(h).toContain('By localStorage IDs (always attempted')   // pre-auth path
    expect(h).toContain(".eq('user_id', userId)")                    // account path, cross-device
    expect(h).toContain('allIds = Array.from(new Set([...allIds, ...userIds]))')
  })
  it('an anonymous visitor is told where their desk lives, with no sign-in required to see it', () => {
    const d = src('components/DecisionDesk.tsx')
    expect(d).toContain('signedIn = true')
    expect(d).toContain('Your decisions are saved on this device. Sign in if you want them on other devices too.')
    expect(ci).toContain('signedIn={!!authToken || hasEmail}')
    // the existing optional sign-in panel still follows the Desk for anyone with decisions and no account
    expect(ci).toContain('{!hasEmail && historySessions.length > 0 && (')
  })
  it('the d3 gate is not what the Desk relies on, and its parsing is unchanged: unset or anything unknown means off', async () => {
    const { getGateMode } = await import('@/lib/auth-gate')
    const saved = process.env.NEXT_PUBLIC_AUTH_GATE_MODE
    try {
      delete process.env.NEXT_PUBLIC_AUTH_GATE_MODE
      expect(getGateMode()).toBe('off')
      process.env.NEXT_PUBLIC_AUTH_GATE_MODE = 'd3'
      expect(getGateMode()).toBe('d3')
      process.env.NEXT_PUBLIC_AUTH_GATE_MODE = 'OFF'
      expect(getGateMode()).toBe('off')
      process.env.NEXT_PUBLIC_AUTH_GATE_MODE = 'anything-else'
      expect(getGateMode()).toBe('off')
    } finally {
      if (saved === undefined) delete process.env.NEXT_PUBLIC_AUTH_GATE_MODE; else process.env.NEXT_PUBLIC_AUTH_GATE_MODE = saved
    }
  })
  it('signing in from ANY card stashes the decision being signed in for, so it is linked even without functional cookies', () => {
    const cc = src('components/ConnectCard.tsx')
    expect(cc).not.toContain('isGate && sessionId')
    expect((cc.match(/if \(sessionId\) pushSessionIdForSignIn\(sessionId\)/g) ?? []).length).toBe(2)
    // magic link path already carries the id in its payload
    expect(cc).toContain('const sessionIds = sessionId && !stored.includes(sessionId) ? [sessionId, ...stored] : stored')
    // the commit-time reminder card is given the session id
    expect(src('components/PredictionReveal.tsx')).toContain('sessionId={sessionId} defaultExpanded')
  })
  it('the existing linking architecture is untouched: ids, device sweep, email sweep, all bound to the verified token', () => {
    const l = src('app/api/auth/link-sessions/route.ts')
    expect(l).toContain("rpc('link_sessions_to_user'")
    expect(l).toContain(".eq('device_id', did)")
    expect(l).toContain(".eq('user_email', userEmail)")
    expect(l).toContain('getUserFromBearer(req)')
    expect(l).toContain("claimedUserId !== authed.id")
  })
  it('no consent is needed to SEE the Desk (reads are permitted) but none is bypassed to build it', () => {
    const st = src('lib/storage.ts')
    expect(st).toContain('Reads (getStoredSessionIds, getStoredDeviceId) are always permitted')
    // writes of the session list and device id still require functional consent
    expect(st).toMatch(/export function pushSessionId\(id: string\): void \{\s*if \(typeof window === 'undefined'\) return\s*if \(!hasFunctionalConsent\(\)\) return/)
    // the Desk code writes nothing to storage
    expect(stripAllComments(src('components/DecisionDesk.tsx'))).not.toMatch(/localStorage|sessionStorage|pushSessionId|getOrCreateDeviceId/)
  })
  it('the commit card does not claim "recorded on this device" for a browser that cannot remember it', () => {
    const pr = src('components/PredictionReveal.tsx')
    expect(pr).toContain("import { hasFunctionalConsent } from '@/lib/storage'")
    expect(pr).toContain('hasFunctionalConsent()')
    expect(pr).toContain('This browser isn\\u2019t set to remember your decisions, so sign in below to keep it on your desk.')
  })
})
