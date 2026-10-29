// tests/pretag-v13.test.ts
// ── v13: pre-tag — classify the decision while the person is still on the confirm screen ───────────────────────────
// The point of these tests is to prove, without a real database or model, that:
//   1. a pre-computed tag is used ONLY for the identical tagger input, once, and never when stale or invalid;
//   2. a clean launch (lean + priority taps added after the pre-tag) really does hash the same as the pre-tag run;
//   3. every failure path falls back to the previous behaviour (the model is called), so nothing can make a launch worse;
//   4. nothing in this feature writes to or reads from the `sessions` table — a decision that was only looked at leaves
//      no trace anywhere that counts, lists or exports sessions;
//   5. with the feature flag off, the ontology route behaves exactly as before (lean lines included in the tagger input).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { FakeDb } from './helpers/fake-supabase'

const h = vi.hoisted(() => ({ db: null as unknown, tagDecision: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  createServiceClient: () => h.db,
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}))
vi.mock('@/lib/ontology-tagger', () => ({ tagDecision: (...a: unknown[]) => h.tagDecision(...a) }))
vi.mock('@/lib/encryption', () => ({ encrypt: (s: unknown) => s, decrypt: (s: unknown) => s }))

import {
  PRETAG_FRESH_MS, PRETAG_PENDING_STALE_MS, claimPretag, pretagHash, storePretag, stripTaggerNoiseLines, takePretag, taggerInput,
  type PretagDb,
} from '../lib/chat-intake-pretag'
import { assembleSessionInput } from '../lib/chat-intake-state'
import { LEAN_LINE_PREFIX, PRIORITY_LINE_PREFIX } from '../lib/chat-intake-context'
import { validateTag } from '../lib/ontology-validate'
import type { ChatDecisionState } from '../lib/types'

const root = join(__dirname, '..')
const src = (rel: string) => readFileSync(join(root, rel), 'utf-8')

// ── fixtures ────────────────────────────────────────────────────────────────
const DIMS = ['reversibility', 'time_horizon', 'stakes_magnitude', 'outcome_uncertainty', 'value_conflict', 'identity_alignment', 'regret_asymmetry',
  'upstream_dependency', 'ambiguity', 'task_complexity', 'decision_discriminating_info', 'time_pressure', 'decision_unit', 'emotional_intensity', 'non_financial_utility']
const TAG = (over: Record<string, unknown> = {}) => ({
  decision_type_primary: 'commitment', decision_type_secondary: [], stakes_reversibility: 'partial', stakes_bearer: 'self', stakes_timeline: 'months',
  has_stated_deadline: true, deadline_source: 'external', deadline_credibility: 'real', known_unknowns_surfaced: true, unknown_unknown_categories: [],
  counterparty_present: true, counterparty_alignment: 'neutral', info_asymmetry: 'low', relationship_type: 'employment', dominant_emotion: 'anxiety',
  emotion_source: 'situation', emotion_analysis_aligned: true, stakeholder_count: 2, hidden_stakeholder_probability: 'low', instrumental_weight: 3,
  constitutive_weight: 2, examiner_gap_1: 'g1', examiner_gap_2: 'g2', examiner_gap_3: 'g3',
  scored_vector: { ...Object.fromEntries(DIMS.map(d => [d, { score: 2, confidence: 0.8, rationale: 'r' }])), vector_version: 'v2.0' },
  ...over,
}) as never

const STATE: ChatDecisionState = {
  decisionKind: 'job_offer', phase: 'gathering', decisionStatement: 'Should I accept the offer with 20% more pay, or keep my routine?',
  options: [{ label: 'Take the better job', type: 'act' }, { label: 'Keep my current life', type: 'dont_act' }],
  facts: { offer: 'Same title, 20% more CTC', hesitation: 'protecting my routine', deadline: 'In a week or two' },
} as ChatDecisionState
const TRANSCRIPT = [{ role: 'user', content: 'Should I take the better job or protect the life I have?' }, { role: 'user', content: 'Same title but more pay' }] as never
const WITH_TAPS: ChatDecisionState = { ...STATE, chosenLean: 'accept', chosenLeanLabel: 'Take the better job', optimizationPriority: 'money' } as ChatDecisionState

