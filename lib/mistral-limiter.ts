// lib/mistral-limiter.ts
// ── Shared Mistral-cloud admission control ───────────────────────────────────
//
// WHY THIS EXISTS
// Every 'mistral-cloud' call in lib/ai-client.ts — Free tier end-to-end AND
// Elite's fast role — shares ONE Mistral account (one MISTRAL_API_KEY, one
// `mistral` OpenAI-compatible client instance). Real per-session traffic
// against that single account (confirmed via Railway logs, 2026-08-05,
// session 9e1239d7): 6 persona calls fire concurrently on mount, plus
// several scoring/tagging completions (bias-scorer, ontology-tagger,
// structural-retrieval, contradiction-detector, examiner-resolvability-
// check) — all within a couple of seconds, per session, with multiple
// sessions able to overlap. Mistral's account ceiling for mistral-small-2603
// (from the account dashboard, 2026-08-06): 0.83 requests/second and 50,000
// tokens/minute. Both are real per-account ceilings, not per-user — so
// nothing about a single request can know it's "safe"; only a process-wide
// gate can.
//
// Previously the only protection was REACTIVE: lib/ai-client.ts's withRetry
// catches a 429 after Mistral has already rejected it and waits before
// retrying. That absorbs isolated failures but does nothing to reduce the
// actual request rate against the ceiling — under real concurrent load
// (the 6-persona mount burst above all others) it just means everyone
// retries into the same wall a few seconds later.
//
// This file is PROACTIVE admission control: every mistral-cloud call is
// scheduled through scheduleMistralCall() before it's allowed to actually
// hit the network. Two gates, both must pass before a queued call is
// dispatched:
//   1. RPS gate  — a call may only be dispatched at least MIN_INTERVAL_MS
//      after the previous one was dispatched (leaky bucket, bucket size 1).
//   2. TPM gate  — a call's ESTIMATED token cost (prompt + system prompt,
//      chars/4, plus its requested max_tokens as a worst-case output bound)
//      must fit under EFFECTIVE_TPM when added to every other call
//      dispatched in the trailing 60s window.
// A call that can't be admitted yet waits in an in-memory priority queue
// (Elite ahead of Free, FIFO within a tier) rather than firing and failing —
// so this trades a bit of latency under contention for correctness, which is
// the right trade for a paid product where a raw 500 mid-session is far
// worse than a few hundred ms of extra queueing.
//
// SCOPE — deliberately narrow: only lib/ai-client.ts's 'mistral-cloud'
// target (the shared cloud account) is scheduled through here.
// 'mistral-selfhosted' (Private tier) is a DIFFERENT account per customer
// (see lib/ai-client.ts's getPrivateClient — a fresh client per
// PrivateEndpoint) with its own infra and its own limits, so it must never
// share this queue. deepseek-legacy and anthropic-legacy/elite have their
// own providers entirely. See lib/ai-client.ts's createCompletion/
// createStream 'mistral-cloud' cases for the only two call sites that use
// this file.
//
// SINGLE-INSTANCE ASSUMPTION — same as lib/rate-limit.ts: in-memory state,
// appropriate for a single-instance Railway deployment. Resets on deploy,
// which is fine (the account's own ceiling is what actually matters; this
// is just this process's best-effort model of it). If the app ever scales
// to multiple instances sharing one Mistral account, this needs to move to
// a shared store (Redis token bucket) — flagged here rather than guessed at,
// since it's a real infra change, not a code tweak.
// ─────────────────────────────────────────────────────────────────────────────

import 'server-only'

export type MistralCallPriority = 'elite' | 'free'

// ── Configuration ────────────────────────────────────────────────────────────
// Defaults match the account dashboard figures for mistral-small-2603 given
// 2026-08-06. Overridable via env so a plan upgrade (or Mistral changing the
// account's ceiling) never needs a code change — restart picks up the new
// values.
const RPS = Number(process.env.MISTRAL_RPS ?? '0.83')
const TPM = Number(process.env.MISTRAL_TPM ?? '50000')

