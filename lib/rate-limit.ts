// lib/rate-limit.ts
// ── Sprint 5 (S5-01) — Shared Rate Limiter ───────────────────────────────────
//
// In-memory sliding-window rate limiter.
// Appropriate for a single-instance Railway deployment — no Redis needed.
// Resets on server restart (deployment), which is acceptable.
//
// All limits are deliberately generous — designed to block runaway loops
// and abuse, not typical power-user sessions.
// ─────────────────────────────────────────────────────────────────────────────

interface Entry {
  count:   number
  resetAt: number   // Unix ms
}

// Shared store across all routes in the same Node.js process
const store = new Map<string, Entry>()

// Garbage-collect expired entries every 15 minutes to prevent memory growth
if (typeof globalThis !== 'undefined' && typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const [k, v] of store) {
      if (v.resetAt < now) store.delete(k)
    }
  }, 15 * 60_000).unref?.()   // .unref() prevents interval from blocking process exit
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LimitConfig {
  limit:      number   // max requests per window
  windowMs:   number   // window duration in ms
  identifier: string   // route label used as key prefix
}

export interface LimitResult {
  allowed:         boolean
  remaining:       number
  resetAt:         number   // Unix ms when window resets
  retryAfterSecs:  number   // seconds until reset (0 if allowed)
}

// ── Pre-configured limits for every rate-limited route ───────────────────────
// Generous defaults — a real HNI user doing an intensive session (6 personas,
// examiner, TTS) uses ~30 API calls in under 5 minutes. These limits give
// ~10× headroom while still blocking runaway loops and scraping.

export const LIMITS: Record<string, LimitConfig> = {
  // Session creation — relatively rare, but triggers AI downstream
  session: {
    identifier: 'session',
    limit:      20,
    windowMs:   15 * 60_000,   // 20 sessions per 15 min
  },
  // Persona streaming — 6 per session; allow ~10 concurrent sessions
  persona: {
    identifier: 'persona',
    limit:      60,
    windowMs:   10 * 60_000,   // 60 persona calls per 10 min
  },
  // Examiner — 1–3 per session
  examiner: {
    identifier: 'examiner',
    limit:      40,
    windowMs:   10 * 60_000,   // 40 examiner calls per 10 min
  },
  // Magic link sends — strictest limit; prevents email spam
  auth: {
    identifier: 'auth',
    limit:      5,
    windowMs:   15 * 60_000,   // 5 magic links per 15 min
  },
  // TTS — ~10 calls per session (synthesis + personas)
  voiceTts: {
    identifier: 'voice-tts',
    limit:      80,
    windowMs:   10 * 60_000,   // 80 TTS calls per 10 min
  },
  // Structural match — called once per session from the browser
  structuralMatch: {
    identifier: 'structural-match',
    limit:      30,
    windowMs:   10 * 60_000,
  },
  // Outcome recording
  outcome: {
    identifier: 'outcome',
    limit:      30,
    windowMs:   10 * 60_000,
  },
}

// ── Core check function ───────────────────────────────────────────────────────

export function checkLimit(ip: string, cfg: LimitConfig): LimitResult {
  const key = `${cfg.identifier}:${ip}`
  const now = Date.now()
  let entry = store.get(key)

  // New window or expired window
  if (!entry || entry.resetAt <= now) {
    entry = { count: 1, resetAt: now + cfg.windowMs }
    store.set(key, entry)
    return {
      allowed:        true,
      remaining:      cfg.limit - 1,
      resetAt:        entry.resetAt,
      retryAfterSecs: 0,
    }
  }

  // Window active and limit hit
  if (entry.count >= cfg.limit) {
    const secs = Math.ceil((entry.resetAt - now) / 1000)
    return {
      allowed:        false,
      remaining:      0,
      resetAt:        entry.resetAt,
      retryAfterSecs: secs,
    }
  }

  // Window active, count incremented
  entry.count++
  return {
    allowed:        true,
    remaining:      cfg.limit - entry.count,
    resetAt:        entry.resetAt,
    retryAfterSecs: 0,
  }
}

// ── IP extraction (handles Railway's x-forwarded-for) ────────────────────────

export function getClientIP(req: Request): string {
  // x-forwarded-for may contain a comma-separated list; take the leftmost
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

// ── Standard 429 response with user-friendly message ─────────────────────────
//
// Message format (layman-clear):
//   "You've sent too many [action] requests.
//    Please wait 4 minutes — you can try again at 3:45 PM."
//
// The resetAt timestamp is included so the client can show a live countdown.

export function tooManyRequests(result: LimitResult, action = 'requests'): Response {
  const now       = Date.now()
  const totalSecs = Math.max(1, result.retryAfterSecs)
  const mins      = Math.floor(totalSecs / 60)
  const secs      = totalSecs % 60

  // Human-readable wait time
  let waitLabel: string
  if (totalSecs < 60)        waitLabel = `${totalSecs} seconds`
  else if (mins === 1)       waitLabel = secs > 0 ? `1 minute ${secs}s` : 'about a minute'
  else                       waitLabel = `${mins} minutes`

  // Reset clock time (localised on the server — UTC by default on Railway)
  const resetDate = new Date(result.resetAt)
  const timeStr   = resetDate.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  })

  const message =
    `You've sent too many ${action}. ` +
    `Please wait ${waitLabel} — you can try again at ${timeStr}.`

  return new Response(
    JSON.stringify({
      error:           'Too many requests',
      message,
      resetAt:         result.resetAt,
      retryAfterSecs:  result.retryAfterSecs,
    }),
    {
      status: 429,
      headers: {
        'Content-Type':       'application/json',
        'Retry-After':        String(result.retryAfterSecs),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset':  String(Math.ceil(result.resetAt / 1000)),
      },
    }
  )
}
