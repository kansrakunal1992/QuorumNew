// tests/first-screen-conversion-2.test.ts
// -- Round 2: campaign scenario links, one-tap start, voice, the wait for the first reply -----------------------
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { POST_SCENARIOS, SCENARIO_SLUG, scenarioText } from '../lib/post-scenarios'
import { INTAKE_EXAMPLES, INTAKE_QUICK_STARTS, QUICK_START_POSITION } from '../lib/intake-examples'
import { scoreRichness } from '../lib/chat-intake-brief'
import { MAX_PREFILL_CHARS } from '../lib/prefill'
import { readUrlDecisionPrefill, hasDecisionParam, urlWithoutParams } from '../lib/url-prefill'
import { mergeNotes } from '../lib/chat-intake-turn'
import { slotsFor } from '../lib/chat-intake-brief'
import type { ChatDecisionState } from '../lib/types'

const root = join(__dirname, '..')
const src = (rel: string) => readFileSync(join(root, rel), 'utf-8')
const UNVERIFIED_CLAIM = /\b(free|no\s*sign-?\s*up|no\s*signup|no\s*account|without\s+(an\s+)?account|\d+\s*(min|minute|minutes|sec|seconds)\b|in\s+minutes|instant(ly)?|guarantee[sd]?)\b/i

describe('1. campaign scenarios (?scenario=slug)', () => {
  it('slugs are unique, link-safe and include the four on-screen examples', () => {
    const slugs = POST_SCENARIOS.map(s => s.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const s of slugs) expect(s).toMatch(SCENARIO_SLUG)
    for (const e of INTAKE_EXAMPLES) expect(slugs).toContain(e.id)
  })
  it('every scenario is specific enough to grade medium or better, fits the prefill limit, and claims nothing', () => {
    for (const s of POST_SCENARIOS) {
      expect({ slug: s.slug, tier: scoreRichness(s.text).tier }).not.toEqual({ slug: s.slug, tier: 'sparse' })
      expect(s.text.length).toBeLessThanOrEqual(MAX_PREFILL_CHARS)
      expect(`${s.title} ${s.text}`).not.toMatch(UNVERIFIED_CLAIM)
    }
  })
  it('scenarioText returns null for unknown or malformed slugs', () => {
    expect(scenarioText('job_offers')).toContain('two job offers')
    expect(scenarioText(' JOB_OFFERS ')).toContain('two job offers')
    for (const bad of ['nope', '', '../etc', 'a', 'x'.repeat(80), null, undefined, 42]) expect(scenarioText(bad)).toBeNull()
  })
  it('the link fills the box exactly like ?decision= does, and ?decision= wins when both are there', () => {
    expect(readUrlDecisionPrefill('?scenario=job_offers&utm_source=linkedin')?.text).toBe(scenarioText('job_offers'))
    expect(readUrlDecisionPrefill('?decision=Should%20I%20move%3F&scenario=job_offers')?.text).toBe('Should I move?')
    expect(readUrlDecisionPrefill('?scenario=does_not_exist')).toBeNull()
    expect(readUrlDecisionPrefill('?decision=%20%20&scenario=job_offers')?.text).toBe(scenarioText('job_offers'))
  })
  it('it is tidied out of the address bar with the rest of the prefill, and every other parameter survives', () => {
    expect(hasDecisionParam('?scenario=job_offers')).toBe(true)
    expect(hasDecisionParam('?utm_source=x')).toBe(false)
    expect(urlWithoutParams('/', '?scenario=job_offers&utm_source=linkedin&utm_content=li_post_12', '', ['decision']))
      .toBe('/?utm_source=linkedin&utm_content=li_post_12')
    expect(urlWithoutParams('/', '?q=1&decision=hi&utm_campaign=c', '', ['q', 'decision'])).toBe('/?utm_campaign=c')
  })
  it('the link builder prints a link per post and refuses a typo', () => {
    const ok = spawnSync('node', ['scripts/build-post-links.mjs', 'scripts/post-calendar.sample.csv', 'https://example.test'], { cwd: root, encoding: 'utf-8' })
    expect(ok.status).toBe(0)
    expect(ok.stdout).toContain('https://example.test/?scenario=job_offers&utm_source=linkedin&utm_medium=post&utm_campaign=nov_gtm&utm_content=li_post_12')
    expect(ok.stdout).toContain('https://example.test/?utm_source=instagram&utm_medium=bio')   // empty scenario: plain link
    const badCsv = join(mkdtempSync(join(tmpdir(), 'qpl-')), 'bad.csv')
    writeFileSync(badCsv, 'source,medium,campaign,content,scenario\nlinkedin,post,c,x,job_offerz\n')
    const bad = spawnSync('node', ['scripts/build-post-links.mjs', badCsv], { cwd: root, encoding: 'utf-8' })
    expect(bad.status).toBe(1)
    expect(bad.stderr).toContain('Unknown scenario "job_offerz"')
  })
})

