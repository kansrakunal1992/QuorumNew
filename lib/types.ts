export type PersonaKey =
  | 'contrarian'
  | 'risk_architect'
  | 'pattern_analyst'
  | 'stakeholder_mirror'
  | 'elder'
  | 'competitor'
  | 'synthesis'
  | 'decision_brief'

export interface PersonaMeta {
  key: PersonaKey
  label: string
  tagline: string
  prompt: string
}

export interface Message {
  id?: string
  session_id?: string
  created_at?: string
  persona: PersonaKey
  role: 'assistant' | 'user'
  content: string
}

export type RegisterMode = 'analytical' | 'clarification'

// ── SB-1: Framing intent ───────────────────────────────────────────────────────
// Three-way intent captured at session start.
// Maps to register_mode: 'clarify' → 'clarification', 'challenge'|'right' → 'analytical'.
// The more nuanced signal (vs. binary register_mode) is injected into council context in SB-3.
export type FramingIntent = 'challenge' | 'clarify' | 'right'

// ── SB-1: User profile ─────────────────────────────────────────────────────────
// Archetype values (self-selected, one of 6)
export type Archetype =
  | 'builder'      // Creating something that doesn't exist yet
  | 'steward'      // Protecting and growing what I've been trusted with
  | 'achiever'     // Optimising for outcomes and keeping score
  | 'connector'    // Decisions through relationships and what they signal
  | 'protector'    // Guard against loss before pursuing gain
  | 'challenger'   // Tests assumptions and questions default paths

// Fear values (multi-select up to 2)
export type PrimaryFear =
  | 'wrong'        // Fear of getting it wrong
  | 'judgment'     // Fear of what others will think
  | 'loss'         // Fear of losing what I've built
  | 'missed'       // Fear of missing the better path
  | 'safe'         // Fear of being the person who played it too safe
  | 'irreversible' // Fear of the irreversible mistake

export type LifeStage   = 'building' | 'scaling' | 'transition' | 'legacy'
export type RiskStance  = 'conservative' | 'balanced' | 'bold'

export interface UserProfile {
  id:            string
  user_id:       string
  archetype?:    Archetype | null
  primary_fears?: PrimaryFear[] | null
  mbti_type?:    string | null
  life_stage?:   LifeStage | null
  risk_stance?:  RiskStance | null
  created_at:    string
  updated_at:    string
}

// ── SB-1: Validation state ─────────────────────────────────────────────────────
export type ValidationState = 'pending' | 'confirmed' | 'corrected'

export interface Session {
  id: string
  user_id?: string
  created_at: string
  decision_text: string
  context_text?: string
  status: 'active' | 'completed'
  register_mode?: RegisterMode
  decision_type_primary?: string | null
  stakes_reversibility?: string | null
  // ── Sprint Chunk 1: commitment capture + rule recall ─────────────────────
  // commitment_leaning:      "Where are you leaning + first move?" (clubbed)
  // commitment_switch:       "What would change your course?" (clubbed)
  // commitment_review_date:  ISO date string (YYYY-MM-DD) — primary retention hook
  // commitment_captured_at:  ISO timestamp — null means not yet captured
  // rule_recall_choice:      user action when a rule was surfaced mid-session
  // rule_recall_rule_text:   the rule text that was surfaced
  commitment_leaning?:      string | null
  commitment_switch?:       string | null
  commitment_review_date?:  string | null
  commitment_captured_at?:  string | null
  rule_recall_choice?:      'applied' | 'exception' | 'ignored' | null
  rule_recall_rule_text?:   string | null
  // ── RET-5 Sprint 1: linked revisit ────────────────────────────────────────
  // Set when this session originated from a "Reanalyze" on another session.
  // Resolved server-side in /api/session POST and validated against the
  // requester's identity — never trust this field if it appears client-side.
  parent_session_id?:       string | null
  // ── Identity chain ─────────────────────────────────────────────────────────
  user_email?:              string | null
  device_id?:               string | null
  // ── SB-1: Framing intent + validation ──────────────────────────────────────
  framing_intent?:               FramingIntent | null
  validation_state?:             ValidationState
  validation_emotion_confirmed?: boolean | null
  validation_correction?:        string | null
  // S2-05: prior session correction carried into this session at creation time
  // so council context can inject it at persona-call time (before current-session validation runs)
  validation_correction_carry?:  string | null
  // S2-01: post-synthesis confidence re-rate (1–10 tap widget in SynthesisCard)
  post_decision_confidence?:     number | null
  // O3: cached Decision-Maker Observation line, Mirror subscribers only
  decision_observation?:         string | null
}

