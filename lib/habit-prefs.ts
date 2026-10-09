// lib/habit-prefs.ts
// -- Phase 2 (retention work): "where will you bring the next one?" -----------
// The if-then cue and the cadence choice from the second-decision ending.
// Held in localStorage until the person links an email, then flushed to
// user_preferences via POST /api/preferences/habit (see /auth/callback), so an
// anonymous choice is never lost to the sign-in round trip.
//
// Only cadence === 'weekly' triggers email (app/api/cron/weekly-brief). The
// other two are real choices that currently mean "no weekly email": they exist
// so the question is honest, not a disguised opt-in.

export const CUES: { id: string; label: string }[] = [
  { id: 'before_buying',    label: 'Before I buy something' },
  { id: 'stalling_message', label: "When I'm stalling on a message" },
  { id: 'sunday_planning',  label: 'Sunday planning' },
  { id: 'when_stuck',       label: "When I notice I'm stuck" },
]

export const CADENCES: { id: string; label: string }[] = [
  { id: 'weekly',     label: 'Weekly' },
  { id: 'when_stuck', label: "Only when I'm stuck" },
  { id: 'big_only',   label: 'Only for big decisions' },
]

export const VALID_CUES     = CUES.map(c => c.id)
export const VALID_CADENCES = CADENCES.map(c => c.id)

export interface HabitPrefs { cue: string | null; cadence: string | null }

const KEY = 'quorum_habit_prefs'

export function readHabitPrefs(): HabitPrefs | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    return {
      cue:     VALID_CUES.includes(p?.cue) ? p.cue : null,
      cadence: VALID_CADENCES.includes(p?.cadence) ? p.cadence : null,
    }
  } catch { return null }
}

export function writeHabitPrefs(p: HabitPrefs): void {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(KEY, JSON.stringify(p)) } catch {}
}

export function clearHabitPrefs(): void {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem(KEY) } catch {}
}
