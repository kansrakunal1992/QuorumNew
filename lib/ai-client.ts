import 'server-only'
// ^ Build-time guard (Sprint TB1, June 2026). Throws if this module is ever
// reached by a client bundle — directly or transitively through any lib file
// that imports it (lib/bias-scorer.ts, lib/ontology-tagger.ts,
// lib/structural-retrieval.ts, lib/contradiction-detector.ts,
// lib/mirror-fingerprint.ts). Converts the failure mode from "blank white
// screen in production with no useful error" (see diligence finding #2,
// June 2026 update — components/BiasFingerprint.tsx crashed this way after a
// value-import of a constant created a transitive chain to the module-scope
// `new Anthropic(...)` below executing in-browser) into a local build error
// naming the exact import chain. Do not remove.

/**
 * AI provider abstraction.
 *
 * ── Legacy routing (unchanged — this is what runs when TIERED_ROUTING_ENABLED
 *    is false or unset, which is the default) ────────────────────────────────
 *
 * Global fallback (AI_PROVIDER env var):
 *   AI_PROVIDER=deepseek   → DeepSeek API (OpenAI-compatible)
 *   AI_PROVIDER=anthropic  → Claude API (default)
 *
 * Per-call override (Sprint 25 — hybrid routing):
 *   Pass `provider` to createStream, or `options.provider` to createCompletion,
 *   to pin a specific call to one model family regardless of AI_PROVIDER.
 *   All 15 AI calls carry an explicit provider flag — the env var is the
 *   fallback only for any call that omits the flag.
 *
 * Routing mode (ROUTING_MODE env var):
 *   ROUTING_MODE=hybrid        → per-call provider flags respected (default)
 *   ROUTING_MODE=deepseek_only → all 15 calls forced to DeepSeek regardless
 *                                 of per-call provider flags. Use for cost
 *                                 testing, A/B quality comparison, and as the
 *                                 tester path — see TIERED_ROUTING_ENABLED
 *                                 below for why this still works unchanged.
 *
 * Model selection:
 *   ANTHROPIC_MODEL  env var  → override Claude model   (default: claude-sonnet-4-20250514)
 *   DEEPSEEK_MODEL   env var  → override DeepSeek model (default: deepseek-v4-pro)
 *   Legacy AI_MODEL  env var  → still respected as fallback for DeepSeek only,
 *                               so existing Railway env var configs are not broken.
 *
 * DeepSeek thinking mode (DEEPSEEK_THINKING env var):
 *   DEEPSEEK_THINKING=disabled → thinking OFF for all DeepSeek calls (default)
 *   DEEPSEEK_THINKING=enabled  → thinking ON for all DeepSeek calls
 *   Note: thinking mode disables temperature sampling (silently ignored by API).
 *   Note: streaming calls suppress reasoning_content — only content tokens stream.
 *   TD logged: enable thinking selectively for non-streaming completions only
 *   (fingerprint, brief gen) once per-call thinking control is added.
 *
 * ── Tiered routing (new — Free/Elite/Private, gated by TIERED_ROUTING_ENABLED) ─
 *
 * TIERED_ROUTING_ENABLED env var (true/false, default false):
 *   false (default) → every line above applies exactly as written. Tiered
 *                      routing code below is never reached. This is the
 *                      master revert switch — flip to false to instantly
 *                      restore pre-tiered behavior, no other config needed.
 *   true             → resolveProvider() ignores ROUTING_MODE and the literal
 *                      meaning of each call's `provider` flag, and instead:
 *                        1. Reads the current request's tier — automatically,
 *                           with ZERO changes to any of the 15 call sites or
 *                           their route handlers. middleware.ts (project
 *                           root) resolves each user's tier once per request
 *                           and stamps it onto request headers
 *                           (x-product-tier / x-private-model-family); this
 *                           file reads them back via next/headers. The one
 *                           structural exception is cron/batch routes
 *                           (daily-nudge, reanalyze-email), which loop over
 *                           many users per request — middleware can't
 *                           resolve a single tier for those, so they use
 *                           lib/tier-context.ts's explicit AsyncLocalStorage
 *                           override instead, one call per loop iteration.
 *                           See that file's doc comment. Precedence: an
 *                           explicit tier-context override always wins over
 *                           headers, so a batch route's per-user wrap is
 *                           never shadowed by whatever tier its own trigger
 *                           request happens to carry.
 *                        2. Reinterprets the existing `provider` flag as a
 *                           ROLE rather than a literal provider:
 *                             'anthropic' → premium/complex-reasoning role
 *                             'deepseek'  → fast role
 *                           This is why zero call-site files needed to
 *                           change — the flag each of the 15 calls already
 *                           carries is exactly the fast/premium split the
 *                           tiered model needs, just under a different name.
 *                        3. Maps (tier, role) → an actual model per the table
 *                           below (TIER_ROLE_TABLE doc comment).
 *
 * Tester note: keep TIERED_ROUTING_ENABLED=false and ROUTING_MODE=deepseek_only
 * to force every call to DeepSeek — this path is untouched by anything in
 * this file's tiered-routing half, by construction (see the false-branch
 * above).
 *
 * Tier → role → model table:
 *   free                    fast → Mistral Small (cloud)
 *                           premium → Mistral Small (cloud) — same model,
 *                             Free is Mistral end-to-end per the Locked v1
 *                             pricing doc, so role is a no-op here.
 *   elite                   fast → Mistral Small (cloud)
 *                           premium → Claude Sonnet 4.6 (ELITE_PREMIUM_MODEL)
 *   private / Option A      fast → self-hosted Qwen (small)
 *   (qwen)                  premium → self-hosted Qwen (large)
 *   private / Option B      fast → self-hosted Mistral Small
 *   (mistral)                premium → self-hosted Mistral Large
 *
 * Private tier note: the self-hosted Qwen/Mistral endpoints this depends on
 * do not exist yet (separate infra track — GPU provisioning, deploy tooling).
 * The Private branch below is fully wired but fails loudly with a clear
 * error if its endpoint env vars are unset, rather than silently falling
 * back to a different tier's model. Do not treat a caught error from this
 * branch as "Private tier is broken" — it means the infra isn't live yet.
 *
 * Per-user routing override (TD-LD-10 / TD-LD-11): a single account can be
 * granted a model_route_fast / model_route_premium override via
 * /api/admin/grant-mirror-access — e.g. the founder's own account forced to
 * DeepSeek for testing while every other account routes normally by tier, at
 * the same time. Checked before the tier default in resolveProvider() below.
 * NULL (every row's default) means no override.
 *
 * Persisted audit log (TD-LD-10): every tiered-mode call writes a row to
 * ai_request_log — user, tier, role, resolved target/model, whether an
 * override was the reason — fire-and-forget, never blocking or failing the
 * actual call. Ties into the eventual privacy audit's ability to verify
 * what's claimed, rather than relying on ephemeral console logs. Writes
 * nothing when TIERED_ROUTING_ENABLED is false — matches the master
 * switch's "zero behavior change when off" guarantee.
 */

