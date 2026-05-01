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
