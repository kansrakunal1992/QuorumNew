import 'server-only'
// ^ Build-time guard (Sprint TB1, June 2026) — see lib/ai-client.ts for the
// incident this class of fix targets. This module holds DB_ENCRYPTION_KEY in
// module scope and is a strictly server-only file (confirmed: zero client
// component imports it as of this sprint). A leak here is worse than
// ai-client.ts's — raw decryption capability in a browser bundle, not just a
// blank page — so the guard is added even though no live import path
// triggers it today.

/**
 * lib/encryption.ts
 * ── Quorum: Application-level field encryption ────────────────────────────────
 *
 * AES-256-GCM symmetric encryption for raw user input stored in Supabase.
 * All encrypt/decrypt operations run server-side (Railway).
 * Anyone with direct DB access (Supabase dashboard, admin) sees only
 * opaque enc:... strings in sensitive columns.
 *
 * ── ENCRYPTED COLUMNS ────────────────────────────────────────────────────────
 *   sessions           — decision_text, context_text
 *   messages           — content (all roles)
 *   examiner_responses — question_text, response_text
 *   outcomes           — what_decided, notes
 *   structural_matches — context_block (text), matches_json (JSONB via _enc wrapper)
 *
 * ── EXCLUDED (derived tables — numeric scores, enums, AI summaries) ───────────
 *   sessions_ontology, bias_library, structural_scores, independence_score_log,
 *   contradiction_runs, avoidance_alerts, mirror_access, user_preferences,
 *   contradictions.principle_text / violation_text (AI-derived, not raw user input)
 *
 * ── KEY SETUP ─────────────────────────────────────────────────────────────────
 *   Add DB_ENCRYPTION_KEY to Railway environment variables.
 *   Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *   Must be exactly 64 hex characters (32 bytes).
 *
 * ── BACKWARD COMPATIBILITY ────────────────────────────────────────────────────
 *   • encrypt() is a no-op when DB_ENCRYPTION_KEY is not set — existing
 *     deployments keep working until the key is added to Railway.
 *   • decrypt() checks for the 'enc:' prefix before attempting decryption —
 *     old plaintext rows are returned as-is with no error.
 *   • After setting the key, run scripts/encrypt-existing.ts once to
 *     backfill-encrypt all existing rows.
 *
 * ── ENCRYPTED VALUE FORMAT ────────────────────────────────────────────────────
 *   enc:<iv_hex(32 chars)>:<authTag_hex(32 chars)>:<ciphertext_base64>
 *
 * ── JSONB COLUMNS (structural_matches.matches_json) ──────────────────────────
 *   Stored as JSON object: { _enc: "enc:..." }
 *   Old plaintext rows (arrays) → returned as-is for backward compat.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH  = 16   // bytes → 32 hex chars
const TAG_LENGTH = 16   // bytes → 32 hex chars
const ENC_PREFIX = 'enc:'
const JSONB_KEY  = '_enc'

// ── Sprint 5 (S5-02): Production startup warning ──────────────────────────────
// Log a CRITICAL error at module load time if running in production without a key.
// This surfaces misconfiguration immediately in Railway logs rather than
// silently storing plaintext in the database.
if (process.env.NODE_ENV === 'production' && !process.env.DB_ENCRYPTION_KEY) {
  console.error(
    '[Encryption] CRITICAL: DB_ENCRYPTION_KEY is not set in production. ' +
    'Decision text and analysis WILL BE STORED AS PLAINTEXT. ' +
    'Set DB_ENCRYPTION_KEY in Railway → Variables immediately.'
  )
}

// ── Key resolution ─────────────────────────────────────────────────────────────

function getKey(): Buffer | null {
  const hex = process.env.DB_ENCRYPTION_KEY
  if (!hex) return null
  const key = Buffer.from(hex, 'hex')
  if (key.length !== 32) {
    console.error('[Encryption] DB_ENCRYPTION_KEY must be 64 hex chars (32 bytes). Encryption disabled.')
    return null
  }
  return key
}

// ── Core encrypt / decrypt ─────────────────────────────────────────────────────

/**
 * Encrypt a string. In production, throws if DB_ENCRYPTION_KEY is not set
 * (fail-closed: prevents plaintext from being silently written to the DB).
 * In development, returns the original value when no key is set (backward compat).
 */
