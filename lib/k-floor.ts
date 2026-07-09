// lib/k-floor.ts
// Institutional Sprint 4 (task 1) — the privacy floor for aggregate views.
//
// Why 20, not the bare k=5 minimum: per plan Section 1.1, the research
// reviewed (Sweeney; Machanavajjhala et al. on homogeneity/background-
// knowledge attacks; de Montjoye et al. on behavioral-data uniqueness; a
// June 2026 Frontiers in Digital Health paper on k-anonymity decay in
// multi-turn conversational disclosure) establishes that rich, free-text,
// multi-dimensional behavioral data — exactly Quorum's shape — degrades k
// far faster than simple demographic data. Bare k=5 is the wrong number for
// this data shape; 20 is the low end of the recommended 20–25 band.
//
// This is a floor, not a target — most segments won't clear it for most
// institutions most of the time, and that's the honest, expected state
// (see Section 1.8's "not enough participants yet" UI treatment, Sprint 5).
//
// Mirrored in SQL: supabase/institutional_sprint4_aggregate_views.sql
// defines k_floor_default() returning the same value, so the DB-level
// enforcement (the actual privacy gate — HAVING count(distinct user_id) >=
// K_FLOOR in the view itself) and this app-level constant can't silently
// drift apart. If you change this number, change that function too, in the
// same commit.
export const K_FLOOR = 20

// Per-institution override: institutions.k_floor_override (nullable int).
// Only ever used to raise the floor for an institution with strong
// justification (e.g. an institution operating in a jurisdiction with a
// stricter standard) — lowering it below K_FLOOR defeats the point of
// having a floor and isn't a supported use of this column. Document why,
// per institution, in institutions table comments or an ops note — never
// set it silently.
export function effectiveKFloor(kFloorOverride: number | null | undefined): number {
  return typeof kFloorOverride === 'number' && kFloorOverride > 0 ? kFloorOverride : K_FLOOR
}