export interface DecisionRecord {
  session: Session
  messages: Message[]
}

// ── Mirror Module Types (Sprint 7a, updated Sprint 19) ────────────────────────

// Gate states:
//   auth    → not authenticated
//   locked  → authenticated, < 3 sessions, no access row
//   teaser  → ≥ 3 sessions, no valid subscription (shows teaser UI)
//   unlocked → valid subscription (advisory always; annual/monthly if not expired)
export type MirrorGateState = 'auth' | 'locked' | 'teaser' | 'unlocked'

// Internal access-check result (used by getMirrorAccessState helper)
export type MirrorAccessState = 'unlocked' | 'teaser' | 'locked'

// Sprint 21: Style calibration — which advisor lens the user responds to most
export type StyleCue = 'direct' | 'challenge' | 'pattern' | 'risk' | 'stakeholder' | 'long'

// Subscription plan types
// 'lifetime' retired (Phase 2, repricing sprint) — no longer offered or grantable.
// getMirrorAccessState() retains a defensive check for any legacy 'lifetime' rows.
export type SubscriptionPlan = 'monthly' | 'annual' | 'advisory'

// ── Mirror tier (Phase 4) ─────────────────────────────────────────────────────
// 'mirror'   → self-serve Mirror subscription (₹3,999/mo · ₹39,999/yr)
// 'advisory' → founder-led Mirror Advisory (access_type === 'advisory', capped cohort)
// Only meaningful when gateState === 'unlocked'; locked/teaser users are 'mirror'.
export type MirrorTier = 'mirror' | 'advisory'

export interface MirrorStatus {
  authenticated: boolean
  sessionCount: number
  hasAccess: boolean
  gateState: MirrorGateState
  teaserBiases: string[]    // bias_parameter keys shown in teaser state
  tier: MirrorTier           // Phase 4 — drives Advisory-only module gating
}

export interface TimelineSession {
  id: string
  decision_text: string
  created_at: string
  register_mode: string | null
  decision_type_primary: string | null
  stakes_reversibility: string | null
  dominant_emotion: string | null
  tagger_status: string | null
  has_outcome: boolean
}

// ── Independence Score (Sprint 7c) ────────────────────────────────────────────

export interface IndependenceScoreEntry {
  score: number
  delta: number | null
  calculated_at: string
  signals: Record<string, number> | null
}

// ── Bias Signal Classification (Sprint 20) ───────────────────────────────────
//
// Contextual read on whether a detected bias is working for or against the
// decision-maker in the specific structural context of a given decision.
// Stored per-session inside activation_contexts JSONB — no new DB column needed.
// Predominant signal across all sessions is surfaced on the fingerprint tile.
export type BiasSignalType = 'distorting' | 'neutral' | 'adaptive'

// ── Mirror Fingerprint (Sprint 7b, updated Sprint 20) ────────────────────────

