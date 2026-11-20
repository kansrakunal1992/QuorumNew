import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── in-memory fake of the pieces of Supabase the route uses ──────────────────
type Row = Record<string, any>
const db: { outbox: Row[]; sends: Row[]; candidates: Row[]; emails: Record<string, string | null> } = { outbox: [], sends: [], candidates: [], emails: {} }
const sentMail: Row[] = []
const nudges: string[] = []
let gate: (id: string) => boolean = () => true
let mailOk = true

function builder(table: 'gtm_outbox' | 'gtm_lifecycle_sends') {
  const rows = () => (table === 'gtm_outbox' ? db.outbox : db.sends)
  const filters: ((r: Row) => boolean)[] = []
  let op: 'select' | 'update' | 'delete' | 'insert' = 'select', patch: Row = {}, head = false, ins: Row | null = null
  const b: any = {
    select(_c?: string, o?: { head?: boolean }) { op = 'select'; head = !!o?.head; return b },
    eq(k: string, v: any) { filters.push(r => r[k] === v); return b },
    gte(k: string, v: any) { filters.push(r => r[k] >= v); return b },
    gt(k: string, v: any) { filters.push(r => r[k] > v); return b },
    in(k: string, vs: any[]) { filters.push(r => vs.includes(r[k])); return b },
    order() { return b },
    insert(r: Row) { op = 'insert'; ins = r; return b },
    update(p: Row) { op = 'update'; patch = p; return b },
    delete() { op = 'delete'; return b },
    then(res: any, rej: any) {
      const run = () => {
        if (op === 'insert') {
          if (table === 'gtm_lifecycle_sends' && db.sends.some(s => s.program_id === ins!.program_id && s.user_id === ins!.user_id)) return { data: null, error: { code: '23505', message: 'dup' } }
          rows().push({ ...ins }); return { data: null, error: null }
        }
        const m = rows().filter(r => filters.every(f => f(r)))
        if (op === 'update') { m.forEach(r => Object.assign(r, patch)); return { data: null, error: null } }
        if (op === 'delete') { const keep = rows().filter(r => !m.includes(r)); rows().length = 0; rows().push(...keep); return { data: null, error: null } }
        return head ? { count: m.length, data: null, error: null } : { data: m.map(r => ({ ...r })), error: null }
      }
      return Promise.resolve(run()).then(res, rej)
    },
  }
  return b
}
vi.mock('@/lib/supabase', () => ({
  createServiceClient: () => ({
    from: (t: any) => builder(t),
    rpc: async () => ({ data: db.candidates, error: null }),
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: db.emails[id] ? { email: db.emails[id] } : null } }) } },
  }),
}))
vi.mock('@/lib/notification-throttle', () => ({ canSendNudge: async (id: string) => gate(id), recordNudge: async (id: string) => { nudges.push(id) } }))
vi.mock('@/lib/cron-email', () => ({
  buildSimpleEmailHtml: (o: Row) => `<html>${o.title}|${o.ctaUrl}|${o.unsubUrl}</html>`,
  sendEmail: async (o: Row) => { if (!mailOk) return false; sentMail.push(o); return true },
}))

import { POST } from '@/app/api/cron/gtm-lifecycle/route'
import { isHoldout } from '@/lib/gtm-lifecycle'

const PROG = 'aaaaaaaa-0000-0000-0000-000000000001'
const good = [{ subject: 'Your second decision', lead: 'Lead', cta_label: 'Open', cta_path: '/start' }]
const call = (q = '', auth = 'Bearer s3cret') => POST(new Request(`http://x/api/cron/gtm-lifecycle${q}`, { method: 'POST', headers: { authorization: auth } }))
const ids = (n: number, holdout: boolean | null = null) => {   // generate user ids with a given arm at holdout 20%
  const out: string[] = []
  for (let i = 0; out.length < n && i < 10000; i++) { const id = `user-${i}`; if (holdout === null || isHoldout(id, PROG, 20) === holdout) out.push(id) }
  return out
}
function seed(users: string[], extra: Row = {}) {
  db.outbox = [{ id: PROG, slug: 'second-decision', segment_key: 'locked_no_second', holdout_pct: 20, max_per_run: 50, cooldown_days: 7, status: 'pending', copy_variants: good, ends_at: '2099-01-01', created_at: 'x', ...extra }]
  db.candidates = users.map(user_id => ({ user_id })); users.forEach(u => { db.emails[u] = `${u}@example.com` })
}

beforeEach(() => {
  db.outbox = []; db.sends = []; db.candidates = []; db.emails = {}; sentMail.length = 0; nudges.length = 0; gate = () => true; mailOk = true
  process.env.CRON_SECRET = 's3cret'; process.env.GTM_LIFECYCLE_ENABLED = 'true'; process.env.NEXT_PUBLIC_APP_URL = 'https://app.quorumvault.org'; delete process.env.GTM_LIFECYCLE_DAILY_CAP
})

