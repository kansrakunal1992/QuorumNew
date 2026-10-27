// lib/notification-defaults.ts
//
// What a BRAND-NEW person's notification preferences start as.
//
// Product decision (Oct 2026): the weekly "anything you're weighing?" note is ON by default for new people. It used
// to be strictly opt-in (user_preferences.brief_cadence stayed NULL until someone chose; the cron only mails 'weekly').
//
// Who this touches — deliberately narrow:
//   * ONLY a person whose user_preferences row does not exist yet (their first-ever sign-in; see
//     app/api/auth/link-sessions/route.ts, step 5). Everyone who already has a row — including existing people who never
//     chose a cadence (NULL) — is left exactly as they are. Nobody is retro-enrolled.
//   * It can never overwrite a choice: it only ever applies when there is no row, and the explicit-choice paths
//     (POST /api/preferences/habit, POST /api/preferences/notifications) write later or earlier without conflict.
//   * The weekly cron keeps its own guards (has decided, quiet for 3 days, not mailed in 6 days, one-click unsubscribe).
//
// Rollback without a deploy: set DEFAULT_WEEKLY_BRIEF_FOR_NEW_USERS=false in Railway (server-side, read at runtime).

export const NEW_USER_DEFAULT_CADENCE = 'weekly' as const

export interface NewUserPrefDefaults { brief_cadence?: typeof NEW_USER_DEFAULT_CADENCE }

export function weeklyDefaultEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DEFAULT_WEEKLY_BRIEF_FOR_NEW_USERS !== 'false'
}

/**
 * Columns to include in the first-ever user_preferences upsert.
 * `existingRow` is whatever the "does this person already have a row?" lookup returned: null/undefined = brand new.
 */
export function newUserPrefDefaults(
  existingRow: unknown,
  env: Record<string, string | undefined> = process.env,
): NewUserPrefDefaults {
  if (existingRow) return {}
  if (!weeklyDefaultEnabled(env)) return {}
  return { brief_cadence: NEW_USER_DEFAULT_CADENCE }
}
