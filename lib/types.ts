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

export interface Session {
  id: string
  user_id?: string
  created_at: string
  decision_text: string
  context_text?: string
  status: 'active' | 'completed'
}

export interface DecisionRecord {
  session: Session
  messages: Message[]
}
