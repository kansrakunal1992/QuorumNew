import { describe, it, expect, vi } from 'vitest'
import { newUserPrefDefaults, weeklyDefaultEnabled } from '../lib/notification-defaults'
import { signOutOfThisDevice, signOutOfAllDevices } from '../lib/sign-out'

describe('new-user weekly default — only a brand-new person is enrolled', () => {
  it('no existing preferences row (first-ever sign-in) ⇒ weekly', () => {
    expect(newUserPrefDefaults(null, {})).toEqual({ brief_cadence: 'weekly' })
    expect(newUserPrefDefaults(undefined, {})).toEqual({ brief_cadence: 'weekly' })
  })
  it('an existing row — even one that never chose a cadence — is never touched (no retro-enrolment)', () => {
    expect(newUserPrefDefaults({ signup_method: 'google' }, {})).toEqual({})
    expect(newUserPrefDefaults({ signup_method: null }, {})).toEqual({})
    expect(newUserPrefDefaults({}, {})).toEqual({})
  })
  it('can be switched off from the environment without a deploy', () => {
    expect(weeklyDefaultEnabled({ DEFAULT_WEEKLY_BRIEF_FOR_NEW_USERS: 'false' })).toBe(false)
    expect(newUserPrefDefaults(null, { DEFAULT_WEEKLY_BRIEF_FOR_NEW_USERS: 'false' })).toEqual({})
  })
  it('on by default; only the exact string "false" turns it off', () => {
    expect(weeklyDefaultEnabled({})).toBe(true)
    expect(weeklyDefaultEnabled({ DEFAULT_WEEKLY_BRIEF_FOR_NEW_USERS: 'true' })).toBe(true)
    expect(weeklyDefaultEnabled({ DEFAULT_WEEKLY_BRIEF_FOR_NEW_USERS: '0' })).toBe(true)
  })
  it('never produces anything but the validated cadence value the cron looks for', () => {
    expect(newUserPrefDefaults(null, {}).brief_cadence).toBe('weekly')
  })
})

describe('sign out — session AND the locally stored email are cleared, in that order', () => {
  it('this device: normal sign-out, then clears the stored email', async () => {
    const calls: string[] = []
    const client = { auth: { signOut: vi.fn(async (o?: unknown) => { calls.push(`signOut:${JSON.stringify(o ?? null)}`); return { error: null } }) } }
    await signOutOfThisDevice({ client, clear: () => calls.push('clear') })
    expect(calls).toEqual(['signOut:null', 'clear'])
  })
  it('all devices: global scope, then clears the stored email', async () => {
    const calls: string[] = []
    const client = { auth: { signOut: vi.fn(async (o?: unknown) => { calls.push(`signOut:${JSON.stringify(o)}`); return { error: null } }) } }
    await signOutOfAllDevices({ client, clear: () => calls.push('clear') })
    expect(calls).toEqual(['signOut:{"scope":"global"}', 'clear'])
  })
  it('a FAILED sign-out throws and does NOT clear the email (no half-signed-out state)', async () => {
    const clear = vi.fn()
    const client = { auth: { signOut: vi.fn(async () => ({ error: { message: 'network down' } })) } }
    await expect(signOutOfThisDevice({ client, clear })).rejects.toThrow('network down')
    expect(clear).not.toHaveBeenCalled()
  })
})