import Anthropic from '@anthropic-ai/sdk'
import OpenAI    from 'openai'
import { headers } from 'next/headers'
import { getCurrentTier } from './tier-context'
import { createServiceClient } from './supabase'
import { FREE_TIER } from './product-tier'
import type { ProductTierInfo } from './product-tier'
import type { ProductTier, PrivateModelFamily, RouteOverride } from './types'

// ── Tier resolution precedence ────────────────────────────────────────────────
// 1. AsyncLocalStorage context (lib/tier-context.ts) — set explicitly, e.g. by
//    a cron/batch route wrapping one user's iteration. Checked first because
//    an explicit per-iteration override should always win over whatever
//    headers happen to be on the batch job's own trigger request.
// 2. Request headers (x-product-tier / x-private-model-family / x-user-id /
//    x-model-route-fast / x-model-route-premium) — set automatically by
//    middleware.ts for every normal per-user request. This is what makes
//    tiered routing work with ZERO changes to any of the 15 call sites or
//    their route handlers: middleware resolves tier (and any TD-LD-11
//    override) once per request before any route code runs, and
//    ai-client.ts reads it back here.
// 3. 'free' — no context set and no headers present (e.g. headers() thrown
//    outside a request scope, or middleware's matcher didn't cover this
//    route). Conservative default, same reasoning as tier-context.ts's doc
//    comment: under-serve rather than accidentally over-serve.
async function getTierFromHeaders(): Promise<ProductTierInfo | undefined> {
  try {
    const h = await headers()
    const tier = h.get('x-product-tier') as ProductTier | null
    if (!tier) return undefined
    const family = h.get('x-private-model-family') as PrivateModelFamily | null
    return {
      tier,
      privateModelFamily: tier === 'private' ? family : null,
      userId:             h.get('x-user-id'),
      modelRouteFast:     h.get('x-model-route-fast')    as RouteOverride | null,
      modelRoutePremium:  h.get('x-model-route-premium') as RouteOverride | null,
    }
  } catch {
    // headers() throws when called outside a request-scoped execution
    // context (e.g. a plain script, or certain non-request invocations).
    // Not an error condition for us — just means no header-based tier is
    // available; fall through to 'free'.
    return undefined
  }
}