describe('2. one-tap start', () => {
  const ci = src('components/ChatIntake.tsx')
  it('six categories, unique ids, first-person text, no claims', () => {
    expect(INTAKE_QUICK_STARTS).toHaveLength(6)
    expect(new Set(INTAKE_QUICK_STARTS.map(q => q.id)).size).toBe(6)
    for (const q of INTAKE_QUICK_STARTS) {
      expect(q.id).toMatch(/^qs_[a-z]+$/)
      expect(q.text.startsWith('It\u2019s')).toBe(true)
      expect(`${q.label} ${q.text}`).not.toMatch(UNVERIFIED_CLAIM)
    }
  })
  it('a tap sends the first message in guided mode, tagged on starter_picked; it is not a prefill', () => {
    const fn = ci.slice(ci.indexOf('function handleQuickStart'), ci.indexOf('// Voice: the transcript arrives'))
    expect(fn).toContain("track('starter_picked', { placement: 'quick_start', example: id, position: QUICK_START_POSITION })")
    expect(fn).toContain('void send(text, undefined, { walkthrough: true })')
    expect(fn).not.toContain('setInput')
  })
  it('the per-call walkthrough override reaches the server, and the typed path is unchanged', () => {
    expect(ci).toContain('walkthrough:    !chatIntakeId && (opts?.walkthrough ?? walkthrough) ? true : undefined,')
    expect(ci).toContain("track('decision_started', { entry: 'chat', from_notification: fromNotification, flow_version: INTAKE_FLOW_VERSION, ...prefillSendProps(prefillAppliedRef.current, trimmed) })")
  })
  it('the pills sit under the button (default since round 4), only when the sign-in gate is not showing, and lock while sending', () => {
    const hero = ci.slice(ci.indexOf('Hero \u2014 "Quorum is ready to think with me,'))
    const input = hero.indexOf('{inputForm}')
    const above = hero.indexOf("{!gated && QUICK_START_POSITION === 'above' && (")
    const below = hero.indexOf("{!gated && QUICK_START_POSITION === 'below' && (")
    const row   = hero.indexOf('<IntakeVideoLink')
    expect(above).toBeGreaterThan(-1)
    expect(above).toBeLessThan(input)                       // the 'above' option is still there, out in front of the box
    expect(below).toBeGreaterThan(input)                    // the default sits under the button (and the voice row, inside the form)
    expect(below).toBeLessThan(row)                         // and above the one-line links row
    expect(hero.match(/<IntakeQuickStarts onPick=\{handleQuickStart\} disabled=\{sending\} \/>/g)).toHaveLength(2)
    expect(src('components/IntakeQuickStarts.tsx')).toContain("type=\"button\"")
  })
  it('the position is a build-time switch that defaults to under the button, and it is reported on every tap', () => {
    const ex = src('lib/intake-examples.ts')
    expect(ex).toContain("process.env.NEXT_PUBLIC_QUICK_START_POSITION === 'above' ? 'above' : 'below'")
    expect(QUICK_START_POSITION).toBe('below')
    expect(ci).toContain("track('starter_picked', { placement: 'quick_start', example: id, position: QUICK_START_POSITION })")
  })
  it('the label and pills claim nothing, and the pills are a comfortable tap size', () => {
    const c = src('components/IntakeQuickStarts.tsx')
    expect(c).toContain('Start with a tap: what kind of decision is it?')
    expect(c).not.toMatch(UNVERIFIED_CLAIM)
    expect(c).toContain('minHeight: 40')
  })
})

