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
 *   free                    fast → resolveFastCloudTarget('free') — see
 *                           premium → FAST_MODEL_PROVIDER_FREE below; same
 *                             resolution for both roles (Free is that
 *                             provider end-to-end per the Locked v1 pricing
 *                             doc, so role is a no-op here).
 *   elite                   fast → resolveFastCloudTarget('elite') — its own
 *                             env var, moves independently from Free (see
 *                             FAST_MODEL_PROVIDER_ELITE below)
 *                           premium → Claude Sonnet 4.6 (ELITE_PREMIUM_MODEL)
 *   private / Option A      fast → self-hosted Qwen (small)
 *   (qwen)                  premium → self-hosted Qwen (large)
 *   private / Option B      fast → self-hosted Mistral Small
 *   (mistral)                premium → self-hosted Mistral Large
 *
 * FAST_MODEL_PROVIDER_FREE / FAST_MODEL_PROVIDER_ELITE env vars
 * (mistral | openai | gemini | deepseek | anthropic, default mistral):
 *   Split apart Aug 2026 from a single shared FAST_MODEL_PROVIDER var — Free
 *   (end-to-end) and Elite's fast role now move independently, since Elite is
 *   being trial-run on Claude end-to-end (see 'anthropic' below) without
 *   forcing that same cost onto every Free user. See resolveFastCloudTarget
 *   below and OPENAI_FAST_MODEL / GEMINI_FAST_MODEL for the model names used.
 *   Either var falls back to the old FAST_MODEL_PROVIDER var if unset, so an
 *   existing deployment that only sets that one still works unchanged; if
 *   neither is set, the ultimate default is 'mistral'.
 *
 *   deepseek  → DeepSeek v4 Pro (DEEPSEEK_MODEL) with thinking mode hardcoded
 *     OFF for this role (the 'deepseek-fast' target, distinct from
 *     'deepseek-legacy'), regardless of the DEEPSEEK_THINKING env var:
 *     thinking mode adds latency and disables temperature sampling, both
 *     wrong for a role whose entire purpose is speed. DEEPSEEK_THINKING still
 *     governs the separate legacy/hybrid DeepSeek path (AI_PROVIDER=deepseek,
 *     ROUTING_MODE=deepseek_only, and the 'deepseek' per-user route override)
 *     unchanged.
 *   anthropic → Claude Sonnet 4.6 (ELITE_PREMIUM_MODEL) — the SAME model and
 *     the SAME 'anthropic-elite' target Elite's premium role already uses, on
 *     purpose (the ask this was built for was "truly identical calls end to
 *     end" for an Elite Claude trial, not a separate cheaper fast-tier Claude
 *     model). No new model constant, no extended-thinking config needed —
 *     streamAnthropic never requests extended thinking for either role today.
 *     FAST_MODEL_PROVIDER_FREE=anthropic is supported for internal test
 *     flexibility ONLY — Claude end-to-end is far more expensive than
 *     DeepSeek and directly contradicts the "keeps the free tier sustainable"
 *     framing in the product FAQ. This should never be set in a production
 *     Free deployment; see the startup warning below that fires if it is.
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
 * NULL (every row's default) means no override. This is also the lower-risk
 * way to trial Elite-on-Claude on a handful of beta accounts before flipping
 * FAST_MODEL_PROVIDER_ELITE globally — set modelRouteFast='anthropic_elite'
 * on just those accounts; no code change needed, it already resolves to the
 * same { kind: 'anthropic-elite' } target.
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
import { scheduleMistralCall, estimateTokens } from './mistral-limiter'
import type { ProductTierInfo } from './product-tier'
import type { ProductTier, PrivateModelFamily, RouteOverride, PrivateEndpoint } from './types'

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
    if (!tier) {
      // Distinguish "genuinely no auth on this request" from "middleware
      // should have set this and didn't" — legitimate free-tier requests
      // still get an explicit x-product-tier: free header from middleware.ts,
      // so a totally MISSING header on a matched route (see middleware.ts's
      // config.matcher) means the per-request tier lookup itself failed or
      // was skipped. That failure is caught non-fatally inside middleware's
      // try/catch and logged there — but middleware runs on the Edge runtime
      // (see middleware.ts's doc comment), which on most hosts (Railway
      // included) logs to a SEPARATE stream from this one. Confirmed via
      // real logs (2026-08-05, session 9e1239d7): an Elite-tier synthesis
      // call silently routed to mistral-cloud instead of anthropic-elite —
      // exactly what this fallback produces — with nothing in the app-server
      // log explaining why. This line exists so that's visible from here too.
      console.warn(`[AIClient] no x-product-tier header on a tiered-routing-eligible request — falling back to free. If this account should be paid, check the Edge/middleware log stream (separate from this one) for '[middleware] tier resolution failed'.`)
      return undefined
    }
    const family = h.get('x-private-model-family') as PrivateModelFamily | null

    // JSON.parse can throw on malformed input — treat that as "no endpoint
    // available" (falls through to resolveTieredTarget's clear error) rather
    // than letting a header-parsing bug crash the whole request.
    let privateEndpoint: PrivateEndpoint | null = null
    const rawEndpoint = h.get('x-private-endpoint')
    if (rawEndpoint) {
      try { privateEndpoint = JSON.parse(rawEndpoint) as PrivateEndpoint } catch { privateEndpoint = null }
    }

    return {
      tier,
      privateModelFamily: tier === 'private' ? family : null,
      userId:             h.get('x-user-id'),
      modelRouteFast:     h.get('x-model-route-fast')    as RouteOverride | null,
      modelRoutePremium:  h.get('x-model-route-premium') as RouteOverride | null,
      privateEndpoint,
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

// ── Fast-role cloud provider switch (Aug 2026) ───────────────────────────────
// Free tier end-to-end + Elite's fast role were Mistral-only (mistral-cloud).
// Mistral Small's quality (hallucinated stakeholders, shallow synthesis — see
// the MISTRAL_* prompt-extension doc comment in lib/personas.ts) and Mistral
// Large's account RPS ceiling (0.25 req/s — sub-viable against this app's
// ~11-call-per-session volume; see lib/mistral-limiter.ts) both motivated
// evaluating non-Mistral alternatives. Rather than commit to one, this env
// var lets Free/Elite's fast role be pointed at any candidate with zero code
// change, so the comparison can be run and switched live:
//   FAST_MODEL_PROVIDER_x=mistral (default) → unchanged legacy behavior
//   FAST_MODEL_PROVIDER_x=openai            → OpenAI GPT-5 mini
//   FAST_MODEL_PROVIDER_x=gemini            → Google Gemini 2.5 Flash
//   FAST_MODEL_PROVIDER_x=deepseek          → DeepSeek v4 Pro, thinking OFF
//                                              (hardcoded — see DEEPSEEK_THINKING
//                                              note in the file doc comment)
//   FAST_MODEL_PROVIDER_x=anthropic         → Claude Sonnet 4.6, same model
//                                              and target as Elite's premium
//                                              role (see file doc comment) —
//                                              FREE variant is test-only, see
//                                              startup warning below
//
// Split (Aug 2026) into FAST_MODEL_PROVIDER_FREE and FAST_MODEL_PROVIDER_ELITE
// so Free and Elite's fast role can move independently — this is what makes
// an Elite-only Claude trial possible without also putting every Free user
// on Claude's cost. resolveFastCloudTarget(tier) below is the only place
// either is read. Each falls back to the old shared FAST_MODEL_PROVIDER var
// if its own is unset (so an existing single-var deployment keeps working),
// and ultimately to 'mistral' if nothing is set at all — same reversible-
// opt-in posture as AI_PROVIDER.
const FAST_MODEL_PROVIDER_LEGACY = (process.env.FAST_MODEL_PROVIDER ?? 'mistral').toLowerCase() as
  'mistral' | 'openai' | 'gemini' | 'deepseek' | 'anthropic'

const FAST_MODEL_PROVIDER_FREE = (process.env.FAST_MODEL_PROVIDER_FREE ?? FAST_MODEL_PROVIDER_LEGACY).toLowerCase() as
  'mistral' | 'openai' | 'gemini' | 'deepseek' | 'anthropic'

const FAST_MODEL_PROVIDER_ELITE = (process.env.FAST_MODEL_PROVIDER_ELITE ?? FAST_MODEL_PROVIDER_LEGACY).toLowerCase() as
  'mistral' | 'openai' | 'gemini' | 'deepseek' | 'anthropic'

// FAST_MODEL_PROVIDER_FREE=anthropic is supported for internal test
// flexibility only (see file doc comment) — it should never reach a
// production Free deployment, since Claude end-to-end is far more expensive
// than DeepSeek and undercuts the "keeps the free tier sustainable" framing
// already public in the product FAQ. Fails loud (not silent) if it slips
// through anyway.
if (FAST_MODEL_PROVIDER_FREE === 'anthropic' && process.env.NODE_ENV === 'production') {
  console.warn(
    '[AIClient] FAST_MODEL_PROVIDER_FREE=anthropic is set in a production environment — ' +
    'this routes every Free-tier user through Claude end-to-end, which this var is meant ' +
    'for internal testing only, never production Free traffic. Double-check this is intentional.',
  )
}

const OPENAI_API_KEY    = process.env.OPENAI_API_KEY ?? ''
const OPENAI_FAST_MODEL = process.env.OPENAI_FAST_MODEL ?? 'gpt-5-mini'

const GEMINI_API_KEY    = process.env.GEMINI_API_KEY ?? ''
const GEMINI_FAST_MODEL = process.env.GEMINI_FAST_MODEL ?? 'gemini-2.5-flash'

// Private tier — self-hosted, buyer's Option A (Qwen) or Option B (Mistral).
// Infra not live yet (see doc comment above); these are read lazily, only
// when a Private-tier call is actually made, so an unconfigured deployment
// doesn't block Free/Elite from working.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })
const deepseek  = new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY ?? '', baseURL: 'https://api.deepseek.com' })