const GLOBAL_PROVIDER    = (process.env.AI_PROVIDER ?? 'anthropic').toLowerCase() as 'anthropic' | 'deepseek'
const ROUTING_MODE       = (process.env.ROUTING_MODE ?? 'hybrid') as 'hybrid' | 'deepseek_only'
const ANTHROPIC_MODEL    = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514'
const DEEPSEEK_MODEL     = process.env.DEEPSEEK_MODEL  ?? process.env.AI_MODEL ?? 'deepseek-v4-pro'
const DEEPSEEK_THINKING  = (process.env.DEEPSEEK_THINKING ?? 'disabled') as 'enabled' | 'disabled'

// ── Tiered routing config (only read/used when TIERED_ROUTING_ENABLED=true) ──
// Kept fully separate from the legacy vars above — e.g. ELITE_PREMIUM_MODEL
// is its own var, NOT a repurposed ANTHROPIC_MODEL, specifically so changing
// it can never affect legacy hybrid/deepseek_only behavior.
const TIERED_ROUTING_ENABLED = process.env.TIERED_ROUTING_ENABLED === 'true'

const MISTRAL_API_KEY    = process.env.MISTRAL_API_KEY ?? ''
const MISTRAL_MODEL      = process.env.MISTRAL_MODEL   ?? 'mistral-small-latest'
const ELITE_PREMIUM_MODEL = process.env.ELITE_PREMIUM_MODEL ?? 'claude-sonnet-4-6'

// Private tier — self-hosted, buyer's Option A (Qwen) or Option B (Mistral).
// Infra not live yet (see doc comment above); these are read lazily, only
// when a Private-tier call is actually made, so an unconfigured deployment
// doesn't block Free/Elite from working.
const QWEN_SELFHOSTED_BASE_URL    = process.env.QWEN_SELFHOSTED_BASE_URL    ?? ''
const QWEN_SELFHOSTED_API_KEY     = process.env.QWEN_SELFHOSTED_API_KEY     ?? ''
const QWEN_FAST_MODEL             = process.env.QWEN_FAST_MODEL             ?? ''
const QWEN_PREMIUM_MODEL          = process.env.QWEN_PREMIUM_MODEL          ?? ''

const MISTRAL_SELFHOSTED_BASE_URL     = process.env.MISTRAL_SELFHOSTED_BASE_URL     ?? ''
const MISTRAL_SELFHOSTED_API_KEY      = process.env.MISTRAL_SELFHOSTED_API_KEY      ?? ''
const MISTRAL_SELFHOSTED_FAST_MODEL   = process.env.MISTRAL_SELFHOSTED_FAST_MODEL   ?? ''
const MISTRAL_SELFHOSTED_PREMIUM_MODEL = process.env.MISTRAL_SELFHOSTED_PREMIUM_MODEL ?? ''

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })
const deepseek  = new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY ?? '', baseURL: 'https://api.deepseek.com' })

// Mistral's chat completions API is OpenAI-compatible (same pattern as
// DeepSeek above) — base URL, key, and model name are the only differences.
// See https://docs.mistral.ai/api — /v1/chat/completions accepts the same
// request/response shape as OpenAI's SDK expects.
const mistral = new OpenAI({ apiKey: MISTRAL_API_KEY, baseURL: 'https://api.mistral.ai/v1' })

// Self-hosted Qwen/Mistral clients are constructed lazily (only if/when a
// Private-tier call actually happens) since their base URLs won't be set
// until that infra exists — constructing an OpenAI client with an empty
// baseURL at module load would be a confusing failure mode.
let qwenSelfHosted:     OpenAI | null = null
let mistralSelfHosted:  OpenAI | null = null

function getQwenSelfHostedClient(): OpenAI {
  if (!QWEN_SELFHOSTED_BASE_URL) {
    throw new Error(
      '[AIClient] Private tier (Option A / Qwen) requested but QWEN_SELFHOSTED_BASE_URL is not set. ' +
      'The self-hosted Qwen endpoint does not exist yet — this is expected until that infra ships, ' +
      'not a routing bug. See lib/ai-client.ts doc comment.',
    )
  }
  if (!qwenSelfHosted) {
    qwenSelfHosted = new OpenAI({ apiKey: QWEN_SELFHOSTED_API_KEY, baseURL: QWEN_SELFHOSTED_BASE_URL })
  }
  return qwenSelfHosted
}