describe('gtm-lifecycle cron', () => {
  it('rejects missing or wrong credentials', async () => {
    expect((await call('', 'Bearer nope')).status).toBe(401)
    expect((await POST(new Request('http://x', { method: 'POST' }))).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await call()).status).toBe(401)
  })

  it('does nothing unless explicitly enabled', async () => {
    process.env.GTM_LIFECYCLE_ENABLED = 'false'; seed(ids(5))
    const j = await (await call()).json()
    expect(j.disabled).toBe(true); expect(sentMail.length).toBe(0); expect(db.sends.length).toBe(0)
  })

  it('dry run reports counts but sends and writes nothing', async () => {
    seed(ids(30)); const j = await (await call('?dry=1')).json()
    expect(j.dry).toBe(true); expect(j.sent + j.holdout).toBe(30)
    expect(sentMail.length).toBe(0); expect(db.sends.length).toBe(0); expect(nudges.length).toBe(0); expect(db.outbox[0].status).toBe('pending')
  })

  it('emails the delivered arm, records the holdout arm without emailing, and activates the program', async () => {
    const hold = ids(4, true), deliv = ids(6, false); seed([...hold, ...deliv])
    const j = await (await call()).json()
    expect(j).toMatchObject({ sent: 6, holdout: 4, errors: 0 })
    expect(sentMail.map(m => m.to).sort()).toEqual(deliv.map(u => `${u}@example.com`).sort())
    for (const h of hold) expect(sentMail.some(m => m.to === `${h}@example.com`)).toBe(false)
    expect(db.sends.filter(s => s.arm === 'holdout' && s.status === 'holdout').length).toBe(4)
    expect(db.sends.filter(s => s.arm === 'delivered' && s.status === 'sent' && s.sent_at).length).toBe(6)
    expect(nudges.sort()).toEqual([...deliv].sort())           // shared gate told about delivered users only
    expect(db.outbox[0].status).toBe('active')
  })

  it('the email links only into the app and carries a lifecycle unsubscribe link', async () => {
    seed(ids(1, false), { copy_variants: [{ subject: 'S', lead: 'L', cta_label: 'Go', cta_path: 'https://evil.example/phish' }] })
    await call(); const html: string = sentMail[0].html
    expect(html).toContain('https://app.quorumvault.org/?n=gtm_second-decision&utm_source=quorum_lifecycle')
    expect(html).not.toContain('evil.example'); expect(html).toContain('/api/cron/unsubscribe?token=')
  })

  it('never double-sends: a second run, or an existing claim, produces no new email', async () => {
    const u = ids(3, false); seed(u); await call(); expect(sentMail.length).toBe(3)
    await call(); expect(sentMail.length).toBe(3)
    sentMail.length = 0; db.sends = [{ program_id: PROG, user_id: u[0], arm: 'delivered', status: 'claimed' }]; db.outbox[0].status = 'active'
    await call(); expect(sentMail.some(m => m.to === `${u[0]}@example.com`)).toBe(false)
  })

  it('a failed send frees the claim so the user is retried next run, and is not recorded as nudged', async () => {
    const u = ids(2, false); seed(u); mailOk = false
    const j = await (await call()).json()
    expect(j.errors).toBe(2); expect(j.sent).toBe(0); expect(db.sends.length).toBe(0); expect(nudges.length).toBe(0)
    mailOk = true; await call(); expect(sentMail.length).toBe(2)
  })

  it('respects the shared 3-day gate and does not assign an arm to gated users', async () => {
    const u = ids(6); seed(u); gate = id => id !== u[0] && id !== u[1]
    const j = await (await call()).json()
    expect(j.deferred).toBe(2); expect(db.sends.some(s => s.user_id === u[0] || s.user_id === u[1])).toBe(false)
  })

  it('stops at max_per_run and at the global daily cap', async () => {
    seed(ids(40, false), { max_per_run: 5 }); expect((await (await call()).json()).sent).toBe(5)
    db.sends = []; sentMail.length = 0; db.outbox[0].max_per_run = 50; process.env.GTM_LIFECYCLE_DAILY_CAP = '7'
    expect((await (await call()).json()).sent).toBe(7)
    expect((await (await call()).json()).sent).toBe(0)         // cap already used up today
  })

  it('skips users with no email, and programs with no usable copy', async () => {
    const u = ids(2, false); seed(u); db.emails[u[0]] = null
    const j = await (await call()).json(); expect(j.sent).toBe(1); expect(j.skipped).toBe(1)
    seed(ids(2, false), { copy_variants: [{ subject: 'no lead or button' }] }); sentMail.length = 0; db.sends = []
    const k = await (await call()).json(); expect(k.sent).toBe(0); expect(k.skipped).toBe(1)
  })
})
