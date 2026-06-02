/**
 * app/api/admin/encrypt-migrate/route.ts
 * ── One-shot backfill: encrypt all existing plaintext rows ────────────────────
 *
 * POST /api/admin/encrypt-migrate
 * Auth: Authorization: Bearer <ADMIN_CODE>   (same as other admin routes)
 *
 * Run ONCE after deploying DB_ENCRYPTION_KEY to Railway.
 * Safe to call multiple times — skips rows already starting with 'enc:'.
 *
 * Returns JSON progress report.
 *
 * DELETE THIS FILE after the migration succeeds.
 */

import { NextResponse }        from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { encrypt, encryptJson } from '@/lib/encryption'

const BATCH = 200

// ── Auth ──────────────────────────────────────────────────────────────────────

function checkAuth(req: Request): boolean {
  const auth  = req.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  return Boolean(token && process.env.ADMIN_CODE && token === process.env.ADMIN_CODE)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isPlaintext(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.startsWith('enc:')
}

async function migrateTextColumns(
  tableName: string,
  idCol: string,
  cols: string[],
): Promise<{ table: string; updated: number; skipped: number; errors: number }> {
  const supabase = createServiceClient()
  let updated = 0, skipped = 0, errors = 0, offset = 0

  while (true) {
    const { data: rows, error } = await supabase
      .from(tableName)
      .select([idCol, ...cols].join(', '))
      .range(offset, offset + BATCH - 1)

    if (error || !rows) break
    if (rows.length === 0) break

    for (const row of rows) {
      const patch: Record<string, unknown> = {}
      let dirty = false

      for (const col of cols) {
        const val = (row as Record<string, unknown>)[col]
        if (isPlaintext(val)) {
          patch[col] = encrypt(val)
          dirty = true
        }
      }

      if (dirty) {
        const { error: upErr } = await supabase
          .from(tableName)
          .update(patch)
          .eq(idCol, row[idCol])

        if (upErr) { errors++; console.error(`[migrate] ${tableName}.${idCol}=${row[idCol]}:`, upErr.message) }
        else updated++
      } else {
        skipped++
      }
    }

    offset += BATCH
    if (rows.length < BATCH) break
  }

  return { table: tableName, updated, skipped, errors }
}

async function migrateMatchesJson(): Promise<{ table: string; updated: number; skipped: number; errors: number }> {
  const supabase = createServiceClient()
  let updated = 0, skipped = 0, errors = 0, offset = 0

  while (true) {
    const { data: rows, error } = await supabase
      .from('structural_matches')
      .select('id, matches_json')
      .range(offset, offset + BATCH - 1)

    if (error || !rows) break
    if (rows.length === 0) break

    for (const row of rows) {
      const val = row.matches_json
      // Skip if already encrypted { _enc: ... } or null
      if (!val || (typeof val === 'object' && !Array.isArray(val) && '_enc' in (val as object))) {
        skipped++
        continue
      }
      // Plaintext array → encrypt and wrap
      const { error: upErr } = await supabase
        .from('structural_matches')
        .update({ matches_json: encryptJson(val) })
        .eq('id', row.id)

      if (upErr) { errors++; console.error(`[migrate] structural_matches.id=${row.id}:`, upErr.message) }
      else updated++
    }

    offset += BATCH
    if (rows.length < BATCH) break
  }

  return { table: 'structural_matches.matches_json', updated, skipped, errors }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.DB_ENCRYPTION_KEY) {
    return NextResponse.json({
      error: 'DB_ENCRYPTION_KEY is not set in Railway — set it before running migration',
    }, { status: 500 })
  }

  console.log('[EncryptMigrate] Starting backfill...')
  const start = Date.now()

  const results = await Promise.all([
    migrateTextColumns('sessions',           'id',         ['decision_text', 'context_text']),
    migrateTextColumns('messages',           'id',         ['content']),
    migrateTextColumns('examiner_responses', 'id',         ['question_text', 'response_text']),
    migrateTextColumns('outcomes',           'session_id', ['what_decided', 'notes']),
    migrateTextColumns('structural_matches', 'id',         ['context_block']),
    migrateMatchesJson(),
  ])

  const totalUpdated = results.reduce((s, r) => s + r.updated, 0)
  const totalErrors  = results.reduce((s, r) => s + r.errors,  0)

  console.log(`[EncryptMigrate] Done in ${Date.now() - start}ms. Updated: ${totalUpdated}, Errors: ${totalErrors}`)

  return NextResponse.json({
    ok:           totalErrors === 0,
    duration_ms:  Date.now() - start,
    total_updated: totalUpdated,
    total_errors:  totalErrors,
    breakdown:    results,
    note:         totalErrors === 0
      ? 'Migration complete. You can now delete app/api/admin/encrypt-migrate/route.ts'
      : 'Some rows failed — check Railway logs and re-run',
  })
}
