import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const isBrowser = typeof window !== 'undefined'

// Bug fix (sign-out not taking effect): every 'use client' call site — 
// AuthPanel, SessionView, mirror/page, settings/security, ReanalyzeDrawer,
// ShareRecordButton, etc. — used to call createClient() fresh, each
// spinning up its own GoTrueClient against the same localStorage key.
// Supabase's own docs call this unsupported ("Multiple GoTrueClient
// instances detected in the same browser context... may lead to unexpected
// behavior"). Nothing in the app ever listened for onAuthStateChange either,
// so each instance's "am I signed in" state was a one-time snapshot from
// its own mount — calling signOut() on one instance had no way to reliably
// reach the others before a client-side route change re-read a stale
// session. One shared instance per browser tab removes the race instead of
// papering over it with a listener on top of N competing clients.
let browserClient: SupabaseClient | null = null

// Browser-safe client (uses anon key). Server-side callers (API routes
// resolving a caller from a Bearer token) get a fresh, non-persisting
// instance per call instead — there's no localStorage to share across
// requests on the server, and no session state that needs to stay in sync,
// so a singleton buys nothing there and skipping persistSession avoids
// Supabase's "no storage available" warning in server logs.
export function createClient() {
  if (!isBrowser) {
    return createSupabaseClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  if (!browserClient) {
    browserClient = createSupabaseClient(supabaseUrl, supabaseAnonKey)
  }
  return browserClient
}

// Server-only client (uses service role — full access, no RLS)
export function createServiceClient() {
  return createSupabaseClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  })
}
