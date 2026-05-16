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

export interface Session {
  id: string
  user_id?: string
  created_at: string
  decision_text: string
  context_text?: string
  status: 'active' | 'completed'
  register_mode?: RegisterMode
}

export interface DecisionRecord {
  session: Session
  messages: Message[]
}

// ── Mirror Module Types (Sprint 7a) ───────────────────────────────────────────

export type MirrorGateState = 'auth' | 'threshold' | 'paywall' | 'unlocked'

export interface MirrorStatus {
  authenticated: boolean
  sessionCount: number
  hasAccess: boolean
  threshold: number         // always 5
  meetsThreshold: boolean   // sessionCount >= threshold
  gateState: MirrorGateState
  teaserBiases: string[]    // bias_parameter keys for paywall teaser tiles
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

// ── Mirror Fingerprint (Sprint 7b) ────────────────────────────────────────────

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
}

export interface FingerprintData {
  narrative: string | null         // null if < 2 confirmed patterns
  confirmedTiles: FingerprintTile[] // detection_count >= 2
  formingTiles: FingerprintTile[]   // detection_count === 1 (teasers in unlocked view)
  sessionCount: number
  generatedAt: string
}

// ── Pattern Store (Sprint 17 / 18b) ──────────────────────────────────────────

export type RuleType = 'REDIRECT' | 'GATE' | 'FLAG'

export interface RulePattern {
  rule_id:     string
  label:       string
  description: string
  type:        RuleType
  fire_count:  number
  pct:         number   // fraction of sessions_with_rules — e.g. 0.67
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
