// lib/gtm-lifecycle.ts
// ── Pure helpers for /api/cron/gtm-lifecycle (no I/O, unit-tested) ──────────
// Everything that arrives from the GTM OS outbox is treated as UNTRUSTED text:
//   • links can only be paths INSIDE this app (never an external URL, so a compromised outbox cannot send people elsewhere)
//   • copy is stripped of control characters and length-capped; the HTML builder escapes it again
//   • the holdout / variant assignment is a deterministic hash, so a user always lands in the same arm

import { createHash } from 'crypto'

export interface CopyVariant {
  subject:    string
  lead:       string
  detail:     string | null
  listLabel:  string | null
  listItems:  string[]
  ctaLabel:   string
  ctaPath:    string
}

/** Deterministic 0..(mod-1) bucket for (program, user, purpose). */
export function hashBucket(userId: string, programId: string, purpose: 'arm' | 'variant', mod: number): number {
  if (mod <= 0) return 0
  const h = createHash('sha256').update(`${programId}:${userId}:${purpose}`).digest()
  return h.readUInt32BE(0) % mod
}

export function isHoldout(userId: string, programId: string, holdoutPct: number): boolean {
  const pct = Math.max(0, Math.min(50, Math.floor(holdoutPct)))
  return pct > 0 && hashBucket(userId, programId, 'arm', 100) < pct
}

export function pickVariantIndex(userId: string, programId: string, n: number): number {
  return n <= 1 ? 0 : hashBucket(userId, programId, 'variant', n)
}

/** Strip control characters / newlines, collapse whitespace, cap length. Never throws. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  const flat = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + '…' : flat
}

/** Only a same-site absolute path is allowed. Anything else becomes '/'. */
export function safeCtaPath(value: unknown): string {
  if (typeof value !== 'string') return '/'
  const p = value.trim()
  if (p.length === 0 || p.length > 200) return '/'
  if (!p.startsWith('/') || p.startsWith('//')) return '/'
  // eslint-disable-next-line no-control-regex
  if (/[\\\s\u0000-\u001f\u007f@<>"']/.test(p)) return '/'
  return p
}

export function safeSlug(value: unknown): string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value) ? value : 'program'
}

/** Returns null when a variant is unusable (missing subject, lead or button label). */
export function normalizeVariant(raw: unknown): CopyVariant | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const subject  = cleanText(r.subject, 120)
  const lead     = cleanText(r.lead, 400)
  const ctaLabel = cleanText(r.cta_label, 40)
  if (!subject || !lead || !ctaLabel) return null
  const items = Array.isArray(r.list_items) ? r.list_items.map(i => cleanText(i, 160)).filter(Boolean).slice(0, 5) : []
  return {
    subject, lead, ctaLabel,
    detail:    cleanText(r.detail, 600) || null,
    listLabel: items.length ? (cleanText(r.list_label, 60) || null) : null,
    listItems: items,
    ctaPath:   safeCtaPath(r.cta_path),
  }
}

export function normalizeVariants(raw: unknown): CopyVariant[] {
  return Array.isArray(raw) ? raw.map(normalizeVariant).filter((v): v is CopyVariant => v !== null).slice(0, 6) : []
}

/** Tracked, same-site link. `n=` is the app's existing open/click marker (see validation-nudge). */
export function buildCtaUrl(appUrl: string, ctaPath: string, slug: string): string {
  const base = appUrl.replace(/\/$/, '')
  const path = safeCtaPath(ctaPath)
  const s    = safeSlug(slug)
  const sep  = path.includes('?') ? '&' : '?'
  return `${base}${path}${sep}n=gtm_${s}&utm_source=quorum_lifecycle&utm_medium=email&utm_campaign=${encodeURIComponent(s)}`
}

/** How many more emails may go out today across ALL programs. */
export function remainingDailyCap(sentToday: number, cap: number): number {
  return Math.max(0, Math.floor(cap) - Math.max(0, Math.floor(sentToday)))
}

export function parseCap(raw: string | undefined, fallback: number): number {
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
}