function getMistralSelfHostedClient(): OpenAI {
  if (!MISTRAL_SELFHOSTED_BASE_URL) {
    throw new Error(
      '[AIClient] Private tier (Option B / Mistral) requested but MISTRAL_SELFHOSTED_BASE_URL is not set. ' +
      'The self-hosted Mistral endpoint does not exist yet — this is expected until that infra ships, ' +
      'not a routing bug. See lib/ai-client.ts doc comment.',
    )
  }
  if (!mistralSelfHosted) {
    mistralSelfHosted = new OpenAI({ apiKey: MISTRAL_SELFHOSTED_API_KEY, baseURL: MISTRAL_SELFHOSTED_BASE_URL })
  }
  return mistralSelfHosted
}

// ── 503 retry helper ───────────────────────────────────────────────────────────
// DeepSeek returns 503 during peak load. One retry after a short wait recovers
// the majority of transient overloads without meaningfully increasing latency.
// Reused for every OpenAI-compatible provider (DeepSeek, Mistral, self-hosted
// Qwen/Mistral) — the 503-under-load pattern isn't DeepSeek-specific.
const RETRY_WAIT_MS   = 5000
const MAX_503_RETRIES = 2

function is503(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as Record<string, unknown>
  return e['status'] === 503 || e['code'] === 'service_unavailable_error'
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= MAX_503_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (is503(err) && attempt < MAX_503_RETRIES) {
        console.warn(`[AIClient] 503 on ${label} — retrying in ${RETRY_WAIT_MS}ms (attempt ${attempt + 1}/${MAX_503_RETRIES})`)
        await new Promise(r => setTimeout(r, RETRY_WAIT_MS))
        lastErr = err
      } else {
        throw err
      }
    }
  }
  throw lastErr
}

// ── Tiered resolution ─────────────────────────────────────────────────────────

type Role = 'fast' | 'premium'

type ResolvedTarget =
  | { kind: 'anthropic-legacy' }
  | { kind: 'deepseek-legacy' }
  | { kind: 'mistral-cloud' }
  | { kind: 'anthropic-elite' }
  | { kind: 'qwen-selfhosted';    role: Role }
  | { kind: 'mistral-selfhosted'; role: Role }

// requestedRole is the literal value each call site passes today — kept as
// the same 'anthropic' | 'deepseek' union so no call site needs to change.
// Under tiered routing it's reinterpreted as premium/fast (see doc comment).
function roleFromRequested(requested?: 'anthropic' | 'deepseek'): Role {
  return requested === 'anthropic' ? 'premium' : 'fast'
}

function resolveTieredTarget(tierInfo: ProductTierInfo, role: Role): ResolvedTarget {
  switch (tierInfo.tier) {
    case 'elite':
      return role === 'premium' ? { kind: 'anthropic-elite' } : { kind: 'mistral-cloud' }
    case 'private': {
      // Conservative default if a Private row somehow has no family set —
      // Option B (Mistral) rather than silently picking the China-origin
      // path (TD-KL-1 / TD-LD-7 both treat that as a decision the buyer
      // makes explicitly, never a silent default).
      const family = tierInfo.privateModelFamily ?? 'mistral'
      return family === 'qwen'
        ? { kind: 'qwen-selfhosted', role }
        : { kind: 'mistral-selfhosted', role }
    }
    case 'free':
    default:
      return { kind: 'mistral-cloud' }
  }
}

// ── Per-user routing override (TD-LD-10 / TD-LD-11) ─────────────────────────
// Checked BEFORE resolveTieredTarget's tier default — see
// supabase/add_model_route_overrides_and_request_log.sql and
// lib/product-tier.ts. Same vocabulary as ResolvedTarget.kind, just
// underscore_case in the DB/headers (SQL/HTTP-header convention) vs
// kebab-case here (this file's existing convention) — translated 1:1, no
// semantic difference.
function resolveOverrideTarget(override: RouteOverride | null | undefined, role: Role): ResolvedTarget | undefined {
  switch (override) {
    case 'deepseek':           return { kind: 'deepseek-legacy' }
    case 'mistral_cloud':      return { kind: 'mistral-cloud' }
    case 'anthropic_elite':    return { kind: 'anthropic-elite' }
    case 'qwen_selfhosted':    return { kind: 'qwen-selfhosted', role }
    case 'mistral_selfhosted': return { kind: 'mistral-selfhosted', role }
    default:                   return undefined
  }
}