// ── 1. the canonical input ──────────────────────────────────────────────────
describe('the tagger input is canonical: the person\'s lean / priority lines are not part of it', () => {
  it('removes exactly those two lines and nothing else', () => {
    const ctx = ['Options: A; B', `${LEAN_LINE_PREFIX}A`, `${PRIORITY_LINE_PREFIX}money`, 'Deadline: soon'].join('\n')
    expect(stripTaggerNoiseLines(ctx)).toBe('Options: A; B\nDeadline: soon')
    expect(stripTaggerNoiseLines(null)).toBeNull()
    expect(stripTaggerNoiseLines('')).toBeNull()
    expect(stripTaggerNoiseLines(`${LEAN_LINE_PREFIX}A`)).toBeNull()
  })
  it('trims, and the hash depends on the text only', () => {
    expect(taggerInput('  x  ', '  y  ')).toEqual({ decisionText: 'x', contextText: 'y' })
    expect(pretagHash('x', 'y')).toBe(pretagHash(' x ', ' y '))
    expect(pretagHash('x', 'y')).not.toBe(pretagHash('x2', 'y'))
    expect(pretagHash('x', 'y')).not.toBe(pretagHash('x', 'y2'))
    expect(pretagHash('x', null)).toBe(pretagHash('x', ''))
  })
  it('a CLEAN LAUNCH hashes the same as the pre-tag run: adding the lean + priority taps does not change the input', () => {
    const before = assembleSessionInput(STATE, TRANSCRIPT)
    const after  = assembleSessionInput(WITH_TAPS, TRANSCRIPT)
    expect(after.contextText).toContain(LEAN_LINE_PREFIX)                         // the taps really are in the final context…
    expect(before.contextText).not.toContain(LEAN_LINE_PREFIX)
    expect(pretagHash(after.decisionText, after.contextText)).toBe(pretagHash(before.decisionText, before.contextText))   // …and still hash the same
  })
  it('anything else changing (an edit, more chat, a different answer) does NOT hash the same — it simply misses', () => {
    const base = assembleSessionInput(STATE, TRANSCRIPT)
    // the checkpoint sends the person's own wording as the decision text (edited || Quorum's), and notes it in the context
    const e = assembleSessionInput(STATE, TRANSCRIPT, { editedDecision: 'My own wording of the decision' })
    const edited = { decisionText: 'My own wording of the decision', contextText: e.contextText }
    const moreChat = assembleSessionInput({ ...STATE, facts: { ...STATE.facts, deadline: 'No deadline' } } as ChatDecisionState, TRANSCRIPT)
    const h0 = pretagHash(base.decisionText, base.contextText)
    expect(pretagHash(edited.decisionText, edited.contextText)).not.toBe(h0)
    expect(pretagHash(moreChat.decisionText, moreChat.contextText)).not.toBe(h0)
  })
})