describe('3. voice', () => {
  const ci = src('components/ChatIntake.tsx')
  it('the landing screen has a labelled voice row under the button, not an unlabelled icon in the corner', () => {
    expect(ci).toContain('{!started && <VoiceInput onStart={handleVoiceStart} onTranscript={handleVoiceTranscript} />}')
    expect(ci).not.toContain("position: 'absolute', right: 8, bottom: 8")
    expect(ci).toContain("padding: '11px 14px',")
  })
  it('the transcript replaces the dictated part instead of being appended (the whole dictation arrives each time)', () => {
    expect(ci).toContain('setInput(base ? `${base} ${t}` : t)')
    expect(ci).not.toContain('setInput(prev => (prev ? `${prev} ${t}` : t))')
    expect(ci).toContain("voiceBaseRef.current = inputRef.current?.value ?? ''")
    expect(src('hooks/useSoniox.ts')).toContain('finalTextRef.current += payload.finalText')   // why: it is cumulative
  })
  it('VoiceInput tells the parent when the mic is pressed, in both idle layouts, and stays backward compatible', () => {
    const v = src('components/VoiceInput.tsx')
    expect(v).toContain('onStart?: () => void')
    expect((v.match(/onClick=\{\(\) => \{ onStart\?\.\(\); start\(\) \}\}/g) ?? []).length).toBe(2)
    expect(v).toContain('compact = false, onStart')
  })
})

describe('4. the wait for a reply', () => {
  const ci = src('components/ChatIntake.tsx')
  it('after 4 seconds the wait says what is happening, and after 10 that it is still going; it resets every turn', () => {
    expect(ci).toContain('waitSecs >= 4 &&')
    expect(ci).toContain('Reading what you wrote')
    expect(ci).toContain('Still thinking')
    expect(ci).toContain('if (!sending) { setWaitSecs(0); return }')
    expect(ci).toContain('role="status" aria-live="polite"')
  })
  it('the planner is asked for what is new or changed, not the whole note again', () => {
    const p = src('lib/chat-intake-planner.ts')
    expect(p).toContain('RETURN ONLY WHAT IS NEW OR CHANGED THIS TURN')
    expect(p).not.toContain("carry forward; do not drop anything")
    expect(p).toContain('PLANNER_MAX_TOKENS = 1400')
  })
  it('a delta is safe: merging only the new facts keeps everything already known', () => {
    const slots = slotsFor('career').map(s => s.key)
    expect(slots.length).toBeGreaterThan(2)
    const [a, b] = slots
    const prior = {
      decisionKind: 'career', decisionStatement: 'Should I take the offer?',
      facts: { [a]: 'the higher-paying offer' },
      options: [{ label: 'Take it', type: 'act' }, { label: 'Stay', type: 'dont_act' }],
      assumptions: ['I can negotiate'],
    } as unknown as ChatDecisionState
    const merged = mergeNotes(prior, { facts: { [b]: 'by Friday' } } as never, { userText: 'by Friday' })
    expect(merged.facts?.[a]).toBe('the higher-paying offer')
    expect(merged.facts?.[b]).toBe('by Friday')
    expect(merged.options).toHaveLength(2)
    expect(merged.decisionStatement).toBe('Should I take the offer?')
    expect(merged.assumptions).toContain('I can negotiate')
  })
  it('the route makes fewer sequential round trips', () => {
    const r = src('app/api/chat-intake/route.ts')
    expect(r).toContain('existingMsgsPromise = Promise.resolve(supabase')            // transcript fetched with the row...
    expect(r).toContain('let existingMsgsPromise')
    expect(r).toContain('existingMsgsPromise ? (await existingMsgsPromise).data : []') // ...and skipped for a brand-new chat
    expect(r).toContain('userInsert = Promise.resolve(supabase.from(')                // user save overlaps the planner
    const userAwait  = r.indexOf('await userInsert')
    const quorumSave = r.indexOf("role:           'quorum'")
    expect(userAwait).toBeGreaterThan(r.indexOf('planTurn('))
    expect(userAwait).toBeLessThan(quorumSave)                                        // user turn is always stored first
    expect(r).toContain('const [{ error: insertQuorumErr }] = await Promise.all([')   // reply + state saved together
    expect(r).toContain('fetchIntakeBackground(serverUserId, decisionHint, exchangeCount, intakeId)')
  })
})
