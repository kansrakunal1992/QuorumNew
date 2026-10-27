// lib/sign-out.ts
//
// One implementation of "sign out", used by the Privacy Center, the Security Center and the delete-account flow.
//
// supabase.auth.signOut() only clears the Supabase session. The app ALSO keeps the person's email in localStorage
// (lib/storage.ts quorum_user_email) and seeds the homepage's "Sessions linked to X" state straight from it, without a
// live session check. Signing out without clearing it leaves the app looking signed-in everywhere while the session is
// gone (the sign-in card stays hidden, the tours skip their sign-in step). The delete-account flow used to do exactly
// that. Every sign-out now clears both.

import { createClient } from '@/lib/supabase'
import { clearUserEmail } from '@/lib/storage'

interface AuthLike { auth: { signOut: (o?: { scope?: 'global' | 'local' | 'others' }) => Promise<{ error: { message: string } | null }> } }

export interface SignOutDeps { client?: AuthLike; clear?: () => void }

async function run(scope: 'global' | undefined, deps: SignOutDeps): Promise<void> {
  const client = deps.client ?? (createClient() as unknown as AuthLike)
  const { error } = await (scope ? client.auth.signOut({ scope }) : client.auth.signOut())
  if (error) throw new Error(error.message || 'Sign out failed')
  // Only after the session is really gone: a failed sign-out must not leave the person half signed-out.
  ;(deps.clear ?? clearUserEmail)()
}

/** This device only. */
export const signOutOfThisDevice = (deps: SignOutDeps = {}) => run(undefined, deps)

/** Every device (invalidates all refresh tokens for the user). */
export const signOutOfAllDevices = (deps: SignOutDeps = {}) => run('global', deps)