// ── 2. the storage rules ────────────────────────────────────────────────────
describe('claiming, storing and taking a pre-computed tag', () => {
  const NOW = Date.parse('2026-10-29T10:00:00Z')
  const iso = (ms: number) => new Date(ms).toISOString()
  const dbWith = (row: Record<string, unknown> = {}) => new FakeDb({ chat_intakes: [{ id: 'c1', status: 'active', ...row }] })
  const asDb = (d: FakeDb) => d as unknown as PretagDb

  it('claim: the first run claims; a second request for the same input is held (so one model call, not two)', async () => {
    const d = dbWith()
    expect(await claimPretag(asDb(d), 'c1', 'H', NOW)).toBe('claimed')
    expect(await claimPretag(asDb(d), 'c1', 'H', NOW + 1000)).toBe('held')
    expect(d.rows('chat_intakes')[0]).toMatchObject({ pre_tag_hash: 'H', pre_tag_status: 'pending' })
  })
  it('claim: a different input, a failed run, a used result, an abandoned run, or an old result can all be claimed again', async () => {
    for (const [row, label] of [
      [{ pre_tag_hash: 'OLD', pre_tag_status: 'ready', pre_tag_at: iso(NOW) }, 'different input'],
      [{ pre_tag_hash: 'H', pre_tag_status: 'failed', pre_tag_at: iso(NOW) }, 'failed'],
      [{ pre_tag_hash: 'H', pre_tag_status: 'used', pre_tag_at: iso(NOW) }, 'used'],
      [{ pre_tag_hash: 'H', pre_tag_status: 'pending', pre_tag_at: iso(NOW - PRETAG_PENDING_STALE_MS - 1000) }, 'abandoned'],
      [{ pre_tag_hash: 'H', pre_tag_status: 'ready', pre_tag_at: iso(NOW - PRETAG_FRESH_MS - 1000) }, 'old'],
    ] as const) expect(await claimPretag(asDb(dbWith(row)), 'c1', 'H', NOW), label).toBe('claimed')
    // …but a fresh pending run or fresh ready result for the same input is never re-run
    expect(await claimPretag(asDb(dbWith({ pre_tag_hash: 'H', pre_tag_status: 'pending', pre_tag_at: iso(NOW - 1000) })), 'c1', 'H', NOW)).toBe('held')
    expect(await claimPretag(asDb(dbWith({ pre_tag_hash: 'H', pre_tag_status: 'ready', pre_tag_at: iso(NOW - 1000) })), 'c1', 'H', NOW)).toBe('held')
  })
  it('claim: columns not migrated yet -> "unavailable", never an exception', async () => {
    const d = dbWith(); d.missingColumns.add('pre_tag_hash')
    expect(await claimPretag(asDb(d), 'c1', 'H', NOW)).toBe('unavailable')
  })
  it('store: a valid tag is saved; an invalid or missing one is recorded as failed; a superseded run cannot overwrite a newer input', async () => {
    const d = dbWith({ pre_tag_hash: 'H', pre_tag_status: 'pending' })
    expect(await storePretag(asDb(d), 'c1', 'H', TAG(), NOW)).toBe(true)
    expect(d.rows('chat_intakes')[0]).toMatchObject({ pre_tag_status: 'ready' })
    const bad = dbWith({ pre_tag_hash: 'H', pre_tag_status: 'pending' })
    expect(await storePretag(asDb(bad), 'c1', 'H', TAG({ examiner_gap_2: '' }), NOW)).toBe(false)
    expect(bad.rows('chat_intakes')[0]).toMatchObject({ pre_tag_status: 'failed', pre_tag: null })
    const nul = dbWith({ pre_tag_hash: 'H', pre_tag_status: 'pending' })
    expect(await storePretag(asDb(nul), 'c1', 'H', null, NOW)).toBe(false)
    const newer = dbWith({ pre_tag_hash: 'NEWER', pre_tag_status: 'pending' })
    await storePretag(asDb(newer), 'c1', 'H', TAG(), NOW)
    expect(newer.rows('chat_intakes')[0]).toMatchObject({ pre_tag_hash: 'NEWER', pre_tag_status: 'pending' })
  })
  it('take: returns a ready tag for the identical input, ONCE, and clears it', async () => {
    const d = dbWith({ pre_tag_hash: 'H', pre_tag_status: 'ready', pre_tag: TAG(), pre_tag_at: iso(NOW - 5000) })
    const t = await takePretag(asDb(d), 'c1', 'H', { now: () => NOW })
    expect(t?.decision_type_primary).toBe('commitment')
    expect(d.rows('chat_intakes')[0]).toMatchObject({ pre_tag: null, pre_tag_status: 'used' })
    expect(await takePretag(asDb(d), 'c1', 'H', { now: () => NOW })).toBeNull()
  })
  it('take: never for a different input, a failed/used/stale/invalid result, a missing row, or missing columns', async () => {
    const cases: Record<string, unknown>[] = [
      { pre_tag_hash: 'OTHER', pre_tag_status: 'ready', pre_tag: TAG(), pre_tag_at: iso(NOW) },
      { pre_tag_hash: 'H', pre_tag_status: 'failed', pre_tag_at: iso(NOW) },
      { pre_tag_hash: 'H', pre_tag_status: 'used', pre_tag_at: iso(NOW) },
      { pre_tag_hash: 'H', pre_tag_status: 'ready', pre_tag: TAG(), pre_tag_at: iso(NOW - PRETAG_FRESH_MS - 1) },
      { pre_tag_hash: 'H', pre_tag_status: 'ready', pre_tag: TAG({ decision_type_primary: 'nonsense' }), pre_tag_at: iso(NOW) },
      { pre_tag_hash: 'H', pre_tag_status: 'ready', pre_tag: null, pre_tag_at: iso(NOW) },
      {},
    ]
    for (const row of cases) expect(await takePretag(asDb(dbWith(row)), 'c1', 'H', { now: () => NOW })).toBeNull()
    expect(await takePretag(asDb(dbWith()), 'missing-id', 'H', { now: () => NOW })).toBeNull()
    const noCols = dbWith({ pre_tag_hash: 'H', pre_tag_status: 'ready', pre_tag: TAG(), pre_tag_at: iso(NOW) }); noCols.missingColumns.add('pre_tag_status')
    expect(await takePretag(asDb(noCols), 'c1', 'H', { now: () => NOW })).toBeNull()
  })
  it('take: waits for a run still in flight and uses it the moment it lands; gives up (tags normally) if it never does', async () => {
    let clock = NOW
    const d = dbWith({ pre_tag_hash: 'H', pre_tag_status: 'pending', pre_tag_at: iso(NOW) })
    let polls = 0
    const sleep = async (ms: number) => {
      clock += ms; polls++
      if (polls === 3) Object.assign(d.rows('chat_intakes')[0], { pre_tag_status: 'ready', pre_tag: TAG(), pre_tag_at: iso(clock) })
    }
    expect((await takePretag(asDb(d), 'c1', 'H', { now: () => clock, sleep }))?.decision_type_primary).toBe('commitment')
    expect(polls).toBe(3)

    let clock2 = NOW; let polls2 = 0
    const stuck = dbWith({ pre_tag_hash: 'H', pre_tag_status: 'pending', pre_tag_at: iso(NOW) })
    expect(await takePretag(asDb(stuck), 'c1', 'H', { now: () => clock2, sleep: async ms => { clock2 += ms; polls2++ }, waitMs: 2000 })).toBeNull()
    expect(polls2).toBeLessThanOrEqual(6)                       // bounded: it does not wait forever
  })
})