// Safety margin: stay under the PUBLISHED ceiling, not exactly at it. Our
// TPM admission is based on ESTIMATED tokens (chars/4 for input, requested
// max_tokens as a worst-case output bound) — a real call can run a little
// hotter than the estimate (unicode-heavy text, a model that fills its full
// max_tokens), and RPS timing has normal process-scheduling jitter. 10%
// headroom absorbs both without meaningfully reducing real throughput.
const SAFETY_MARGIN = 0.9
const EFFECTIVE_TPM = Math.max(1, Math.floor(TPM * SAFETY_MARGIN))
const MIN_INTERVAL_MS = Math.max(1, Math.ceil(1000 / Math.max(RPS, 0.001) / SAFETY_MARGIN))

const WINDOW_MS = 60_000

// A call that's waited longer than this fails outright with a clear error
// rather than hanging — better for a route handler (and whatever
// try/catch it already has — every AI call site in this app already
// tolerates a thrown error) to fail fast and visibly than to sit past
// Railway's own upstream timeout and produce a bare, unexplained 502/504.
// Generous relative to a single session's real call volume (~10–15 mistral
// calls; at the RPS gate alone that's ~12–18s serialized worst case) so a
// single busy session is never the thing that trips this.
const MAX_QUEUE_WAIT_MS = Number(process.env.MISTRAL_MAX_QUEUE_WAIT_MS ?? '45000')

// Log a queue-pressure warning at most this often — under sustained load
// this would otherwise log on every single admission check.
const QUEUE_WARN_INTERVAL_MS = 10_000

// ── Token estimation ─────────────────────────────────────────────────────────
// Rough English-text heuristic (~4 chars/token). This is intentionally an
// UPPER-BOUND-leaning estimate, not a precise count: input is estimated from
// actual character length, output is estimated at the caller's full
// max_tokens (worst case — most calls finish well under their cap, but
// admitting on the worst case is what keeps this proactive rather than
// hopeful). Overestimating costs a little queued latency; underestimating
// risks the real 429 this file exists to prevent.
export function estimateTokens(text: string | undefined | null): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

// ── Priority queue ────────────────────────────────────────────────────────────

interface QueuedTask<T> {
  priority:        MistralCallPriority
  estimatedTokens: number
  label:           string
  run:             () => Promise<T>
  resolve:         (v: T) => void
  reject:          (e: unknown) => void
  enqueuedAt:       number
}

const PRIORITY_RANK: Record<MistralCallPriority, number> = { elite: 0, free: 1 }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const queue: QueuedTask<any>[] = []
let processing = false
let lastDispatchAt = 0
// Rolling log of {at, tokens} for calls dispatched in the trailing window —
// pruned lazily on each admission check rather than on a timer, since a
// quiet period needs no cleanup work at all.
const tokenLog: { at: number; tokens: number }[] = []
let lastQueueWarnAt = 0

function currentWindowTokens(now: number): number {
  while (tokenLog.length && tokenLog[0].at <= now - WINDOW_MS) tokenLog.shift()
  let sum = 0
  for (const e of tokenLog) sum += e.tokens
  return sum
}

function maybeWarnQueuePressure(now: number): void {
  if (queue.length < 3) return
  if (now - lastQueueWarnAt < QUEUE_WARN_INTERVAL_MS) return
  lastQueueWarnAt = now
  const eliteWaiting = queue.filter(t => t.priority === 'elite').length
  console.warn(
    `[MistralLimiter] queue backed up: ${queue.length} call(s) waiting ` +
    `(${eliteWaiting} elite) — Mistral account ceiling is ${RPS} req/s / ` +
    `${TPM} tokens/min. This is expected under real concurrent load; if it's ` +
    `persistent, the account plan likely needs a higher limit.`,
  )
}

