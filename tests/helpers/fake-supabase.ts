// tests/helpers/fake-supabase.ts
// A small in-memory stand-in for the Supabase query builder: just the calls the pre-tag code and the routes it touches
// make (select / insert / update / upsert, eq / neq / is / or incl. nested and(...), order, limit, single / maybeSingle,
// and update(...).select()). It is deliberately strict: a filter value that does not match returns no rows, and a "missing
// column" can be simulated, so tests prove behaviour rather than just shape.

type Row = Record<string, any>
type Result = { data: any; error: any }

export class FakeDb {
  tables: Record<string, Row[]> = {}
  /** Any select/update that names one of these columns fails, like a column that was never migrated. */
  missingColumns = new Set<string>()
  log: { table: string; op: string; values?: Row }[] = []
  constructor(seed: Record<string, Row[]> = {}) { this.tables = JSON.parse(JSON.stringify(seed)) }
  rows(t: string) { return (this.tables[t] ??= []) }
  from(table: string) { return new Query(this, table) }
}

function splitTop(s: string): string[] {
  const out: string[] = []; let depth = 0, cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}

function evalTerm(term: string, row: Row): boolean {
  const and = term.match(/^and\((.*)\)$/)
  if (and) return splitTop(and[1]).every(t => evalTerm(t, row))
  const m = term.match(/^([a-z_]+)\.(is|neq|eq|lt|gt)\.(.*)$/)
  if (!m) throw new Error('fake-supabase: unsupported filter ' + term)
  const [, col, op, val] = m
  const v = row[col]
  switch (op) {
    case 'is':  return val === 'null' ? v == null : v === val
    case 'neq': return v != null && String(v) !== val          // SQL: NULL <> x is not true
    case 'eq':  return v != null && String(v) === val
    case 'lt':  return v != null && String(v) < val
    case 'gt':  return v != null && String(v) > val
  }
  return false
}

class Query implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select'
  private values: Row | undefined
  private filters: ((r: Row) => boolean)[] = []
  private cols = '*'
  private returning = false
  private onConflict: string | undefined
  private wantOne: 'single' | 'maybe' | null = null
  private orderBy: { col: string; asc: boolean } | null = null
  private max: number | null = null
  constructor(private db: FakeDb, private table: string) {}

  select(cols = '*') { if (this.op === 'select') this.cols = cols; else this.returning = true; return this }
  insert(v: Row) { this.op = 'insert'; this.values = v; return this }
  update(v: Row) { this.op = 'update'; this.values = v; return this }
  upsert(v: Row, o?: { onConflict?: string }) { this.op = 'upsert'; this.values = v; this.onConflict = o?.onConflict; return this }
  delete() { this.op = 'delete'; return this }
  eq(c: string, v: any)  { this.filters.push(r => r[c] === v); return this }
  neq(c: string, v: any) { this.filters.push(r => r[c] != null && r[c] !== v); return this }
  is(c: string, v: any)  { this.filters.push(r => (v === null ? r[c] == null : r[c] === v)); return this }
  in(c: string, vs: any[]) { this.filters.push(r => vs.includes(r[c])); return this }
  or(f: string) { this.filters.push(r => splitTop(f).some(t => evalTerm(t, r))); return this }
  order(c: string, o?: { ascending?: boolean }) { this.orderBy = { col: c, asc: o?.ascending !== false }; return this }
  limit(n: number) { this.max = n; return this }
  single() { this.wantOne = 'single'; return this }
  maybeSingle() { this.wantOne = 'maybe'; return this }

  private run(): Result {
    const rows = this.db.rows(this.table)
    const touched = [...(this.values ? Object.keys(this.values) : []), ...(this.op === 'select' && this.cols !== '*' ? this.cols.split(',').map(c => c.trim()) : [])]
    const bad = touched.find(c => this.db.missingColumns.has(c))
    if (bad) return { data: null, error: { message: `column ${bad} does not exist` } }
    this.db.log.push({ table: this.table, op: this.op, values: this.values })
    const match = (r: Row) => this.filters.every(f => f(r))
    let out: Row[] = []
    if (this.op === 'insert') {
      const row = { id: this.values!.id ?? `${this.table}-${rows.length + 1}`, ...this.values }
      rows.push(row); out = [row]
    } else if (this.op === 'upsert') {
      const key = this.onConflict
      const hit = key ? rows.find(r => r[key] === this.values![key]) : undefined
      if (hit) { Object.assign(hit, this.values); out = [hit] } else { const row = { ...this.values }; rows.push(row); out = [row] }
    } else if (this.op === 'update') {
      out = rows.filter(match); out.forEach(r => Object.assign(r, this.values))
    } else if (this.op === 'delete') {
      out = rows.filter(match); this.db.tables[this.table] = rows.filter(r => !match(r))
    } else {
      out = rows.filter(match)
      if (this.orderBy) { const { col, asc } = this.orderBy; out = [...out].sort((a, b) => (a[col] > b[col] ? 1 : -1) * (asc ? 1 : -1)) }
      if (this.max != null) out = out.slice(0, this.max)
    }
    if ((this.op === 'update' || this.op === 'delete') && !this.returning) return { data: null, error: null }
    if (this.wantOne) {
      if (out.length === 0) return { data: null, error: this.wantOne === 'single' ? { message: 'no rows' } : null }
      return { data: JSON.parse(JSON.stringify(out[0])), error: null }
    }
    return { data: JSON.parse(JSON.stringify(out)), error: null }
  }
  then<T1 = Result, T2 = never>(res?: ((v: Result) => T1 | PromiseLike<T1>) | null, rej?: ((e: any) => T2 | PromiseLike<T2>) | null): PromiseLike<T1 | T2> {
    try { return Promise.resolve(this.run()).then(res, rej) } catch (e) { return Promise.reject(e).then(res, rej) }
  }
}