// ── 3. the routes, end to end ───────────────────────────────────────────────
describe('routes: pre-tag → session → ontology', () => {
  let db: FakeDb
  let fetchSpy: ReturnType<typeof vi.fn>
  const ENV = ['NEXT_PUBLIC_NATURAL_INTAKE_ENABLED', 'NEXT_PUBLIC_PRETAG_ENABLED']
  const saved: Record<string, string | undefined> = {}
  const ip = () => ({ 'x-forwarded-for': `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` })
  const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
    new Request(`http://localhost${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ip(), ...headers }, body: JSON.stringify(body) })

  function seedChat(state: ChatDecisionState = STATE) {
    db.rows('chat_intakes').push({ id: 'c1', status: 'active', decision_state: state, user_id: null, device_id: 'd1' })
    db.rows('chat_intake_messages').push(
      { chat_intake_id: 'c1', turn_order: 1, role: 'user', content: 'Should I take the better job or protect the life I have?' },
      { chat_intake_id: 'c1', turn_order: 2, role: 'user', content: 'Same title but more pay' },
    )
  }
  beforeEach(() => {
    for (const k of ENV) saved[k] = process.env[k]
    process.env.NEXT_PUBLIC_NATURAL_INTAKE_ENABLED = 'true'; process.env.NEXT_PUBLIC_PRETAG_ENABLED = 'true'
    delete process.env.INTERNAL_API_SECRET
    db = new FakeDb(); h.db = db
    h.tagDecision.mockReset(); h.tagDecision.mockResolvedValue(TAG())
    fetchSpy = vi.fn(async () => new Response('{}', { status: 200 })); global.fetch = fetchSpy as never
  })
  afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } })

  it('PRETAG route: off by default (404); needs an id (400); unknown chat (404); a launched chat is skipped', async () => {
    const { POST } = await import('../app/api/chat-intake/pretag/route')
    delete process.env.NEXT_PUBLIC_PRETAG_ENABLED
    expect((await POST(post('/api/chat-intake/pretag', { chatIntakeId: 'c1' }))).status).toBe(404)
    process.env.NEXT_PUBLIC_PRETAG_ENABLED = 'true'
    expect((await POST(post('/api/chat-intake/pretag', {}))).status).toBe(400)
    expect((await POST(post('/api/chat-intake/pretag', { chatIntakeId: 'nope' }))).status).toBe(404)
    seedChat(); db.rows('chat_intakes')[0].status = 'checkpointed'
    expect(await (await POST(post('/api/chat-intake/pretag', { chatIntakeId: 'c1' }))).json()).toEqual({ status: 'skipped' })
    expect(h.tagDecision).not.toHaveBeenCalled()
  })

  it('PRETAG route: tags once on the canonical input, parks the result on the chat, and a repeat call does not call the model again', async () => {
    const { POST } = await import('../app/api/chat-intake/pretag/route')
    seedChat()
    const r1 = await (await POST(post('/api/chat-intake/pretag', { chatIntakeId: 'c1' }))).json()
    expect(r1).toEqual({ status: 'ready' })
    expect(h.tagDecision).toHaveBeenCalledTimes(1)
    const expected = taggerInput(...(Object.values(assembleSessionInput(STATE, TRANSCRIPT)).slice(0, 2) as [string, string]))
    const [decisionArg, contextArg] = h.tagDecision.mock.calls[0]
    expect(decisionArg).toBe(expected.decisionText)
    expect(contextArg).toBe(expected.contextText)
    expect(db.rows('chat_intakes')[0]).toMatchObject({ pre_tag_status: 'ready', pre_tag_hash: pretagHash(decisionArg as string, contextArg as string) })
    const r2 = await (await POST(post('/api/chat-intake/pretag', { chatIntakeId: 'c1' }))).json()
    expect(r2).toEqual({ status: 'held' })
    expect(h.tagDecision).toHaveBeenCalledTimes(1)
  })

  it('PRETAG route: a model failure is recorded as failed and never surfaces as an error', async () => {
    const { POST } = await import('../app/api/chat-intake/pretag/route')
    seedChat(); h.tagDecision.mockResolvedValue(null)
    const res = await POST(post('/api/chat-intake/pretag', { chatIntakeId: 'c1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'failed' })
    expect(db.rows('chat_intakes')[0]).toMatchObject({ pre_tag_status: 'failed' })
    h.tagDecision.mockRejectedValue(new Error('anthropic down'))
    expect((await POST(post('/api/chat-intake/pretag', { chatIntakeId: 'c1' }))).status).toBe(200)
  })

  it('PRETAG route: columns not migrated yet -> a harmless "unavailable" (the launch just tags normally)', async () => {
    const { POST } = await import('../app/api/chat-intake/pretag/route')
    seedChat(); db.missingColumns.add('pre_tag_hash')
    expect(await (await POST(post('/api/chat-intake/pretag', { chatIntakeId: 'c1' }))).json()).toEqual({ status: 'unavailable' })
    expect(h.tagDecision).not.toHaveBeenCalled()
  })

  it('END TO END: pre-tag on the confirm screen, then a clean launch (lean + priority added) — the ontology route reuses it with NO second model call', async () => {
    const pretag = await import('../app/api/chat-intake/pretag/route')
    const ontology = await import('../app/api/ontology/route')
    seedChat()
    await pretag.POST(post('/api/chat-intake/pretag', { chatIntakeId: 'c1' }))
    expect(h.tagDecision).toHaveBeenCalledTimes(1)

    // what the checkpoint would send to /api/session -> /api/ontology: the final text, WITH the lean + priority lines
    const final = assembleSessionInput(WITH_TAPS, TRANSCRIPT)
    expect(final.contextText).toContain(LEAN_LINE_PREFIX)
    const res = await ontology.POST(post('/api/ontology', { sessionId: 's1', decisionText: final.decisionText, contextText: final.contextText, chatIntakeId: 'c1' }))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(h.tagDecision).toHaveBeenCalledTimes(1)                                           // still just the pre-tag's call
    expect(db.rows('sessions_ontology')[0]).toMatchObject({ session_id: 's1', tagger_status: 'complete', tagger_version: 'v2.0' })
    expect(db.rows('sessions_ontology')[0].rule_engine_result).toBeTruthy()                  // the rule engine still ran on the tag
    expect(fetchSpy.mock.calls.some(c => String(c[0]).endsWith('/api/structural-match'))).toBe(true)   // …and so did structural matching
    expect(db.rows('chat_intakes')[0]).toMatchObject({ pre_tag_status: 'used', pre_tag: null })        // used once, cleared
  })

  it('ONTOLOGY route: an EDITED decision misses the pre-tag and the model is called — on the canonical input (no lean lines)', async () => {
    const pretag = await import('../app/api/chat-intake/pretag/route')
    const ontology = await import('../app/api/ontology/route')
    seedChat()
    await pretag.POST(post('/api/chat-intake/pretag', { chatIntakeId: 'c1' }))
    const edited = assembleSessionInput(WITH_TAPS, TRANSCRIPT, { editedDecision: 'My own wording' })
    await ontology.POST(post('/api/ontology', { sessionId: 's2', decisionText: 'My own wording', contextText: edited.contextText, chatIntakeId: 'c1' }))
    expect(h.tagDecision).toHaveBeenCalledTimes(2)
    const ctxArg = h.tagDecision.mock.calls[1][1] as string
    expect(ctxArg).not.toContain(LEAN_LINE_PREFIX); expect(ctxArg).not.toContain(PRIORITY_LINE_PREFIX)
    expect(db.rows('sessions_ontology').find(r => r.session_id === 's2')).toMatchObject({ tagger_status: 'complete' })
    expect(db.rows('chat_intakes')[0]).toMatchObject({ pre_tag_status: 'ready' })           // the unused pre-tag is left alone
  })

  it('ONTOLOGY route: no chat id (classic form, re-analysis) behaves as before — the model is called', async () => {
    const ontology = await import('../app/api/ontology/route')
    await ontology.POST(post('/api/ontology', { sessionId: 's3', decisionText: 'Should I?', contextText: 'Options: A; B' }))
    expect(h.tagDecision).toHaveBeenCalledTimes(1)
    expect(h.tagDecision.mock.calls[0]).toEqual(['Should I?', 'Options: A; B'])
  })

  it('ONTOLOGY route: someone else\'s chat id with different text gains nothing', async () => {
    const pretag = await import('../app/api/chat-intake/pretag/route')
    const ontology = await import('../app/api/ontology/route')
    seedChat()
    await pretag.POST(post('/api/chat-intake/pretag', { chatIntakeId: 'c1' }))
    await ontology.POST(post('/api/ontology', { sessionId: 's4', decisionText: 'A totally different decision', contextText: null, chatIntakeId: 'c1' }))
    expect(h.tagDecision).toHaveBeenCalledTimes(2)
  })

  it('ONTOLOGY route: a pre-tag that fails validation falls back to the model rather than writing a bad row', async () => {
    const ontology = await import('../app/api/ontology/route')
    seedChat()
    const final = assembleSessionInput(STATE, TRANSCRIPT)
    const hash = pretagHash(final.decisionText, final.contextText)
    Object.assign(db.rows('chat_intakes')[0], { pre_tag_hash: hash, pre_tag_status: 'ready', pre_tag: TAG({ decision_type_primary: 'nonsense' }), pre_tag_at: new Date().toISOString() })
    await ontology.POST(post('/api/ontology', { sessionId: 's5', decisionText: final.decisionText, contextText: final.contextText, chatIntakeId: 'c1' }))
    expect(h.tagDecision).toHaveBeenCalledTimes(1)
    expect(db.rows('sessions_ontology').find(r => r.session_id === 's5')).toMatchObject({ tagger_status: 'complete' })
  })

  it('ONTOLOGY route: when the model itself fails the session is marked failed, as before (pre-tag changes nothing here)', async () => {
    const ontology = await import('../app/api/ontology/route')
    h.tagDecision.mockResolvedValue(null)
    const res = await ontology.POST(post('/api/ontology', { sessionId: 's6', decisionText: 'Should I?', contextText: null, chatIntakeId: 'c1' }))
    expect(res.status).toBe(500)
    expect(db.rows('sessions_ontology').find(r => r.session_id === 's6')).toMatchObject({ tagger_status: 'failed' })
  })

  it('FLAG OFF: the ontology route is exactly the previous behaviour — the model gets the context WITH the lean lines, and no pre-tag is read', async () => {
    delete process.env.NEXT_PUBLIC_PRETAG_ENABLED
    const ontology = await import('../app/api/ontology/route')
    seedChat()
    Object.assign(db.rows('chat_intakes')[0], { pre_tag_hash: 'x', pre_tag_status: 'ready', pre_tag: TAG(), pre_tag_at: new Date().toISOString() })
    const final = assembleSessionInput(WITH_TAPS, TRANSCRIPT)
    await ontology.POST(post('/api/ontology', { sessionId: 's7', decisionText: final.decisionText, contextText: final.contextText, chatIntakeId: 'c1' }))
    expect(h.tagDecision).toHaveBeenCalledTimes(1)
    expect(h.tagDecision.mock.calls[0]).toEqual([final.decisionText, final.contextText])
    expect(String(h.tagDecision.mock.calls[0][1])).toContain(LEAN_LINE_PREFIX)
    expect(db.rows('chat_intakes')[0]).toMatchObject({ pre_tag_status: 'ready' })            // untouched
  })

  it('SESSION route: forwards the chat id to the tagger call (and only when there is one)', async () => {
    const session = await import('../app/api/session/route')
    db.tables.sessions = []
    await session.POST(post('/api/session', { decision_text: 'Should I?', context_text: 'ctx', intake_mode: 'chat', chat_intake_id: 'c1', device_id: 'd1' }))
    const call = fetchSpy.mock.calls.find(c => String(c[0]).endsWith('/api/ontology'))!
    expect(JSON.parse(String((call[1] as { body: string }).body))).toMatchObject({ sessionId: expect.any(String), decisionText: 'Should I?', contextText: 'ctx', chatIntakeId: 'c1' })
    fetchSpy.mockClear()
    await session.POST(post('/api/session', { decision_text: 'Classic form decision', device_id: 'd1' }))
    const call2 = fetchSpy.mock.calls.find(c => String(c[0]).endsWith('/api/ontology'))!
    expect(Object.keys(JSON.parse(String((call2[1] as { body: string }).body)))).not.toContain('chatIntakeId')
  })

  it('NOTHING in this feature touches the sessions table: viewing the confirm screen leaves no session behind', async () => {
    const pretag = await import('../app/api/chat-intake/pretag/route')
    seedChat()
    await pretag.POST(post('/api/chat-intake/pretag', { chatIntakeId: 'c1' }))
    expect(db.rows('sessions')).toHaveLength(0)
    expect(db.log.filter(l => l.table === 'sessions')).toEqual([])
    expect(db.log.filter(l => l.table === 'sessions_ontology')).toEqual([])                 // not even the ontology row: that is written only when a session exists
  })
})

// ── 4. static guards ────────────────────────────────────────────────────────
describe('static guards', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const f of readdirSync(dir)) {
      if (['node_modules', '.next', '.git'].includes(f)) continue
      const p = join(dir, f); const st = statSync(p)
      if (st.isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(f)) out.push(p)
    }
    return out
  }
  const files = ['app', 'lib', 'components', 'hooks'].flatMap(d => walk(join(root, d)))

  it('the pre-tag columns are read and written by exactly the files that own this feature, and nowhere else', () => {
    const allowed = new Set(['lib/chat-intake-pretag.ts'])
    const code = (rel: string) => readFileSync(join(root, rel), 'utf-8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')   // comments may mention it
    const offenders = files.map(f => f.slice(root.length + 1)).filter(rel => /pre_tag/.test(code(rel)) && !allowed.has(rel))
    expect(offenders).toEqual([])
  })
  it('the pre-tag helper and route never read or write the sessions table', () => {
    for (const rel of ['lib/chat-intake-pretag.ts', 'app/api/chat-intake/pretag/route.ts']) {
      expect(src(rel), rel).not.toMatch(/from\(\s*['"]sessions['"]\s*\)/)
      expect(src(rel), rel).not.toMatch(/from\(\s*['"]sessions_ontology['"]\s*\)/)
    }
  })
  it('the confirm screen only starts a pre-tag when the flag is on, once, fire-and-forget', () => {
    const cp = src('components/DecisionCheckpoint.tsx')
    expect(cp).toContain('isPreTagEnabled() && !pretagFired.current')
    expect(cp).toContain('/api/chat-intake/pretag')
    expect(cp).toMatch(/\.catch\(\(\) => \{ \/\* best-effort \*\/ \}\)/)
  })
  it('the migration is additive and idempotent: only new nullable columns on chat_intakes', () => {
    const sql = src('supabase/sprint_intake_v13_pretag.sql').split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(sql.match(/alter table/gi)?.length).toBe(4)
    expect(sql.match(/add column if not exists/gi)?.length).toBe(4)
    expect(sql).not.toMatch(/drop |delete |update |not null|sessions\b/i)
    expect(src('supabase/sprint_intake_v13_pretag.sql')).toContain('chat_intakes')
  })
  it('the validation moved out of the ontology route unchanged and is what both paths use', () => {
    expect(src('app/api/ontology/route.ts')).toContain("import { validateTag } from '@/lib/ontology-validate'")
    expect(src('lib/chat-intake-pretag.ts')).toContain("import { validateTag } from '@/lib/ontology-validate'")
    expect(validateTag(TAG())).toBe(true)
    expect(validateTag(TAG({ examiner_gap_3: '' }))).toBe(false)
    expect(validateTag(TAG({ scored_vector: { ...DIMS.reduce((a, d) => ({ ...a, [d]: { score: 2 } }), {}), identity_alignment: {} } }))).toBe(false)
  })
})
