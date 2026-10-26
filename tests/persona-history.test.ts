import { describe, it, expect } from 'vitest'
import {
  buildInitialMessages, parsePersonaContent, serializePersonaContent,
  buildAdvisorConversation, buildNewInfoMessage, NEW_INFO_PREFIX, extractNewInfo,
} from '@/lib/persona-history'

const INITIAL = '<lens>L</lens><position>Do not quit now</position><realcost>RC</realcost><lean>wait</lean>\n\nOriginal analysis text.'

describe('serialize ⇄ parse', () => {
  it('round-trips pushbacks and updates in chronological order', () => {
    const s = serializePersonaContent(INITIAL, [
      { kind: 'pushback', user: 'I have 25 lakh saved', reply: 'Reply 1' },
      { kind: 'update',   info: 'Two interviews lined up', reply: 'Reply 2' },
      { kind: 'pushback', user: 'Second challenge', reply: 'Reply 3' },
    ])
    const p = parsePersonaContent(s)
    expect(p.initial).toBe(INITIAL)
    expect(p.history.map(h => h.kind)).toEqual(['pushback', 'update', 'pushback'])
    expect((p.history[1] as any).info).toBe('Two interviews lined up')
    expect(p.history[2].reply).toBe('Reply 3')
  })
  it('legacy marker without info still parses', () => {
    const p = parsePersonaContent(`${INITIAL}\n\n[Updated after Examiner answers]\nR`)
    expect(p.history).toEqual([{ kind: 'update', info: '', reply: 'R' }])
  })
})

describe('buildInitialMessages — reload hydration (bug: V1 verdict wins / merged blob)', () => {
  const rows = [
    { persona: 'contrarian', role: 'assistant', content: INITIAL },
    { persona: 'synthesis',  role: 'assistant', content: '<verdict>V1 wait</verdict>' },
    { persona: 'contrarian', role: 'user',      content: 'I have 25 lakh saved' },
    { persona: 'contrarian', role: 'assistant', content: '<pushback_classification>materially_valid</pushback_classification>Reply 1 <assumption>A</assumption>' },
    { persona: 'elder',      role: 'assistant', content: 'Elder initial' },
    { persona: 'elder',      role: 'user',      content: buildNewInfoMessage('I have 25 lakh saved') },
    { persona: 'elder',      role: 'assistant', content: 'Elder update' },
    { persona: 'synthesis',  role: 'assistant', content: '<verdict>V2 proceed</verdict>' },
    { persona: 'contrarian', role: 'user',      content: buildNewInfoMessage('Two interviews') },
    { persona: 'contrarian', role: 'assistant', content: 'Contrarian update' },
    { persona: 'synthesis',  role: 'assistant', content: '<verdict>V3 stay</verdict>' },
  ]
  const out = buildInitialMessages(rows)

  it('synthesis is the NEWEST row only, never a concatenation', () => {
    expect(out.synthesis).toBe('<verdict>V3 stay</verdict>')
    expect(out.synthesis).not.toContain('V1')
  })
  it('classifies pushback vs share-context update from the preceding user row', () => {
    const c = parsePersonaContent(out.contrarian)
    expect(c.initial).toBe(INITIAL)
    expect(c.history.map(h => h.kind)).toEqual(['pushback', 'update'])
    expect((c.history[0] as any).user).toBe('I have 25 lakh saved')
    expect((c.history[1] as any).info).toBe('Two interviews')
    const e = parsePersonaContent(out.elder)
    expect(e.history).toEqual([{ kind: 'update', info: 'I have 25 lakh saved', reply: 'Elder update' }])
  })
  it('a retried INITIAL call (no user turn between) replaces, not appends', () => {
    const r = buildInitialMessages([
      { persona: 'elder', role: 'assistant', content: 'broken first try' },
      { persona: 'elder', role: 'assistant', content: 'good retry' },
    ])
    expect(r.elder).toBe('good retry')
  })
  it('extractNewInfo inverts buildNewInfoMessage', () => {
    expect(extractNewInfo(buildNewInfoMessage('hello "world"'))).toBe('hello "world"')
    expect(buildNewInfoMessage('x').startsWith(NEW_INFO_PREFIX)).toBe(true)
  })
})

describe('buildAdvisorConversation (bug: advisor never saw its own prior replies)', () => {
  it('alternates assistant/user, starts with the original analysis, ends with the new turn', () => {
    const turns = buildAdvisorConversation(INITIAL, [
      { kind: 'pushback', user: 'c1', reply: 'r1' },
      { kind: 'update', info: 'i2', reply: 'r2' },
    ], 'c3')
    expect(turns.map(t => t.role)).toEqual(['assistant', 'user', 'assistant', 'user', 'assistant', 'user'])
    expect(turns[0].content).toContain('<lean>wait</lean>')   // lean visible ⇒ anchorable
    expect(turns[turns.length - 1].content).toBe('c3')
  })
  it('first challenge: [assistant(original), user]', () => {
    expect(buildAdvisorConversation(INITIAL, [], 'c1').map(t => t.role)).toEqual(['assistant', 'user'])
  })
})