interface ResolveResult {
  target:      ResolvedTarget
  tierInfo?:   ProductTierInfo   // undefined in legacy mode — no tier concept there
  role?:       Role              // undefined in legacy mode
  wasOverride: boolean
}

/**
 * resolveProvider — single choke point for both legacy and tiered routing.
 *
 * Legacy path (TIERED_ROUTING_ENABLED=false, default): unchanged from before
 * this file was touched — ROUTING_MODE=deepseek_only forces deepseek;
 * otherwise the per-call `requested` flag wins, falling back to
 * AI_PROVIDER/GLOBAL_PROVIDER when omitted.
 *
 * Tiered path (TIERED_ROUTING_ENABLED=true): reads tier-context, reinterprets
 * `requested` as a role, checks that account's per-user routing override
 * first (TD-LD-11), and falls back to (tier, role) → a concrete target when
 * there's no override. Falls back to 'free' if no tier-context was set (see
 * lib/tier-context.ts doc comment on why that's the safe default for an
 * un-wired call site).
 */
async function resolveProvider(requested?: 'anthropic' | 'deepseek'): Promise<ResolveResult> {
  if (!TIERED_ROUTING_ENABLED) {
    if (ROUTING_MODE === 'deepseek_only') return { target: { kind: 'deepseek-legacy' }, wasOverride: false }
    const p = requested ?? GLOBAL_PROVIDER
    return { target: p === 'deepseek' ? { kind: 'deepseek-legacy' } : { kind: 'anthropic-legacy' }, wasOverride: false }
  }

  // Precedence: explicit AsyncLocalStorage override (cron/batch routes) →
  // middleware-populated headers (every normal route, zero wiring needed) →
  // 'free' (see the doc comment above getTierFromHeaders for why).
  const tierInfo = getCurrentTier() ?? (await getTierFromHeaders()) ?? FREE_TIER
  const role     = roleFromRequested(requested)

  const overrideValue  = role === 'premium' ? tierInfo.modelRoutePremium : tierInfo.modelRouteFast
  const overrideTarget = resolveOverrideTarget(overrideValue, role)
  if (overrideTarget) return { target: overrideTarget, tierInfo, role, wasOverride: true }

  return { target: resolveTieredTarget(tierInfo, role), tierInfo, role, wasOverride: false }
}

// ── Model-family peek (for model-aware prompt extensions) ───────────────────
//
// Added alongside lib/personas.ts's MISTRAL_* prompt extensions. A caller
// that wants to append a model-specific instruction block (e.g. the
// Mistral-only evidence-discipline / synthesis-depth text in personas.ts)
// needs to know which model family a call will resolve to BEFORE it finishes
// assembling that call's systemPrompt — but resolveProvider() is only
// otherwise invoked from inside createStream/createCompletion, after the
// systemPrompt is already built.
//
// getModelFamily() re-runs the exact same resolution (same TIERED_ROUTING_ENABLED
// check, same header/override read, same `requested` flag) and returns only
// the resulting family. Call it with the SAME `requested` value you'll pass
// to createStream/createCompletion moments later — resolveProvider() is a
// pure function of (TIERED_ROUTING_ENABLED, request headers, tier-context
// override, requested) with no I/O and no randomness, so the peek and the
// real call can never disagree within one request.
//
// Cost: identical to one resolveProvider() call — header reads + a switch
// statement, no DB query, no network call. Safe to call once per AI call
// site, immediately before building that call's systemPrompt.
export type ModelFamily = 'anthropic' | 'deepseek' | 'mistral' | 'qwen'

export async function getModelFamily(requested?: 'anthropic' | 'deepseek'): Promise<ModelFamily> {
  const { target } = await resolveProvider(requested)
  switch (target.kind) {
    case 'anthropic-legacy':
    case 'anthropic-elite':
      return 'anthropic'
    case 'deepseek-legacy':
      return 'deepseek'
    case 'mistral-cloud':
    case 'mistral-selfhosted':
      return 'mistral'
    case 'qwen-selfhosted':
      return 'qwen'
  }
}

function describeTarget(t: ResolvedTarget): string {
  switch (t.kind) {
    case 'anthropic-legacy':   return `anthropic (${ANTHROPIC_MODEL})`
    case 'deepseek-legacy':    return `deepseek (${DEEPSEEK_MODEL})`
    case 'mistral-cloud':      return `mistral-cloud (${MISTRAL_MODEL})`
    case 'anthropic-elite':    return `anthropic-elite (${ELITE_PREMIUM_MODEL})`
    case 'qwen-selfhosted':    return `qwen-selfhosted/${t.role} (${t.role === 'premium' ? QWEN_PREMIUM_MODEL : QWEN_FAST_MODEL})`
    case 'mistral-selfhosted': return `mistral-selfhosted/${t.role} (${t.role === 'premium' ? MISTRAL_SELFHOSTED_PREMIUM_MODEL : MISTRAL_SELFHOSTED_FAST_MODEL})`
  }
}

