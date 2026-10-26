import { describe, it, expect } from 'vitest'
import { buildAdvisorDigest, buildAdvisorBlock } from '@/lib/synthesis-input'
import { serializePersonaContent } from '@/lib/persona-history'

// Original is deliberately LONGER than the old 800-char slice.
const LONG_PROSE = 'The real risk is the fragile timing between hire and deal. '.repeat(20)
const INITIAL = `<lens>Timing risk</lens><position>Do not quit now</position><realcost>You tolerate uncertainty.</realcost><lean>wait</lean>\n\n${LONG_PROSE}<reversal>If runway <estimate>under three months</estimate>, I reverse.</reversal>`

describe('buildAdvisorDigest (bug: old slice(0,800) dropped every challenge)', () => {
  const content = serializePersonaContent(INITIAL, [
    { kind: 'pushback', user: 'I have ₹25 lakh liquid and spouse income', reply: 'This strengthens waiting; runway is no longer binding.' },
    { kind: 'update',   info: 'Two interviews at MongoDB and Navikenz', reply: 'Interviews convert anxiety into optionality; stay until offers.' },
  ])

  it('the OLD behaviour lost the challenges (regression proof)', () => {
    expect(content.slice(0, 800)).not.toContain('25 lakh')
    expect(content.slice(0, 800)).not.toContain('MongoDB')
  })
  it('the digest contains every challenge and every reassessment', () => {
    const d = buildAdvisorDigest(content, { currentLean: 'wait' })
    expect(d).toContain('25 lakh')
    expect(d).toContain('MongoDB')
    expect(d).toContain('runway is no longer binding')
    expect(d).toContain('stay until offers')
    expect(d).toContain('CURRENT LEAN (use this, not the original): wait')
  })
  it('contains no raw tags and stays within budget', () => {
    const d = buildAdvisorDigest(content, { currentLean: 'proceed' })
    expect(d).not.toMatch(/<\/?(lens|position|realcost|lean|assumption|reversal|estimate)>/)
    expect(d.length).toBeLessThanOrEqual(2600)
  })
  it('a never-challenged advisor has no LATER section', () => {
    const d = buildAdvisorDigest(INITIAL)
    expect(d).not.toContain('LATER EXCHANGES')
    expect(d).toContain('Position: Do not quit now')
  })
  it('the synthesis input DIFFERS after a challenge (so the verdict has something to react to)', () => {
    const before = buildAdvisorBlock({ contrarian: INITIAL })
    const after  = buildAdvisorBlock({ contrarian: content })
    expect(after).not.toBe(before)
  })
})