export interface FingerprintTile {
  biasKey: string
  biasLabel: string
  detectionCount: number
  confidenceWeight: number        // 0–1 accumulated
  confidenceDots: 1 | 2 | 3      // 1=forming, 2=confirmed, 3=conditional
  asymmetryAvg: number
  activationSummary: string | null // "Activates when: X + Y" — derived from contexts
  interpretation: string           // AI-generated, 25–35 words
  isTeaser: boolean                // detection_count === 1 (blurred in paid view)
  signalType: BiasSignalType | null   // Sprint 20: predominant signal across sessions
  sessionIds: string[]                // Sprint 20: source sessions for drawer
  lastFiredAt: string | null          // Sprint M4: most recent session date — drives "Active" badge
}

export interface FingerprintData {
  narrative: string | null         // null if < 2 confirmed patterns
  confirmedTiles: FingerprintTile[] // detection_count >= 2
  formingTiles: FingerprintTile[]   // detection_count === 1 (teasers in unlocked view)
  sessionCount: number
  generatedAt: string
  personalBiasTriggers: import('@/lib/bias-trigger-engine').PersonalBiasTrigger[]  // Sprint BT
}

// ── Session preview (Sprint 20: source-decision drawer) ──────────────────────

export interface SessionPreview {
  id: string
  decision_preview: string   // first 90 chars of decision_text
  created_at: string
}

// ── Pattern Store (Sprint 17 / 18b, updated Sprint 20) ───────────────────────

export type RuleType = 'REDIRECT' | 'GATE' | 'FLAG'

export interface RulePattern {
  rule_id:            string
  label:              string
  description:        string
  type:               RuleType
  fire_count:         number
  pct:                number       // fraction of sessions_with_rules — e.g. 0.67
  session_ids:        string[]     // Sprint 20: sessions that fired this rule
  recent_fire_count?: number       // Sprint M4: fires in last 10 sessions — drives ↑ increasing badge
}

export interface DimPattern {
  dim:        string
  label:      string
  avg_score:  number   // 1–5 scale
  high_count: number   // sessions where score >= 4
}

export interface PatternStoreData {
  threshold_met:         boolean
  session_count:         number
  sessions_with_rules:   number
  sessions_with_vectors: number
  patterns:              RulePattern[]
  top_dimensions:        DimPattern[]
}

// ── Benchmark (Sprint 20) ─────────────────────────────────────────────────────

export interface BenchmarkDimension {
  dim:       string
  label:     string
  avg_score: number
}

export interface BenchmarkData {
  insufficient:    boolean
  cluster_size:    number
  top_dimensions:  BenchmarkDimension[]
  top_biases:      string[]   // bias_parameter keys most common in cluster
}

// ── Session Reliability Index (R4) ────────────────────────────────────────────
//
// Per-session unified score computed from 4 data streams.
// Returned by GET /api/mirror/session-score as SessionScoreData[].
//
// Sub-scores (each 0–100):
//   structural        — maxStructuralScore from matches_json. 50 = no history yet (neutral)
//   biasClarity       — inverse of distorting bias presence × asymmetry. 80 = no signals
//   councilConfidence — deterministic from rule_engine_result mode + flag count
//   calibration       — derived from outcomes.calibration_delta. 70 = outcome pending
//
// score (composite) = structural × 0.25 + biasClarity × 0.30 + councilConfidence × 0.20 + calibration × 0.25
//
// actionPlan is a single global action derived from the user's weakest average
// sub-score across all sessions. Same value on every row — UI reads from [0].

export interface SessionScoreData {
  sessionId:            string
  decisionPreview:      string      // first 90 chars of decision_text
  createdAt:            string      // ISO timestamp
  score:                number      // composite 0–100
  structural:           number      // sub-score: structural match quality
  biasClarity:          number      // sub-score: absence of distorting signals
  councilConfidence:    number      // sub-score: structural clarity for analysis
  calibration:          number      // sub-score: confidence calibration quality
  calibrationPending:   boolean     // true if no outcome logged yet for this session
  distortingBiasLabels: string[]    // labels of biases flagged as distorting this session
  actionPlan:           string      // global: what to improve next — always present
}
