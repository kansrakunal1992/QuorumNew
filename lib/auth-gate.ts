// lib/auth-gate.ts
// -- Phase 3 (retention work): the "connect before the next decision" gate ----
// Pure helpers shared by the client (ChatIntake) and the server
// (POST /api/chat-intake) so both always agree on who is gated and when.
//
// OFF BY DEFAULT. Set NEXT_PUBLIC_AUTH_GATE_MODE to turn it on:
//   off         (default) nobody is gated -- shipping this file changes nothing
//   d3          everyone is gated once they have 2 decisions (before the 3rd)
//   d4          everyone is gated once they have 3 decisions (before the 4th)
//   experiment  each device is deterministically assigned one arm:
//                 gate_d3 | gate_d4 | soft_only (never gated)
//               so "does authenticated status improve D3/D4 reach" can be
//               measured with a real control instead of a selection-biased
//               authenticated-vs-anonymous comparison.
//
// Arm assignment hashes the device id (server + client agree). People without a
// device id (no functional-cookie consent) are NOT assigned an arm and are never
// gated: we do not mint a tracking key without consent just to run an experiment.
// Clearing storage also resets the device id -- an accepted leak.

export type GateMode = 'off' | 'd3' | 'd4' | 'experiment'
export type GateArm  = 'gate_d3' | 'gate_d4' | 'soft_only'

/** Decisions a person must already have before the gate applies, per arm. */
export const GATE_AFTER: Record<GateArm, number | null> = {
  gate_d3:   2,
  gate_d4:   3,
  soft_only: null,
}

export function getGateMode(): GateMode {
  const v = (process.env.NEXT_PUBLIC_AUTH_GATE_MODE ?? 'off').toLowerCase()
  return v === 'd3' || v === 'd4' || v === 'experiment' ? v : 'off'
}

function fnv(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

export function armForKey(key: string): GateArm {
  const arms: GateArm[] = ['gate_d3', 'gate_d4', 'soft_only']
  return arms[fnv(`quorum-gate-v1:${key}`) % arms.length]
}

export function resolveArm(mode: GateMode, key: string | null | undefined): GateArm | null {
  if (mode === 'off') return null
  if (mode === 'd3') return 'gate_d3'
  if (mode === 'd4') return 'gate_d4'
  return key ? armForKey(key) : null
}

export function isGated(decisionCount: number, arm: GateArm | null): boolean {
  if (!arm) return false
  const after = GATE_AFTER[arm]
  return after !== null && decisionCount >= after
}
