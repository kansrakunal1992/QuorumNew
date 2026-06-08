'use client'

// components/MirrorInsightCard.tsx
// ── Sprint M6: Cross-module Mirror Insight ────────────────────────────────────
//
// One synthesised observation per visit derived deterministically from
// cross-module data — the observation no single module can surface on its own.
// Rendered above Bias Fingerprint at the top of the module stack.
// Returns null when data is insufficient (< 5 sessions) or no pattern fires.
//
// Synthesis rules (priority order, first match wins):
//   A. Open loops + score drop        → unresolved decisions clouding judgment
//   B. New contradiction + open loops → likely connected
//   C. REDIRECT mode + high score     → productive block — strong judgment
//   D. GATE mode + contradictions     → own reasoning created the ambiguity
//   E. High independence + open loops → judgment without closure
//   F. Score up + confirmed patterns  → compounding — tracking correlation
//   G. Score up (generic)             → directional positive
// ─────────────────────────────────────────────────────────────────────────────

import type { SummaryData } from './MirrorSummaryCard'

function synthesise(d: SummaryData): string | null {
  const { independenceScore, scoreDelta, openLoopCount, newContradictions,
          latestSessionMode, confirmedPatternCount, sessionCount } = d

  if (sessionCount < 5 || independenceScore === null) return null

  // A. Open loops + score drop
  if (openLoopCount >= 2 && scoreDelta !== null && scoreDelta <= -4) {
    return `Your Independence Score dropped ${Math.abs(scoreDelta)} pts while ${openLoopCount} decisions remain unresolved. Open loops create cognitive load that shows up in reasoning quality — filing an outcome on even one may shift this.`
  }

  // B. New contradiction + open loops — likely linked
  if (newContradictions > 0 && openLoopCount >= 1) {
    return `A contradiction was detected at the same time you have open decisions. These are often connected — a principle you stated in an unresolved decision may conflict with what you chose elsewhere. Worth reviewing together.`
  }

  // C. REDIRECT + high score — productive block
  if (latestSessionMode === 'REDIRECT' && independenceScore >= 65) {
    return `Your latest decision was flagged as not ready to proceed — and your Independence Score is ${independenceScore}. That combination is a healthy signal: you identified the gap before committing. Blocking a premature decision is its own form of clear judgment.`
  }

  // D. GATE + new contradictions — own reasoning created the block
  if (latestSessionMode === 'GATE' && newContradictions > 0) {
    return `Your latest decision hit a structural gate, and a contradiction was also detected. The gate may be your own prior reasoning surfacing — something you said you'd do differently is creating the current ambiguity.`
  }

  // E. High independence + many open loops — judgment without follow-through
  if (independenceScore >= 70 && openLoopCount >= 3) {
    return `Your Independence Score is ${independenceScore}, but you have ${openLoopCount} decisions without outcomes filed. High-quality independent judgment without closure tracking creates a blind spot — Confidence Calibration cannot score what it cannot see.`
  }

  // F. Score rising + patterns confirmed — track the correlation
  if (scoreDelta !== null && scoreDelta >= 5 && confirmedPatternCount >= 2) {
    return `Your Independence Score moved up ${scoreDelta} pts. With ${confirmedPatternCount} confirmed bias patterns active, Quorum is now tracking whether your higher-independence decisions correlate with specific pattern activations — or happen despite them.`
  }

  // G. Score rising, generic directional positive
  if (scoreDelta !== null && scoreDelta > 0 && independenceScore >= 60) {
    return `Your Independence Score continues to strengthen. The most reliable predictor of continued growth: complete Examiner questions in full on every session, especially the parts that feel uncomfortable to answer.`
  }

  return null
}

export default function MirrorInsightCard({ data }: { data: SummaryData | null }) {
  if (!data) return null
  const insight = synthesise(data)
  if (!insight) return null

  return (
    <div style={{
      background:   'rgba(201,168,76,0.03)',
      border:       '1px solid rgba(201,168,76,0.18)',
      borderLeft:   '3px solid rgba(201,168,76,0.5)',
      borderRadius: 10,
      padding:      '14px 16px',
      marginBottom: 28,
      animation:    'secFadeIn 0.4s ease both',
      animationDelay: '20ms',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
        <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--gold)', flexShrink: 0 }} />
        <span style={{
          fontSize: 9, fontWeight: 700, color: 'var(--gold)',
          textTransform: 'uppercase', letterSpacing: '0.1em',
        }}>
          Mirror insight
        </span>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0, lineHeight: 1.65 }}>
        {insight}
      </p>
    </div>
  )
}