// literal model string for a target, for the persisted audit log — same
// data describeTarget() shows, just without the "kind (" wrapper text.
function modelForTarget(t: ResolvedTarget): string {
  switch (t.kind) {
    case 'anthropic-legacy':   return ANTHROPIC_MODEL
    case 'deepseek-legacy':    return DEEPSEEK_MODEL
    case 'mistral-cloud':      return MISTRAL_MODEL
    case 'anthropic-elite':    return ELITE_PREMIUM_MODEL
    case 'qwen-selfhosted':    return t.role === 'premium' ? QWEN_PREMIUM_MODEL : QWEN_FAST_MODEL
    case 'mistral-selfhosted': return t.role === 'premium' ? MISTRAL_SELFHOSTED_PREMIUM_MODEL : MISTRAL_SELFHOSTED_FAST_MODEL
  }
}

/**
 * logResolvedRequest — persisted audit trail (TD-LD-10), fire-and-forget.
 *
 * Writes to ai_request_log so a future privacy audit can verify which model
 * actually handled a given request, rather than trusting console output.
 * Deliberately NOT awaited by callers — a DB write here should never add
 * latency to a user-facing AI call, and a failed write should never fail the
 * call itself. Only called when TIERED_ROUTING_ENABLED is true; the legacy
 * path writes nothing, matching the master switch's "zero behavior change
 * when off" guarantee (no new side effects, not just no new routing).
 */
function logResolvedRequest(result: ResolveResult, callLabel: string): void {
  if (!TIERED_ROUTING_ENABLED) return
  try {
    const supabase = createServiceClient()
    supabase.from('ai_request_log').insert({
      user_id:         result.tierInfo?.userId ?? null,
      tier:            result.tierInfo?.tier ?? 'free',
      role:            result.role ?? 'fast',
      resolved_target: result.target.kind,
      resolved_model:  modelForTarget(result.target),
      was_override:    result.wasOverride,
      call_label:      callLabel,
    }).then(({ error }: { error: unknown }) => {
      if (error) console.error('[AIClient] ai_request_log insert failed (non-fatal):', error)
    })
  } catch (err) {
    // Never let audit logging affect the actual AI call.
    console.error('[AIClient] ai_request_log logging threw (non-fatal):', err)
  }
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface StreamResult {
  readable:   ReadableStream<Uint8Array>
  getContent: () => string
}

/**
 * Options for createCompletion.
 * All fields are optional — omitting `provider` falls back to AI_PROVIDER env var
 * (legacy) or the 'fast' role (tiered).
 */
export interface CompletionOptions {
  /** Pin this call to a specific provider (legacy) / role (tiered). See file doc comment. */
  provider?: 'anthropic' | 'deepseek'
  /**
   * System prompt.
   * Passed as Anthropic `system` param or prepended as an OpenAI `system` message.
   * Use when the call requires a separate system + user message structure
   * (e.g. ontology tagger).
   */
  systemPrompt?: string
  /**
   * Sampling temperature (0.0–1.0).
   * Defaults to each provider's default when omitted.
   * Set low (0.0–0.2) for structured/JSON outputs that require determinism.
   * Silently ignored for DeepSeek calls when DEEPSEEK_THINKING=enabled.
   */
  temperature?: number
}

// ── Generic OpenAI-compatible streaming/completion helpers ─────────────────────
// Shared by DeepSeek, Mistral (cloud), and self-hosted Qwen/Mistral — all
// speak the same OpenAI-compatible /v1/chat/completions shape. Only Anthropic
// needs its own implementation (different SDK, different event shape).

async function streamOpenAICompatible(
  client:       OpenAI,
  model:        string,
  systemPrompt: string,
  messages:     { role: 'user' | 'assistant'; content: string }[],
  maxTokens:    number,
  label:        string,
  thinking?:    'enabled' | 'disabled',
): Promise<StreamResult> {
  const stream = await withRetry(
    () => client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      stream:     true,
      messages:   [{ role: 'system', content: systemPrompt }, ...messages],
      ...(thinking ? { thinking: { type: thinking } } : {}),
    } as any) as any,
    label,
  ) as AsyncIterable<any>
  const encoder = new TextEncoder()
  let fullContent = ''
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content ?? ''
          if (text) { fullContent += text; controller.enqueue(encoder.encode(text)) }
        }
        controller.close()
      } catch (err) { controller.error(err) }
    },
  })
  return { readable, getContent: () => fullContent }
}

