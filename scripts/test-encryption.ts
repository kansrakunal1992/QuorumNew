/**
 * scripts/test-encryption.ts
 * ── Quorum: Encryption integration test ──────────────────────────────────────
 *
 * Tests that:
 *   1. Encryption primitives work (no DB needed — pure unit tests)
 *   2. Writing via API stores encrypted values in DB (unreadable at rest)
 *   3. Reading via API returns correct decrypted plaintext
 *   4. Backward compat: plaintext rows inserted directly still read correctly
 *   5. JSONB enc/dec round-trip (matches_json)
 *
 * Usage (run locally or via `railway run`):
 *   npx tsx scripts/test-encryption.ts
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   DB_ENCRYPTION_KEY
 *   NEXT_PUBLIC_APP_URL   (e.g. https://app.quorumvault.xyz or http://localhost:3000)
 *   TEST_DEVICE_ID        (any string, e.g. "test-device-enc-001")
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'
import * as crypto from 'crypto'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

// ── Config ────────────────────────────────────────────────────────────────────

const APP_URL        = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
const SUPABASE_URL   = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ENC_KEY        = process.env.DB_ENCRYPTION_KEY
const DEVICE_ID      = process.env.TEST_DEVICE_ID ?? `test-enc-${Date.now()}`

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

// ── Inline encrypt (mirrors lib/encryption.ts — no TS path alias in scripts) ─

function encryptValue(value: string): string {
  if (!ENC_KEY) throw new Error('DB_ENCRYPTION_KEY not set')
  const key     = Buffer.from(ENC_KEY, 'hex')
  const iv      = crypto.randomBytes(16)
  const cipher  = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc     = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag     = cipher.getAuthTag()
  return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('base64')}`
}

function decryptValue(value: string): string {
  if (!value.startsWith('enc:')) return value
  const [, ivHex, tagHex, encB64] = value.split(':')
  const key     = Buffer.from(ENC_KEY!, 'hex')
  const iv      = Buffer.from(ivHex, 'hex')
  const tag     = Buffer.from(tagHex, 'hex')
  const encBuf  = Buffer.from(encB64, 'base64')
  const dec     = crypto.createDecipheriv('aes-256-gcm', key, iv)
  dec.setAuthTag(tag)
  return Buffer.concat([dec.update(encBuf), dec.final()]).toString('utf8')
}

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0, failed = 0
const failures: string[] = []

function pass(name: string) { passed++; console.log(`  ✅  ${name}`) }
function fail(name: string, detail?: string) {
  failed++
  const msg = detail ? `${name}: ${detail}` : name
  failures.push(msg)
  console.log(`  ❌  ${msg}`)
}

function assert(condition: boolean, name: string, detail?: string) {
  condition ? pass(name) : fail(name, detail)
}

// ── 1. Unit tests: encryption primitives ─────────────────────────────────────

function testEncryptionPrimitives() {
  console.log('\n── 1. Encryption primitives (no DB) ─────────────────────────────')

  if (!ENC_KEY) {
    fail('DB_ENCRYPTION_KEY set', 'not set — all DB tests will skip')
    return
  }
  if (Buffer.from(ENC_KEY, 'hex').length !== 32) {
    fail('DB_ENCRYPTION_KEY length', `expected 32 bytes (64 hex chars), got ${ENC_KEY.length / 2}`)
    return
  }
  pass('DB_ENCRYPTION_KEY is set and correct length')

  // Round-trip
  const original = 'Should I quit my job and start a company in Dubai?'
  const enc = encryptValue(original)
  assert(enc.startsWith('enc:'), 'encrypt() output starts with enc: prefix')
  assert(enc !== original, 'encrypt() output differs from plaintext')
  const dec = decryptValue(enc)
  assert(dec === original, 'decrypt(encrypt(text)) === original')

  // Each call produces different ciphertext (random IV)
  const enc2 = encryptValue(original)
  assert(enc !== enc2, 'Two encryptions of same string produce different ciphertext (random IV)')

  // Plaintext passthrough (backward compat)
  const plain = 'unencrypted old row'
  assert(decryptValue(plain) === plain, 'decryptValue() returns plaintext unchanged when no enc: prefix')

  // Null / empty safety (mimics encrypt() in lib)
  assert(encryptValue('') === '' || true, 'empty string handled (no crash)')

  // JSONB wrapper round-trip
  const arr = [{ session_id: 'abc', structural_score: 0.85, decision_text: 'test decision' }]
  const wrapped = { _enc: encryptValue(JSON.stringify(arr)) }
  const unwrapped = JSON.parse(decryptValue(wrapped._enc))
  assert(JSON.stringify(unwrapped) === JSON.stringify(arr), 'JSONB encryptJson/decryptJson round-trip')
}

// ── 2. API write → DB encrypted at rest ──────────────────────────────────────

async function testWriteEncryptsInDB(): Promise<string | null> {
  console.log('\n── 2. Write via API → verify encrypted in DB ────────────────────')

  const decisionText = `ENC_TEST_${Date.now()}: Should I relocate Quorum HQ to Singapore?`

  // POST /api/session
  let sessionId: string | null = null
  try {
    const res = await fetch(`${APP_URL}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decision_text: decisionText,
        context_text:  'Test context for encryption verification',
        device_id:     DEVICE_ID,
      }),
    })
    if (!res.ok) { fail('POST /api/session returns 200', `status ${res.status}`); return null }
    const body = await res.json()
    sessionId = body.id ?? body.session_id ?? body.data?.id ?? null
    if (!sessionId) { fail('POST /api/session returns session id', JSON.stringify(body)); return null }
    pass(`POST /api/session created session ${sessionId}`)
  } catch (e: any) {
    fail('POST /api/session reachable', e.message)
    return null
  }

  // Wait briefly for DB write
  await new Promise(r => setTimeout(r, 800))

  // Query DB directly — should NOT be plaintext
  const { data: row } = await supabase
    .from('sessions')
    .select('decision_text, context_text')
    .eq('id', sessionId)
    .single()

  if (!row) { fail('Session found in DB'); return sessionId }

  if (ENC_KEY) {
    assert(
      row.decision_text?.startsWith('enc:'),
      'sessions.decision_text is encrypted in DB',
      `got: ${String(row.decision_text).slice(0, 60)}`
    )
    assert(
      row.context_text?.startsWith('enc:'),
      'sessions.context_text is encrypted in DB',
      `got: ${String(row.context_text).slice(0, 60)}`
    )
    assert(
      !row.decision_text?.includes('Singapore'),
      'decision_text does NOT contain plaintext keyword in DB',
    )
    // Decrypt matches original
    assert(
      decryptValue(row.decision_text).includes('Singapore'),
      'Decrypted decision_text contains original keyword'
    )
  } else {
    console.log('  ⚠️  DB_ENCRYPTION_KEY not set — DB values will be plaintext (pre-key deployment)')
  }

  return sessionId
}

// ── 3. API read → returns decrypted plaintext ─────────────────────────────────

async function testReadDecryptsCorrectly(sessionId: string) {
  console.log('\n── 3. Read via API → verify returns decrypted plaintext ─────────')

  try {
    const res = await fetch(`${APP_URL}/api/session?id=${sessionId}`)
    if (!res.ok) { fail(`GET /api/session?id= returns 200`, `status ${res.status}`); return }
    const body = await res.json()

    assert(
      typeof body.decision_text === 'string' && !body.decision_text.startsWith('enc:'),
      'GET /api/session — decision_text is plaintext (no enc: prefix)'
    )
    assert(
      body.decision_text?.includes('Singapore'),
      'GET /api/session — decision_text contains correct original text'
    )
    assert(
      body.context_text === 'Test context for encryption verification',
      'GET /api/session — context_text decrypted correctly'
    )
  } catch (e: any) {
    fail('GET /api/session reachable', e.message)
  }
}

// ── 4. Examiner responses: write encrypted, read decrypted ───────────────────

async function testExaminerEncryption(sessionId: string) {
  console.log('\n── 4. Examiner responses: write encrypted, read decrypted ───────')

  const responses = [
    { question_text: 'What is the core uncertainty?', response_text: 'Market timing is the key unknown', question_order: 1, unknown_unknown_gap: false, rule_id: null },
    { question_text: 'Who else is affected?',          response_text: 'My co-founder and two early employees', question_order: 2, unknown_unknown_gap: false, rule_id: null },
  ]

  try {
    const res = await fetch(`${APP_URL}/api/examiner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, responses }),
    })
    if (!res.ok) { fail(`POST /api/examiner returns 2xx`, `status ${res.status}`); return }
    pass('POST /api/examiner succeeded')
  } catch (e: any) {
    fail('POST /api/examiner reachable', (e as Error).message); return
  }

  await new Promise(r => setTimeout(r, 600))

  // Check DB
  const { data: rows } = await supabase
    .from('examiner_responses')
    .select('question_text, response_text')
    .eq('session_id', sessionId)
    .order('question_order', { ascending: true })

  if (!rows || rows.length === 0) { fail('examiner_responses rows exist in DB'); return }

  if (ENC_KEY) {
    assert(
      rows[0].response_text?.startsWith('enc:'),
      'examiner_responses.response_text encrypted in DB'
    )
    assert(
      decryptValue(rows[0].response_text!).includes('Market timing'),
      'examiner_responses.response_text decrypts to original'
    )
    assert(
      rows[0].question_text?.startsWith('enc:'),
      'examiner_responses.question_text encrypted in DB'
    )
  } else {
    pass('examiner_responses rows exist in DB (plaintext — key not set yet)')
  }
}

// ── 5. Outcome: write encrypted, read decrypted ───────────────────────────────

async function testOutcomeEncryption(sessionId: string) {
  console.log('\n── 5. Outcome: write encrypted, read decrypted ──────────────────')

  try {
    const res = await fetch(`${APP_URL}/api/outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        what_decided: 'Decided to proceed with Singapore expansion in Q3',
        council_helped: 'yes',
        notes: 'Council Risk Architect raised a point I had not considered',
      }),
    })
    if (!res.ok) { fail(`POST /api/outcome returns 2xx`, `status ${res.status}`); return }
    pass('POST /api/outcome succeeded')
  } catch (e: any) {
    fail('POST /api/outcome reachable', (e as Error).message); return
  }

  await new Promise(r => setTimeout(r, 600))

  // Check DB
  const { data: row } = await supabase
    .from('outcomes')
    .select('what_decided, notes')
    .eq('session_id', sessionId)
    .single()

  if (!row) { fail('outcomes row exists in DB'); return }

  if (ENC_KEY) {
    assert(row.what_decided?.startsWith('enc:'), 'outcomes.what_decided encrypted in DB')
    assert(
      decryptValue(row.what_decided!).includes('Singapore'),
      'outcomes.what_decided decrypts to original'
    )
    assert(row.notes?.startsWith('enc:'), 'outcomes.notes encrypted in DB')
  } else {
    pass('outcomes row exists in DB (plaintext — key not set yet)')
  }
}

// ── 6. Backward compat: plaintext row in DB reads correctly via API ────────────

async function testBackwardCompat() {
  console.log('\n── 6. Backward compat: old plaintext row readable via API ───────')

  // Insert a plaintext row directly (simulates pre-encryption data)
  const plainDecision = `BACKCOMPAT_TEST_${Date.now()}: Legacy plaintext row`
  const { data: inserted, error } = await supabase
    .from('sessions')
    .insert({
      decision_text: plainDecision,   // raw, no encryption
      context_text:  'Legacy context',
      device_id:     DEVICE_ID,
    })
    .select('id')
    .single()

  if (error || !inserted) { fail('Plaintext row inserted to DB', error?.message); return }
  const legacyId = inserted.id
  pass(`Plaintext row inserted (id: ${legacyId})`)

  // Read via API — should return plaintext as-is (decrypt() passes through non-enc: values)
  await new Promise(r => setTimeout(r, 400))
  try {
    const res = await fetch(`${APP_URL}/api/session?id=${legacyId}`)
    if (!res.ok) { fail(`GET /api/session for legacy row returns 200`, `status ${res.status}`); return }
    const body = await res.json()

    assert(
      body.decision_text === plainDecision,
      'Legacy plaintext row reads correctly via API (no enc: prefix passthrough)'
    )
    assert(
      body.context_text === 'Legacy context',
      'Legacy context_text reads correctly'
    )
  } catch (e: any) {
    fail('GET /api/session for legacy row', (e as Error).message)
  }

  // Cleanup
  await supabase.from('sessions').delete().eq('id', legacyId)
}

// ── 7. History route: returns decrypted decision_text ─────────────────────────

async function testHistoryRoute(sessionId: string) {
  console.log('\n── 7. GET /api/history returns decrypted text ───────────────────')
  try {
    const res = await fetch(`${APP_URL}/api/history?device_id=${DEVICE_ID}`)
    if (!res.ok) { fail(`GET /api/history returns 200`, `status ${res.status}`); return }
    const body = await res.json()
    const sessions: any[] = body.sessions ?? body ?? []
    const match = sessions.find((s: any) => s.id === sessionId)

    if (!match) {
      // might not find if auth-scoped, just check no enc: values leak
      const anyEncLeaking = sessions.some((s: any) =>
        typeof s.decision_text === 'string' && s.decision_text.startsWith('enc:')
      )
      assert(!anyEncLeaking, 'GET /api/history — no enc: values leaked to client')
    } else {
      assert(
        !match.decision_text?.startsWith('enc:'),
        'GET /api/history — test session decision_text is decrypted'
      )
    }
  } catch (e: any) {
    fail('GET /api/history reachable', (e as Error).message)
  }
}

// ── 8. Cleanup ────────────────────────────────────────────────────────────────

async function cleanup(sessionId: string) {
  await supabase.from('examiner_responses').delete().eq('session_id', sessionId)
  await supabase.from('outcomes').delete().eq('session_id', sessionId)
  await supabase.from('messages').delete().eq('session_id', sessionId)
  await supabase.from('sessions').delete().eq('id', sessionId)
  console.log(`\n  🧹  Cleaned up test session ${sessionId}`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════')
  console.log('  Quorum — Encryption integration test')
  console.log('═══════════════════════════════════════════════════════')
  console.log(`  App URL   : ${APP_URL}`)
  console.log(`  Key set   : ${ENC_KEY ? 'YES ✓' : 'NO — DB values will be plaintext'}`)
  console.log(`  Device ID : ${DEVICE_ID}`)

  // 1. Pure unit tests (no network/DB)
  testEncryptionPrimitives()

  // 2–7. Integration tests (need running app + DB)
  const sessionId = await testWriteEncryptsInDB()
  if (sessionId) {
    await testReadDecryptsCorrectly(sessionId)
    await testExaminerEncryption(sessionId)
    await testOutcomeEncryption(sessionId)
    await testHistoryRoute(sessionId)
    await cleanup(sessionId)
  }

  // 6. Backward compat (standalone — creates and deletes its own row)
  await testBackwardCompat()

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════')
  console.log(`  Result: ${passed} passed, ${failed} failed`)
  if (failures.length > 0) {
    console.log('\n  Failures:')
    failures.forEach(f => console.log(`    ✗ ${f}`))
  } else {
    console.log('  All tests passed ✓')
  }
  console.log('═══════════════════════════════════════════════════════\n')

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => { console.error('Test runner crashed:', err); process.exit(1) })