// Mistral's chat completions API is OpenAI-compatible (same pattern as
// DeepSeek above) — base URL, key, and model name are the only differences.
// See https://docs.mistral.ai/api — /v1/chat/completions accepts the same
// request/response shape as OpenAI's SDK expects.
const mistral = new OpenAI({ apiKey: MISTRAL_API_KEY, baseURL: 'https://api.mistral.ai/v1' })

// OpenAI (GPT-5 mini) — fast-role candidate. Default OpenAI SDK baseURL
// (api.openai.com) needs no override.
const openaiFast = new OpenAI({ apiKey: OPENAI_API_KEY })

// Gemini (2.5 Flash) — fast-role candidate, via Google's OpenAI-compatibility
// endpoint. Same request/response shape as Mistral/DeepSeek above (confirmed:
// standard temperature/max_tokens/stream params are handled), so it reuses
// streamOpenAICompatible/completeOpenAICompatible with zero new parsing code.
// See https://ai.google.dev/gemini-api/docs/openai
const gemini = new OpenAI({ apiKey: GEMINI_API_KEY, baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/' })

// Self-hosted Qwen/Mistral (Private tier) — NO global client here anymore.
// Each Private customer has their own cloud account, own URL, own key (see
// supabase/add_private_deployments.sql) — a module-level singleton would
// silently reuse the FIRST customer's connection for every other customer,
// which was a real bug in the original single-global-endpoint design.
// Instead, a fresh OpenAI-compatible client is constructed per call from
// ResolvedTarget.endpoint (set in resolveTieredTarget below, sourced from
// that customer's ProductTierInfo.privateEndpoint). This is cheap — it's
// just an object construction, not a network connection — so not caching it
// costs nothing measurable.
function getPrivateClient(endpoint: PrivateEndpoint): OpenAI {
  return new OpenAI({ apiKey: endpoint.apiKey, baseURL: endpoint.baseUrl })
}

// ── Transient-error retry helper ────────────────────────────────────────────
// DeepSeek returns 503 during peak load; a short wait and one retry recovers
// the majority of those. Originally this ONLY covered 503 — but a client-side
// investigation (PersonaPanel) into "some personas never fired at all" traced
// several first-failures back to errors that never reached this retry at all:
// 502/504 (upstream gateway hiccups), and connection-level failures (timeout,
// reset, DNS blip) that the OpenAI SDK surfaces with no `status` field, only
// a `code`/`name`/message. Every one of those used to throw straight through
// to route.ts's catch block on the FIRST attempt — no retry — which is a
// meaningfully likely trigger for the original bug, on top of the sequential-
// gate issue itself. Broadened to cover all of these; still bounded and still
// only for genuinely transient conditions. (429 rate limits were originally
// excluded here on the theory that they should surface to client-side
// rate-limit handling instead — see the Rate-limit section below for why
// that turned out not to hold up and got its own retry path.) Reused for
// every OpenAI-compatible provider (DeepSeek, Mistral, self-hosted
// Qwen/Mistral) — none of these failure modes are provider-specific.
const RETRY_WAIT_MS      = 5000
const MAX_TRANSIENT_RETRIES = 2

// ── Rate-limit (429) handling ────────────────────────────────────────────────
// Bug fix (Aug 2026): 429 was explicitly excluded from isTransientError below
// by design — the reasoning was that a real rate limit "should surface to the
// client's own rate-limit handling" rather than being silently absorbed here.
// In practice no such client-side handling exists: a 429 anywhere in the call
// chain throws straight out to route.ts's outer catch, which returns a bare
// "Internal server error" (500) with no indication it was a rate limit, and
// SynthesisCard.tsx has no special case for it — the user just sees a failed
// synthesis and has to reload. Confirmed via real Railway logs (2026-08-05,
// session 9e1239d7): all 6 persona calls + several scoring completions fired
// against mistral-cloud within ~15s, then the synthesis call (the single
// heaviest, 3200 tokens) hit the same provider's per-minute limit and threw
// a raw 429 with zero retry. Given a burst-triggered per-minute rate limit
// typically clears within seconds, retrying (honoring Retry-After when the
// provider sends one) is the right fix — kept as its own function, separate
// from isTransientError, since it's a distinct failure mode with its own
// backoff logic rather than a generic "service had a hiccup" case.
const RATE_LIMIT_WAIT_MS = 8000

function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  return (err as Record<string, unknown>)['status'] === 429
}

// Extracts a provider-supplied Retry-After (seconds, or an HTTP date) when
// present. Both the OpenAI SDK (Mistral/DeepSeek) and Anthropic SDK expose
// response headers on thrown errors, but not identically — OpenAI's tends to
// be a plain Record, Anthropic's a Headers-like object with .get() — so both
// shapes are checked. Returns null (caller falls back to RATE_LIMIT_WAIT_MS)
// if absent or unparsable, rather than guessing.
function getRetryAfterMs(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null
  const headers = (err as Record<string, unknown>)['headers'] as
    | Record<string, string>
    | { get?: (k: string) => string | null }
    | undefined
  if (!headers) return null
  const raw = typeof (headers as { get?: (k: string) => string | null }).get === 'function'
    ? (headers as { get: (k: string) => string | null }).get('retry-after')
    : (headers as Record<string, string>)['retry-after'] ?? (headers as Record<string, string>)['Retry-After']
  if (!raw) return null
  const asSeconds = Number(raw)
  if (!Number.isNaN(asSeconds)) return Math.max(0, asSeconds * 1000)
  const asDate = Date.parse(raw)
  return Number.isNaN(asDate) ? null : Math.max(0, asDate - Date.now())
}

// ── GPT-5-family request-shape quirks ────────────────────────────────────────
// OpenAI's GPT-5 family (gpt-5, gpt-5-mini, gpt-5-nano, and dated snapshots)
// rejects two params every other OpenAI-compatible provider in this file
// (DeepSeek, Mistral, Gemini, self-hosted) accepts fine:
//   - `max_tokens` → 400 "Unsupported parameter: 'max_tokens'... use
//     'max_completion_tokens' instead"
//   - `temperature` (any value but the default, 1) → 400 "Unsupported value:
//     'temperature' does not support X with this model"
// Detected by model-name prefix rather than by ResolvedTarget.kind, so this
// stays correct if OPENAI_FAST_MODEL is ever pointed at a non-GPT-5 OpenAI
// model (e.g. gpt-4.1-mini), which has neither restriction.
//
// Bug fix (Aug 2026) — silent truncation via invisible reasoning tokens:
// a live comparison run against gpt-5-mini as a fast-role candidate showed
// synthesis output cut to 1-2 lines, most of the 6 persona calls missing
// entirely, and some calls erroring outright. Root cause: GPT-5-family
// "reasoning" models spend tokens on an internal, non-visible reasoning pass
// BEFORE producing visible content, and those reasoning tokens are drawn
// from the SAME max_completion_tokens budget as the visible output — this
// file was already correctly using max_completion_tokens (see above), but
// never set reasoning_effort, so every GPT-5-family call defaulted to
// standard (non-minimal) reasoning. On Quorum's synthesis prompt in
// particular (explicitly asks the model to work through several layers of
// "what's beneath the question" before writing), that default reasoning
// pass can consume most or all of a 2200-3200 token budget invisibly,
// leaving little or nothing for the actual verdict/synthesis text — this
// is a widely-reported OpenAI API behavior (see e.g. openai-python#2546),
// not specific to Quorum's prompts. Fixed by pinning reasoning_effort to
// 'minimal' for every GPT-5-family call in this file — this role is meant
// to be the FAST role to begin with, so suppressing the model's own
// deliberation is the correct behavior here, not a workaround being forced
// onto it. This does not necessarily mean gpt-5-mini's underlying output
// QUALITY is sufficient for Quorum's persona/synthesis prompts — that
// remains a separate, still-open question — but the truncation/dropped-
// persona/error symptoms specifically should not recur after this fix, so
// a re-test with this fix in place is needed before drawing a capability
// conclusion from the earlier (pre-fix) run.
function isGpt5ReasoningModel(model: string): boolean {
  return /^gpt-5/.test(model)
}

function isTransientError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as Record<string, unknown>
  if (e['status'] === 503 || e['status'] === 502 || e['status'] === 504) return true
  // Anthropic-specific: 529 is their dedicated "overloaded_error" status,
  // returned when the API is under heavy load — transient by definition,
  // distinct from the generic 502/503/504 set above (which is why it needs
  // its own check; a plain numeric-range test would miss it). This was
  // previously unhandled everywhere in this file, and streamAnthropic (the
  // synthesis call's provider) had no retry wrapper at all — so a 529 during
  // synthesis failed the whole request outright with no recovery attempt.
  if (e['status'] === 529) return true
  if (e['code'] === 'service_unavailable_error' || e['code'] === 'overloaded_error') return true
  // OpenAI SDK connection-level errors (no HTTP status at all — the request
  // never got a response): APIConnectionError / APIConnectionTimeoutError.
  const name = typeof e['name'] === 'string' ? e['name'] : ''
  if (name === 'APIConnectionError' || name === 'APIConnectionTimeoutError') return true
  const code = typeof e['code'] === 'string' ? e['code'] : ''
  if (['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN'].includes(code)) return true
  const message = typeof e['message'] === 'string' ? e['message'] : ''
  if (/timeout|timed out|network|socket hang up|overloaded/i.test(message)) return true
  return false
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const rateLimited = isRateLimitError(err)
      if ((rateLimited || isTransientError(err)) && attempt < MAX_TRANSIENT_RETRIES) {
        const wait = rateLimited ? (getRetryAfterMs(err) ?? RATE_LIMIT_WAIT_MS) : RETRY_WAIT_MS
        console.warn(`[AIClient] ${rateLimited ? 'rate limited (429)' : 'transient error'} on ${label} — retrying in ${wait}ms (attempt ${attempt + 1}/${MAX_TRANSIENT_RETRIES})`)
        await new Promise(r => setTimeout(r, wait))
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
  | { kind: 'openai-fast' }
  | { kind: 'gemini-fast' }
  | { kind: 'deepseek-fast' }
  | { kind: 'anthropic-elite' }
  | { kind: 'qwen-selfhosted';    role: Role; endpoint: PrivateEndpoint }
  | { kind: 'mistral-selfhosted'; role: Role; endpoint: PrivateEndpoint }

// requestedRole is the literal value each call site passes today — kept as
// the same 'anthropic' | 'deepseek' union so no call site needs to change.
// Under tiered routing it's reinterpreted as premium/fast (see doc comment).
// 'openai' (added 2026-08, see resolveProvider's own doc comment on the
// dedicated branch for it) is NOT part of this premium/fast reinterpretation
// — it's handled as an unconditional direct target before this function
// even runs, so it never reaches here.
function roleFromRequested(requested?: 'anthropic' | 'deepseek'): Role {
  return requested === 'anthropic' ? 'premium' : 'fast'
}

// Choke point for "which cloud provider serves the fast role" — takes the
// tier explicitly now (Aug 2026 split) so Free and Elite read their own env
// var (FAST_MODEL_PROVIDER_FREE / FAST_MODEL_PROVIDER_ELITE) and can move
// independently. See those vars' doc comment above for the anthropic case.
function resolveFastCloudTarget(tier: 'free' | 'elite'): ResolvedTarget {
  const provider = tier === 'elite' ? FAST_MODEL_PROVIDER_ELITE : FAST_MODEL_PROVIDER_FREE
  switch (provider) {
    case 'openai':    return { kind: 'openai-fast' }
    case 'gemini':    return { kind: 'gemini-fast' }
    case 'deepseek':  return { kind: 'deepseek-fast' }
    // Same target Elite's premium role already resolves to, on purpose —
    // see file doc comment ("truly identical calls end to end").
    case 'anthropic': return { kind: 'anthropic-elite' }
    case 'mistral':
    default:           return { kind: 'mistral-cloud' }
  }
}

function resolveTieredTarget(tierInfo: ProductTierInfo, role: Role): ResolvedTarget {
  switch (tierInfo.tier) {
    case 'elite':
      return role === 'premium' ? { kind: 'anthropic-elite' } : resolveFastCloudTarget('elite')
    case 'private': {
      // Conservative default if a Private row somehow has no family set —
      // Option B (Mistral) rather than silently picking the China-origin
      // path (TD-KL-1 / TD-LD-7 both treat that as a decision the buyer
      // makes explicitly, never a silent default).
      const family = tierInfo.privateModelFamily ?? 'mistral'

      if (!tierInfo.privateEndpoint) {
        // Granted Private but private_deployments has no row for them yet —
        // a real, expected state between granting access and finishing the
        // deploy (see infra/README.md), not a routing bug. Fails loudly
        // here rather than silently falling back to a different tier.
        throw new Error(
          `[AIClient] Private tier resolved for user ${tierInfo.userId ?? '(unknown)'} but no ` +
          `private_deployments row exists yet — their dedicated infra hasn't finished deploying. ` +
          `See supabase/add_private_deployments.sql and infra/README.md.`,
        )
      }

      return family === 'qwen'
        ? { kind: 'qwen-selfhosted', role, endpoint: tierInfo.privateEndpoint }
        : { kind: 'mistral-selfhosted', role, endpoint: tierInfo.privateEndpoint }
    }
    case 'free':
    default:
      return resolveFastCloudTarget('free')
  }
}

// ── Per-user routing override (TD-LD-10 / TD-LD-11) ─────────────────────────
// Checked BEFORE resolveTieredTarget's tier default — see
// supabase/add_model_route_overrides_and_request_log.sql and
// lib/product-tier.ts. Same vocabulary as ResolvedTarget.kind, just
// underscore_case in the DB/headers (SQL/HTTP-header convention) vs
// kebab-case here (this file's existing convention) — translated 1:1, no
// semantic difference.
//
// qwen_selfhosted/mistral_selfhosted overrides need an endpoint the same way
// the tier default does — there's no "the" self-hosted endpoint anymore
// (per-customer, see PrivateEndpoint), so an override to self-hosted only
// makes sense on an account that itself has a private_deployments row (e.g.
// the founder's own personal test deployment). If it doesn't, this throws
// the same way resolveTieredTarget's Private branch does — an override
// that can't be satisfied should fail loudly, not silently fall through to
// the tier default as if no override had been set.
function resolveOverrideTarget(
  override:   RouteOverride | null | undefined,
  role:       Role,
  tierInfo:   ProductTierInfo,
): ResolvedTarget | undefined {
  switch (override) {
    case 'deepseek':        return { kind: 'deepseek-legacy' }
    case 'mistral_cloud':   return { kind: 'mistral-cloud' }
    case 'anthropic_elite': return { kind: 'anthropic-elite' }
    case 'qwen_selfhosted':
    case 'mistral_selfhosted': {
      if (!tierInfo.privateEndpoint) {
        throw new Error(
          `[AIClient] ${override} override set for user ${tierInfo.userId ?? '(unknown)'} but they have ` +
          `no private_deployments row — a self-hosted override needs that account's own deployment. ` +
          `See supabase/add_private_deployments.sql.`,
        )
      }
      return { kind: override === 'qwen_selfhosted' ? 'qwen-selfhosted' : 'mistral-selfhosted', role, endpoint: tierInfo.privateEndpoint }
    }
    default: return undefined
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
 *
 * requested === 'openai' (added 2026-08, DeepSeek → GPT-5-mini migration):
 * unconditional direct target, resolved BEFORE either path above and not
 * subject to tiering, per-user overrides, or ROUTING_MODE at all. This is
 * deliberately different from how 'deepseek' behaves — 'deepseek' still
 * flows through the tiered/legacy split above and would become tier-subject
 * if TIERED_ROUTING_ENABLED were ever turned on. The seven call sites this
 * was built for (Examiner question generation, Decision Brief generation,
 * Mirror Fingerprint narrative, the alerts fallback route, voice cleanup)
 * are internal system/utility calls, not the tier-differentiated advisor-
 * persona experience the fast-role A/B testing exists for — they should
 * always resolve to the same model regardless of which tier's fast-role
 * provider is currently being tested, or whether tiering is on at all.
 * Uses the same client/model constants as the tier-based 'openai-fast'
 * candidate (openaiFast client, OPENAI_FAST_MODEL) — there's genuinely only
 * one OpenAI-fast target in this file, this is just a second, unconditional
 * way to reach it.
 */
async function resolveProvider(requested?: 'anthropic' | 'deepseek' | 'openai'): Promise<ResolveResult> {
  if (requested === 'openai') {
    return { target: { kind: 'openai-fast' }, wasOverride: false }
  }

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
  const overrideTarget = resolveOverrideTarget(overrideValue, role, tierInfo)
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
export type ModelFamily = 'anthropic' | 'deepseek' | 'mistral' | 'qwen' | 'openai' | 'gemini'

export async function getModelFamily(requested?: 'anthropic' | 'deepseek' | 'openai'): Promise<ModelFamily> {
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
    case 'openai-fast':
      return 'openai'
    case 'gemini-fast':
      return 'gemini'
    case 'deepseek-fast':
      return 'deepseek'
    case 'qwen-selfhosted':
      return 'qwen'
  }
}

function describeTarget(t: ResolvedTarget): string {
  switch (t.kind) {
    case 'anthropic-legacy':   return `anthropic (${ANTHROPIC_MODEL})`
    case 'deepseek-legacy':    return `deepseek (${DEEPSEEK_MODEL})`
    case 'mistral-cloud':      return `mistral-cloud (${MISTRAL_MODEL})`
    case 'openai-fast':        return `openai-fast (${OPENAI_FAST_MODEL})`
    case 'gemini-fast':        return `gemini-fast (${GEMINI_FAST_MODEL})`
    case 'deepseek-fast':      return `deepseek-fast (${DEEPSEEK_MODEL}, thinking disabled)`
    case 'anthropic-elite':    return `anthropic-elite (${ELITE_PREMIUM_MODEL})`
    case 'qwen-selfhosted':    return `qwen-selfhosted/${t.role} (${t.endpoint.baseUrl}, ${t.role === 'premium' ? t.endpoint.premiumModel : t.endpoint.fastModel})`
    case 'mistral-selfhosted': return `mistral-selfhosted/${t.role} (${t.endpoint.baseUrl}, ${t.role === 'premium' ? t.endpoint.premiumModel : t.endpoint.fastModel})`
  }
}

// literal model string for a target, for the persisted audit log — same
// data describeTarget() shows, just without the "kind (" wrapper text.
function modelForTarget(t: ResolvedTarget): string {
  switch (t.kind) {
    case 'anthropic-legacy':   return ANTHROPIC_MODEL
    case 'deepseek-legacy':    return DEEPSEEK_MODEL
    case 'mistral-cloud':      return MISTRAL_MODEL
    case 'openai-fast':        return OPENAI_FAST_MODEL
    case 'gemini-fast':        return GEMINI_FAST_MODEL
    case 'deepseek-fast':      return DEEPSEEK_MODEL
    case 'anthropic-elite':    return ELITE_PREMIUM_MODEL
    case 'qwen-selfhosted':    return t.role === 'premium' ? t.endpoint.premiumModel : t.endpoint.fastModel
    case 'mistral-selfhosted': return t.role === 'premium' ? t.endpoint.premiumModel : t.endpoint.fastModel
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
  // Diagnostic only (bug fix — see [SynthesisAudit] in app/api/persona/route.ts):
  // exposes why the underlying provider stream ended, so callers can tell a
  // model that stopped naturally (stop_reason 'end_turn' / finish_reason 'stop')
  // apart from one that got cut off mid-output ('max_tokens' / 'length').
  // Previously this information was discarded inside each stream* helper —
  // the only visible symptom of a truncated run was a mandatory tag silently
  // missing downstream, with no way to tell truncation apart from the model
  // just not following the tag instruction. Optional so existing callers that
  // don't need it (every call site before this fix) are unaffected.
  getStopReason?: () => string | null
}

/**
 * Options for createCompletion.
 * All fields are optional — omitting `provider` falls back to AI_PROVIDER env var
 * (legacy) or the 'fast' role (tiered).
 */
export interface CompletionOptions {
  /** Pin this call to a specific provider (legacy) / role (tiered). See file doc comment.
   *  'openai' forces GPT-5-mini directly, unconditionally — see resolveProvider's
   *  doc comment on that branch for why it's handled differently from the other two. */
  provider?: 'anthropic' | 'deepseek' | 'openai'
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
  // See isGpt5ReasoningModel doc comment — GPT-5-family models need
  // max_completion_tokens instead of max_tokens, AND reasoning_effort
  // pinned to 'minimal' or their default reasoning pass can silently eat
  // the whole token budget before any visible content is written.
  const gpt5 = isGpt5ReasoningModel(model)
  const stream = await withRetry(
    () => client.chat.completions.create({
      model,
      ...(gpt5 ? { max_completion_tokens: maxTokens, reasoning_effort: 'minimal' } : { max_tokens: maxTokens }),
      stream:     true,
      messages:   [{ role: 'system', content: systemPrompt }, ...messages],
      ...(thinking ? { thinking: { type: thinking } } : {}),
    } as any) as any,
    label,
  ) as AsyncIterable<any>
  const encoder = new TextEncoder()
  let fullContent = ''
  let stopReason: string | null = null
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content ?? ''
          if (text) { fullContent += text; controller.enqueue(encoder.encode(text)) }
          // finish_reason only appears on the final chunk for a given choice;
          // every other chunk carries null, so this naturally settles on the
          // last non-null value seen.
          const finishReason = chunk.choices[0]?.finish_reason
          if (finishReason) stopReason = finishReason
        }
        controller.close()
      } catch (err) { controller.error(err) }
    },
  })
  return { readable, getContent: () => fullContent, getStopReason: () => stopReason }
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

  // See isGpt5ReasoningModel doc comment — GPT-5-family models need
  // max_completion_tokens instead of max_tokens, reject any non-default
  // temperature outright (structured/low-temperature callers — e.g. the
  // ontology tagger, bias scorer — silently lose temperature control on this
  // target; there is no equivalent knob to substitute it with), and need
  // reasoning_effort pinned to 'minimal' or their default reasoning pass can
  // silently consume the whole completion budget before any visible content.
  const gpt5 = isGpt5ReasoningModel(model)
  const res = await withRetry(
    () => client.chat.completions.create({
      model,
      ...(gpt5 ? { max_completion_tokens: maxTokens, reasoning_effort: 'minimal' } : { max_tokens: maxTokens }),
      stream:     false,
      ...(temperature !== undefined && thinking !== 'enabled' && !gpt5 ? { temperature } : {}),
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
  provider?:    'anthropic' | 'deepseek' | 'openai',
  maxTokens:    number = 1200,
): Promise<StreamResult> {
  const result = await resolveProvider(provider)
  const target = result.target
  console.log(`[AIClient] createStream → ${describeTarget(target)} (${maxTokens} max tokens)${TIERED_ROUTING_ENABLED ? (result.wasOverride ? ' [tiered, override]' : ' [tiered]') : ROUTING_MODE === 'deepseek_only' ? ' (deepseek_only override)' : ''}`)
  logResolvedRequest(result, 'createStream')

  switch (target.kind) {
    case 'anthropic-legacy':
      return streamAnthropic(systemPrompt, messages, maxTokens, ANTHROPIC_MODEL, 'streamAnthropic')
    case 'deepseek-legacy':
      return streamOpenAICompatible(deepseek, DEEPSEEK_MODEL, systemPrompt, messages, maxTokens, 'streamDeepSeek', DEEPSEEK_THINKING)
    case 'mistral-cloud': {
      // Shared-account admission control — see lib/mistral-limiter.ts and
      // the matching comment in createCompletion's 'mistral-cloud' case
      // above.
      const priority = result.tierInfo?.tier === 'elite' ? 'elite' : 'free'
      const estimatedTokens =
        messages.reduce((sum, m) => sum + estimateTokens(m.content), 0) +
        estimateTokens(systemPrompt) + maxTokens
      return scheduleMistralCall(
        () => streamOpenAICompatible(mistral, MISTRAL_MODEL, systemPrompt, messages, maxTokens, 'streamMistral'),
        { priority, estimatedTokens, label: 'streamMistral' },
      )
    }
    case 'openai-fast':
      // No admission-control queue here (unlike mistral-cloud above) — GPT-5
      // mini's per-account RPS/TPM ceiling is far above this app's real call
      // volume even at Tier 1, so proactive gating isn't needed; withRetry's
      // reactive 429 handling (shared by all OpenAI-compatible targets) is
      // sufficient. Re-evaluate if real usage says otherwise.
      return streamOpenAICompatible(openaiFast, OPENAI_FAST_MODEL, systemPrompt, messages, maxTokens, 'streamOpenAIFast')
    case 'gemini-fast':
      // Same reasoning as openai-fast above — no admission-control queue.
      return streamOpenAICompatible(gemini, GEMINI_FAST_MODEL, systemPrompt, messages, maxTokens, 'streamGeminiFast')
    case 'deepseek-fast':
      // Same no-queue reasoning as openai-fast/gemini-fast above. Thinking
      // hardcoded 'disabled' — see createCompletion's 'deepseek-fast' case
      // and the file doc comment for why this doesn't read DEEPSEEK_THINKING.
      return streamOpenAICompatible(deepseek, DEEPSEEK_MODEL, systemPrompt, messages, maxTokens, 'streamDeepSeekFast', 'disabled')
    case 'anthropic-elite':
      return streamAnthropic(systemPrompt, messages, maxTokens, ELITE_PREMIUM_MODEL, 'streamAnthropic/elite')
    case 'qwen-selfhosted':
      return streamOpenAICompatible(
        getPrivateClient(target.endpoint),
        target.role === 'premium' ? target.endpoint.premiumModel : target.endpoint.fastModel,
        systemPrompt, messages, maxTokens, 'streamQwenSelfHosted',
      )
    case 'mistral-selfhosted':
      return streamOpenAICompatible(
        getPrivateClient(target.endpoint),
        target.role === 'premium' ? target.endpoint.premiumModel : target.endpoint.fastModel,
        systemPrompt, messages, maxTokens, 'streamMistralSelfHosted',
      )
  }
}

async function streamAnthropic(
  systemPrompt: string,
  messages:     { role: 'user' | 'assistant'; content: string }[],
  maxTokens:    number = 1200,
  model:        string = ANTHROPIC_MODEL,
  label:        string = 'streamAnthropic',
): Promise<StreamResult> {
  // Bug fix (Aug 2026): this call had no retry protection at all, unlike
  // streamOpenAICompatible below — every DeepSeek/Mistral call (the 6 initial
  // personas) transparently absorbs a transient 502/503/504/connection-reset
  // via withRetry. The Anthropic call (synthesis — also the single longest,
  // heaviest call in the app: 3200 max_tokens plus the deepest system prompt,
  // more exposed to hitting a transient condition purely by running longer)
  // had none, and simply wrapping the initial anthropic.messages.stream(...)
  // call in withRetry (as a first pass at this fix did) doesn't actually
  // help: .stream() returns a MessageStream synchronously and never throws
  // for request-level errors — those only surface later, when consuming it
  // as an async iterator (see MessageStream's _run(), which routes failures
  // through an 'error' event rather than rejecting the call that created
  // it). So the real point of failure is the `for await` below, and that's
  // where retry needs to live. Symptom before this fix: synthesis fails
  // with a clean 500 right as it fires (i.e. exactly when persona traffic —
  // and therefore load on both this server and Anthropic's API — is
  // highest), but a reload succeeds because it's a fresh, isolated attempt
  // made once the transient condition (e.g. a 529 overloaded_error spike)
  // has usually cleared.
  //
  // Retry is only safe/attempted while fullContent is still '' — i.e.
  // nothing has been enqueued to the client yet. Once real text has started
  // streaming, restarting with a brand-new .stream() call would duplicate
  // or garble what's already rendered client-side, so a failure past that
  // point still fails outright (same as before this fix).
  const encoder = new TextEncoder()
  let fullContent = ''
  let stopReason: string | null = null
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
        try {
          const stream = anthropic.messages.stream({
            model,
            max_tokens: maxTokens,
            system:     systemPrompt,
            messages:   messages as Anthropic.MessageParam[],
          })
          for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              fullContent += event.delta.text
              controller.enqueue(encoder.encode(event.delta.text))
            }
            // 'max_tokens' here means the run was cut off mid-output — as opposed
            // to 'end_turn', which means the model stopped on its own. See the
            // getStopReason doc comment on StreamResult above for why this is
            // captured at all.
            if (event.type === 'message_delta' && event.delta.stop_reason) {
              stopReason = event.delta.stop_reason
            }
          }
          controller.close()
          return
        } catch (err) {
          const rateLimited = isRateLimitError(err)
          const canRetry = fullContent === '' && (rateLimited || isTransientError(err)) && attempt < MAX_TRANSIENT_RETRIES
          if (canRetry) {
            const wait = rateLimited ? (getRetryAfterMs(err) ?? RATE_LIMIT_WAIT_MS) : RETRY_WAIT_MS
            console.warn(`[AIClient] ${rateLimited ? 'rate limited (429)' : 'transient error'} on ${label} (retrying in ${wait}ms, attempt ${attempt + 1}/${MAX_TRANSIENT_RETRIES})`)
            await new Promise(r => setTimeout(r, wait))
            continue
          }
          controller.error(err)
          return
        }
      }
    },
  })
  return { readable, getContent: () => fullContent, getStopReason: () => stopReason }
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
    case 'mistral-cloud': {
      // Shared-account admission control (lib/mistral-limiter.ts) — see that
      // file's doc comment for why this is needed and why it's scoped to
      // exactly this branch (mistral-selfhosted/deepseek/anthropic are all
      // separate accounts/providers and must not share this queue).
      const priority = result.tierInfo?.tier === 'elite' ? 'elite' : 'free'
      const estimatedTokens = estimateTokens(prompt) + estimateTokens(systemPrompt) + maxTokens
      return scheduleMistralCall(
        () => completeOpenAICompatible(mistral, MISTRAL_MODEL, prompt, maxTokens, 'createCompletion/mistral', systemPrompt, temperature),
        { priority, estimatedTokens, label: 'createCompletion/mistral' },
      )
    }
    case 'openai-fast':
      return completeOpenAICompatible(openaiFast, OPENAI_FAST_MODEL, prompt, maxTokens, 'createCompletion/openai-fast', systemPrompt, temperature)
    case 'gemini-fast':
      return completeOpenAICompatible(gemini, GEMINI_FAST_MODEL, prompt, maxTokens, 'createCompletion/gemini-fast', systemPrompt, temperature)
    case 'deepseek-fast':
      // Thinking hardcoded 'disabled' — see file doc comment. Deliberately
      // NOT the DEEPSEEK_THINKING env var: that var governs the legacy
      // hybrid path and must stay free to be flipped for that path's own
      // testing without silently slowing down this fast role too.
      return completeOpenAICompatible(deepseek, DEEPSEEK_MODEL, prompt, maxTokens, 'createCompletion/deepseek-fast', systemPrompt, temperature, 'disabled')
    case 'qwen-selfhosted':
      return completeOpenAICompatible(
        getPrivateClient(target.endpoint),
        target.role === 'premium' ? target.endpoint.premiumModel : target.endpoint.fastModel,
        prompt, maxTokens, 'createCompletion/qwen-selfhosted', systemPrompt, temperature,
      )
    case 'mistral-selfhosted':
      return completeOpenAICompatible(
        getPrivateClient(target.endpoint),
        target.role === 'premium' ? target.endpoint.premiumModel : target.endpoint.fastModel,
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

// ── Web-search-enabled completion (PR2 — local/regulatory/market context) ──────
//
// Deliberately separate from createCompletion()/resolveProvider() above: this
// is the ONE call site in the app that needs live tool use (web_search), and
// only the Anthropic Messages API branch supports it here. Bypassing the
// provider-routing abstraction is intentional — tiered/hybrid routing exists
// to pick a cost/quality tradeoff between text-completion providers, and none
// of the DeepSeek/Mistral/Gemini/self-hosted branches have a web_search tool
// to route to regardless of tier.
//
// Fail-open by design, same convention as lib/examiner-resolvability-check.ts:
// this enriches a decision with sourced context, it never gates anything —
// an infra failure here should degrade to "no external context available",
// never block or delay the Council.
export interface WebSearchCitation {
  url:   string
  title: string | null
}

export interface WebSearchCompletionResult {
  text:       string
  citations:  WebSearchCitation[]
  usedSearch: boolean   // false if the model answered without ever calling the tool
                         // (e.g. it judged no search was needed) — surfaced so callers
                         // can distinguish "looked, found nothing worth citing" from
                         // "didn't look at all"
}

export async function createWebSearchCompletion(
  prompt: string,
  maxTokens = 1000,
  options: { systemPrompt?: string; maxUses?: number } = {},
): Promise<WebSearchCompletionResult> {
  const { systemPrompt, maxUses = 3 } = options
  try {
    // Type assertions below: the installed @anthropic-ai/sdk (0.39.0) predates
    // this SDK's TypeScript definitions for the web_search_20250305 server
    // tool — both the request-side `tools` entry shape and the response-side
    // `server_tool_use` content block are valid, documented parts of the
    // Messages API today, just not yet reflected in this package version's
    // .d.ts files. The raw HTTP API accepts/returns them regardless of SDK
    // type coverage. Follow-up: this whole cast can be deleted once
    // @anthropic-ai/sdk is bumped past the version that adds native types
    // for this tool (check the SDK's CHANGELOG for "web_search").
    const res = await anthropic.messages.create({
      model:      ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: 'user', content: prompt }],
      tools: [{
        type:     'web_search_20250305',
        name:     'web_search',
        max_uses: maxUses,
      }] as unknown as Anthropic.Messages.Tool[],
    })

    const textParts: string[] = []
    const citations: WebSearchCitation[] = []
    let usedSearch = false

    for (const block of res.content as Array<{ type: string; text?: string; name?: string; citations?: Array<{ url?: string; title?: string }> }>) {
      if (block.type === 'text' && typeof block.text === 'string') {
        textParts.push(block.text)
        // Citations attach to text blocks when the model's claim is grounded
        // in a specific search result — see Anthropic web_search docs.
        if (Array.isArray(block.citations)) {
          for (const c of block.citations) {
            if (c.url) citations.push({ url: c.url, title: c.title ?? null })
          }
        }
      }
      if (block.type === 'server_tool_use' && block.name === 'web_search') {
        usedSearch = true
      }
    }

    return { text: textParts.join('\n').trim(), citations, usedSearch }
  } catch (err) {
    console.error('[AIClient] createWebSearchCompletion failed — degrading to no external context:', err)
    return { text: '', citations: [], usedSearch: false }
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
    fastModelProviderFree:  FAST_MODEL_PROVIDER_FREE,
    fastModelProviderElite: FAST_MODEL_PROVIDER_ELITE,
    openaiFastModel:      OPENAI_FAST_MODEL,
    geminiFastModel:      GEMINI_FAST_MODEL,
  }
}