async function completeOpenAICompatible(
  client:       OpenAI,
  model:        string,
  prompt:       string,
  maxTokens:    number,
  label:        string,
  systemPrompt?: string,
  temperature?:  number,
  thinking?:     'enabled' | 'disabled',
): Promise<string> {
  const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = []
  if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt })
  msgs.push({ role: 'user', content: prompt })

  const res = await withRetry(
    () => client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      stream:     false,
      ...(temperature !== undefined && thinking !== 'enabled' ? { temperature } : {}),
      messages:   msgs,
      ...(thinking ? { thinking: { type: thinking } } : {}),
    } as any),
    label,
  )
  return (res as any).choices[0]?.message?.content ?? ''
}

// ── Streaming ─────────────────────────────────────────────────────────────────

/**
 * createStream — streaming AI call for user-facing Council output.
 *
 * See file doc comment for the full legacy vs tiered routing behavior.
 *
 * maxTokens (bug fix): every call used a hardcoded 1200, regardless of how
 * much output the prompt actually demands. That's enough for a single advisor
 * persona, but the SYNTHESIS prompt (lib/personas.ts) mandates a long list of
 * sections — verdict, conditions, 2–4 paragraphs of prose, optional SB-3
 * additions, then <action_plan> (3–4 items) and <confidence_to_act> LAST,
 * after everything else. A verbose-but-otherwise-normal synthesis routinely
 * runs past 1200 tokens (~900 words), and since the two action tags are
 * mandated to be the final thing the model writes, they are the first thing
 * to get cut off mid-tag when the limit hits — which is exactly what left
 * raw, unclosed <action_plan>/<confidence_to_act> markup visible on the
 * session page in hybrid mode (where synthesis runs on Claude specifically;
 * see resolveProvider above). Not a timeout — a token ceiling. Callers that
 * need more room now pass maxTokens explicitly; anything that doesn't is
 * unaffected (default matches the old hardcoded value exactly).
 */
export async function createStream(
  systemPrompt: string,
  messages:     { role: 'user' | 'assistant'; content: string }[],
  provider?:    'anthropic' | 'deepseek',
  maxTokens:    number = 1200,
): Promise<StreamResult> {
  const result = await resolveProvider(provider)
  const target = result.target
  console.log(`[AIClient] createStream → ${describeTarget(target)} (${maxTokens} max tokens)${TIERED_ROUTING_ENABLED ? (result.wasOverride ? ' [tiered, override]' : ' [tiered]') : ROUTING_MODE === 'deepseek_only' ? ' (deepseek_only override)' : ''}`)
  logResolvedRequest(result, 'createStream')

  switch (target.kind) {
    case 'anthropic-legacy':
      return streamAnthropic(systemPrompt, messages, maxTokens, ANTHROPIC_MODEL)
    case 'deepseek-legacy':
      return streamOpenAICompatible(deepseek, DEEPSEEK_MODEL, systemPrompt, messages, maxTokens, 'streamDeepSeek', DEEPSEEK_THINKING)
    case 'mistral-cloud':
      return streamOpenAICompatible(mistral, MISTRAL_MODEL, systemPrompt, messages, maxTokens, 'streamMistral')
    case 'anthropic-elite':
      return streamAnthropic(systemPrompt, messages, maxTokens, ELITE_PREMIUM_MODEL)
    case 'qwen-selfhosted':
      return streamOpenAICompatible(
        getQwenSelfHostedClient(),
        target.role === 'premium' ? QWEN_PREMIUM_MODEL : QWEN_FAST_MODEL,
        systemPrompt, messages, maxTokens, 'streamQwenSelfHosted',
      )
    case 'mistral-selfhosted':
      return streamOpenAICompatible(
        getMistralSelfHostedClient(),
        target.role === 'premium' ? MISTRAL_SELFHOSTED_PREMIUM_MODEL : MISTRAL_SELFHOSTED_FAST_MODEL,
        systemPrompt, messages, maxTokens, 'streamMistralSelfHosted',
      )
  }
}

