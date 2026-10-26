import { describe, it, expect } from 'vitest'
import { parseDisplayTags, stripDisplayTags, orderKinds } from '@/lib/display-tags'

const flat = (s: string) => parseDisplayTags(s).filter(i => i.type === 'text').map(i => (i as any).text).join('')
const noRawTags = (s: string) => !/<\/?(assumption|reversal|estimate)>/i.test(s)

describe('parseDisplayTags — nesting safety (bug: tag formatting broken)', () => {
  // Exact shape from the live Contrarian response that rendered as
  // "…resignation.three monthsestimate of expenses…</reversal>"
  const nested =
    'Do not quit now.\n\n<reversal>If you learn your savings cover less than <estimate>three months</estimate> of expenses and you cannot secure interviews, I reverse to recommending resignation.</reversal>'

  it('never emits a raw tag and never duplicates prose when <estimate> is inside <reversal>', () => {
    const text = flat(nested)
    expect(noRawTags(text)).toBe(true)
    expect(text).toBe(
      'Do not quit now.\n\nIf you learn your savings cover less than three months of expenses and you cannot secure interviews, I reverse to recommending resignation.')
    expect(text.match(/three months/g)).toHaveLength(1)
  })

  it('marks the nested run with BOTH kinds, outer first', () => {
    const run = parseDisplayTags(nested).find(i => i.type === 'text' && /three months/.test((i as any).text)) as any
    expect(orderKinds(run.kinds)).toEqual(['reversal', 'estimate'])
  })

  it('emits exactly one estimate marker per paired estimate', () => {
    const items = parseDisplayTags('a <estimate>6</estimate> b <estimate>12</estimate> c')
    expect(items.filter(i => i.type === 'estimateMarker')).toHaveLength(2)
  })

  it('handles estimate inside assumption inside reversal-adjacent text', () => {
    const t = '<assumption>Runway of <estimate>9 months</estimate> holds.</assumption> Then <reversal>If X, I flip.</reversal>'
    const text = flat(t)
    expect(text).toBe('Runway of 9 months holds. Then If X, I flip.')
  })

  it('ignores stray closers and unclosed openers without losing prose', () => {
    expect(flat('before </reversal> after')).toBe('before  after')
    expect(flat('x <estimate>twelve weeks and more')).toBe('x twelve weeks and more')
    const items = parseDisplayTags('x <estimate>twelve weeks')
    expect(items.every(i => i.type !== 'text' || (i as any).kinds.length === 0)).toBe(true) // unclosed ⇒ not highlighted
  })

  it('handles several tag pairs in one blob (the reload-merged shape)', () => {
    const blob = '<assumption>A1</assumption> p1 <reversal>R1</reversal>\n\n<assumption>A2</assumption> p2 <reversal>R2</reversal>'
    const text = flat(blob)
    expect(noRawTags(text)).toBe(true)
    expect(text).toBe('A1 p1 R1\n\nA2 p2 R2')
  })

  it('is case-insensitive', () => { expect(flat('<Estimate>4</ESTIMATE>')).toBe('4') })
})

describe('stripDisplayTags', () => {
  it('removes markers, keeps content', () => {
    expect(stripDisplayTags('<reversal>If <estimate>3</estimate> months</reversal>')).toBe('If 3 months')
  })
  it('streaming mode cuts a half-received marker at the end only', () => {
    expect(stripDisplayTags('runway <estim', { streaming: true })).toBe('runway ')
    expect(stripDisplayTags('runway </rever', { streaming: true })).toBe('runway ')
    expect(stripDisplayTags('a < b', { streaming: true })).toBe('a < b')
    expect(stripDisplayTags('runway <estim')).toBe('runway <estim')
  })
})