export function encrypt(value: string | null | undefined): string | null | undefined {
  if (value === null || value === undefined || value === '') return value
  const key = getKey()
  if (!key) {
    // S5-02: fail-closed in production — throw to surface 500, not silent plaintext write
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[Encryption] DB_ENCRYPTION_KEY is required in production. ' +
        'Set it in Railway → Variables.'
      )
    }
    return value   // development: allow plaintext (backward compat)
  }

  try {
    const iv      = randomBytes(IV_LENGTH)
    const cipher  = createCipheriv(ALGORITHM, key, iv)
    const enc     = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    const authTag = cipher.getAuthTag()
    return `${ENC_PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${enc.toString('base64')}`
  } catch (err) {
    console.error('[Encryption] encrypt() failed:', err)
    return value   // fail-safe: store plaintext rather than crash
  }
}

/**
 * Decrypt a string. Returns the original value unchanged when:
 *   - value is null / undefined / empty string
 *   - value does not start with 'enc:' (old plaintext row — backward compat)
 *   - DB_ENCRYPTION_KEY is not set
 */
export function decrypt(value: string | null | undefined): string | null | undefined {
  if (value === null || value === undefined || value === '') return value
  if (!value.startsWith(ENC_PREFIX)) return value   // old row — return as-is

  const key = getKey()
  if (!key) {
    console.error('[Encryption] DB_ENCRYPTION_KEY not set — cannot decrypt enc: value')
    return value
  }

  try {
    const rest   = value.slice(ENC_PREFIX.length)
    const parts  = rest.split(':')
    if (parts.length !== 3) {
      console.error('[Encryption] decrypt(): malformed enc: value')
      return value
    }
    const [ivHex, tagHex, encB64] = parts
    const iv      = Buffer.from(ivHex,  'hex')
    const authTag = Buffer.from(tagHex, 'hex')
    const encBuf  = Buffer.from(encB64, 'base64')

    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(encBuf), decipher.final()]).toString('utf8')
  } catch (err) {
    console.error('[Encryption] decrypt() failed:', err)
    return value   // fail-safe: return ciphertext rather than crash
  }
}

// ── JSONB helpers (structural_matches.matches_json) ───────────────────────────

/**
 * Encrypt a JSON-serialisable value for storage in a JSONB column.
 * Stored as { _enc: "enc:..." } — still valid JSON.
 * Falls back to storing the plain value if key is not set.
 */
export function encryptJson(data: unknown): unknown {
  const key = getKey()
  if (!key) return data
  return { [JSONB_KEY]: encrypt(JSON.stringify(data)) }
}

/**
 * Decrypt a JSONB value stored via encryptJson().
 *
 * Handles three cases:
 *   { _enc: "enc:..." }  → decrypt + JSON.parse → return typed value
 *   Array                → old plaintext row   → return as-is
 *   anything else        → pass through (unexpected, defensive)
 */
export function decryptJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return value as T   // old unencrypted row

  if (
    typeof value === 'object' &&
    value !== null &&
    JSONB_KEY in value
  ) {
    const enc = (value as Record<string, unknown>)[JSONB_KEY]
    if (typeof enc !== 'string') return null
    try {
      const plain = decrypt(enc)
      if (!plain || typeof plain !== 'string') return null
      return JSON.parse(plain) as T
    } catch (err) {
      console.error('[Encryption] decryptJson() JSON.parse failed:', err)
      return null
    }
  }

  return value as T   // unknown structure — pass through
}