async function streamAnthropic(
  systemPrompt: string,
  messages:     { role: 'user' | 'assistant'; content: string }[],
  maxTokens:    number = 1200,
  model:        string = ANTHROPIC_MODEL,
): Promise<StreamResult> {
  const stream = await anthropic.messages.stream({
    model,
    max_tokens: maxTokens,
    system:     systemPrompt,
    messages:   messages as Anthropic.MessageParam[],
  })
  const encoder = new TextEncoder()
  let fullContent = ''
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            fullContent += event.delta.text
            controller.enqueue(encoder.encode(event.delta.text))
          }
        }
        controller.close()
      } catch (err) { controller.error(err) }
    },
  })
  return { readable, getContent: () => fullContent }
}

// ── Non-streaming completion ───────────────────────────────────────────────────

/**
 * createCompletion — non-streaming AI call for background/structured tasks.
 *
 * Backward compatible: callers that pass only (prompt, maxTokens) are unaffected.
 * See file doc comment for the full legacy vs tiered routing behavior.
 *
 * @example
 *   // Structured call — always Claude in legacy hybrid mode, always premium
 *   // role in tiered mode
 *   await createCompletion(prompt, 4000, { provider: 'anthropic' })
 *
 *   // Generative call — always DeepSeek in legacy hybrid mode, always fast
 *   // role in tiered mode
 *   await createCompletion(prompt, 1200, { provider: 'deepseek' })
 *
 *   // With separate system prompt + low temperature (e.g. ontology tagger)
 *   await createCompletion(userMsg, 2000, {
 *     provider:     'anthropic',
 *     systemPrompt: TAGGER_SYSTEM,
 *     temperature:  0.1,
 *   })
 */
export async function createCompletion(
  prompt:    string,
  maxTokens  = 4000,
  options:   CompletionOptions = {},
): Promise<string> {
  const { provider, systemPrompt, temperature } = options
  const result = await resolveProvider(provider)
  const target = result.target
  console.log(`[AIClient] createCompletion → ${describeTarget(target)} (${maxTokens} max tokens)${TIERED_ROUTING_ENABLED ? (result.wasOverride ? ' [tiered, override]' : ' [tiered]') : ROUTING_MODE === 'deepseek_only' ? ' (deepseek_only override)' : ''}`)
  logResolvedRequest(result, 'createCompletion')

  switch (target.kind) {
    case 'deepseek-legacy':
      return completeOpenAICompatible(deepseek, DEEPSEEK_MODEL, prompt, maxTokens, 'createCompletion/deepseek', systemPrompt, temperature, DEEPSEEK_THINKING)
    case 'mistral-cloud':
      return completeOpenAICompatible(mistral, MISTRAL_MODEL, prompt, maxTokens, 'createCompletion/mistral', systemPrompt, temperature)
    case 'qwen-selfhosted':
      return completeOpenAICompatible(
        getQwenSelfHostedClient(),
        target.role === 'premium' ? QWEN_PREMIUM_MODEL : QWEN_FAST_MODEL,
        prompt, maxTokens, 'createCompletion/qwen-selfhosted', systemPrompt, temperature,
      )
    case 'mistral-selfhosted':
      return completeOpenAICompatible(
        getMistralSelfHostedClient(),
        target.role === 'premium' ? MISTRAL_SELFHOSTED_PREMIUM_MODEL : MISTRAL_SELFHOSTED_FAST_MODEL,
        prompt, maxTokens, 'createCompletion/mistral-selfhosted', systemPrompt, temperature,
      )
    case 'anthropic-legacy':
    case 'anthropic-elite': {
      const model = target.kind === 'anthropic-elite' ? ELITE_PREMIUM_MODEL : ANTHROPIC_MODEL
      const res = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        ...(systemPrompt  ? { system: systemPrompt }  : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        messages: [{ role: 'user', content: prompt }],
      })
      return res.content[0].type === 'text' ? res.content[0].text : ''
    }
  }
}

// ── Provider info ──────────────────────────────────────────────────────────────

export function getProviderInfo() {
  return {
    provider:             GLOBAL_PROVIDER,
    routingMode:          ROUTING_MODE,
    tieredRoutingEnabled: TIERED_ROUTING_ENABLED,
    model:                GLOBAL_PROVIDER === 'deepseek' ? DEEPSEEK_MODEL : ANTHROPIC_MODEL,
    anthropicModel:       ANTHROPIC_MODEL,
    deepseekModel:        DEEPSEEK_MODEL,
    deepseekThinking:     DEEPSEEK_THINKING,
    mistralModel:         MISTRAL_MODEL,
    elitePremiumModel:    ELITE_PREMIUM_MODEL,
  }
}
