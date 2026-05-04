import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'buddylab-auth',
  },
})

/** True when persisted session cannot be refreshed (stale or missing refresh token). */
export function isRefreshTokenAuthFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object' || !('message' in err)) return false
  const message = String((err as { message?: unknown }).message).toLowerCase()
  return message.includes('refresh token') || message.includes('refresh_token')
}

/** Clears local auth storage so the client stops retrying a dead session. */
export async function signOutLocalOnRefreshFailure(err: unknown | null | undefined): Promise<boolean> {
  if (!err || !isRefreshTokenAuthFailure(err)) return false
  if (typeof window !== "undefined") {
    localStorage.removeItem("buddy_session_token")
  }
  await supabase.auth.signOut({ scope: 'local' })
  return true
}

if (typeof window !== 'undefined') {
  void supabase.auth.getSession().then(({ error }) => {
    if (error) void signOutLocalOnRefreshFailure(error)
  })
}