async function processQueue(): Promise<void> {
  if (processing) return
  processing = true
  try {
    while (queue.length) {
      const now = Date.now()
      maybeWarnQueuePressure(now)

      // Stable priority order: elite ahead of free, FIFO within a tier.
      // Re-sorted each iteration since new tasks can arrive mid-wait.
      queue.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.enqueuedAt - b.enqueuedAt)
      const task = queue[0]

      if (now - task.enqueuedAt > MAX_QUEUE_WAIT_MS) {
        queue.shift()
        task.reject(new Error(
          `[MistralLimiter] "${task.label}" waited ${Math.round((now - task.enqueuedAt) / 1000)}s ` +
          `for a Mistral rate-limit slot and was dropped (cap: ${MAX_QUEUE_WAIT_MS / 1000}s). ` +
          `The shared Mistral account (${RPS} req/s, ${TPM} tokens/min) is saturated — try again shortly.`,
        ))
        continue
      }

      const rpsReadyAt = lastDispatchAt + MIN_INTERVAL_MS
      const windowTokens = currentWindowTokens(now)
      const tpmReady = windowTokens + task.estimatedTokens <= EFFECTIVE_TPM

      if (now >= rpsReadyAt && tpmReady) {
        queue.shift()
        lastDispatchAt = now
        tokenLog.push({ at: now, tokens: task.estimatedTokens })
        // Fire-and-forget from the queue's perspective — the RPS gate above
        // controls DISPATCH spacing, not concurrency, so a slow call (e.g. a
        // long persona stream) doesn't block shorter calls queued behind it
        // from being admitted once their own turn comes up.
        task.run().then(task.resolve, task.reject)
        continue
      }

      const waitForRps = Math.max(0, rpsReadyAt - now)
      const waitForTpm = tpmReady ? 0 : Math.max(50, (tokenLog[0]?.at ?? now) + WINDOW_MS - now)
      const wait = Math.min(Math.max(waitForRps, waitForTpm, 25), 2000)
      await new Promise(r => setTimeout(r, wait))
    }
  } finally {
    processing = false
  }
}

/**
 * scheduleMistralCall — admit a call to the shared Mistral cloud account.
 *
 * Wrap the ACTUAL network call (not just its inputs) in `fn` — admission
 * happens first, then `fn` runs, so `fn` should do nothing except make the
 * one Mistral request this slot was reserved for.
 *
 * @param fn              The call to run once admitted (typically a thunk
 *                        around completeOpenAICompatible/streamOpenAICompatible).
 * @param opts.priority   'elite' for Elite-tier fast-role calls, 'free' for
 *                        Free-tier calls (Free is Mistral end-to-end). Elite
 *                        is served first under contention — see file doc
 *                        comment.
 * @param opts.estimatedTokens  Upper-bound token estimate for this call
 *                        (see estimateTokens) — reserved against the TPM
 *                        window for the duration of admission.
 * @param opts.label      Short label for logging only (e.g. 'createStream/
 *                        mistral persona'). Not used for routing.
 */
export function scheduleMistralCall<T>(
  fn:   () => Promise<T>,
  opts: { priority: MistralCallPriority; estimatedTokens: number; label: string },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({
      priority:        opts.priority,
      estimatedTokens: Math.max(0, opts.estimatedTokens),
      label:           opts.label,
      run:             fn,
      resolve,
      reject,
      enqueuedAt:      Date.now(),
    })
    void processQueue()
  })
}

/** Diagnostic snapshot — not currently wired to any endpoint; safe to call from a future admin/debug route. */
export function getMistralLimiterStatus() {
  const now = Date.now()
  return {
    rps:              RPS,
    tpm:              TPM,
    effectiveTpm:      EFFECTIVE_TPM,
    minIntervalMs:     MIN_INTERVAL_MS,
    queueLength:       queue.length,
    eliteQueued:       queue.filter(t => t.priority === 'elite').length,
    windowTokensInUse: currentWindowTokens(now),
    msSinceLastDispatch: lastDispatchAt ? now - lastDispatchAt : null,
  }
}
