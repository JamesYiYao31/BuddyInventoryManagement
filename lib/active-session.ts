import type { AuthError } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"

/** Client-only session token for single-active-session enforcement (not sent via cookies). */
export const BUDDY_SESSION_TOKEN_KEY = "buddy_session_token"

export type ActiveSessionVerifyResult = "ok" | "replaced"

/**
 * After successful password login: upsert DB row (one per user) and store token in localStorage.
 * Login flow should continue even if persistence fails (user may be polled out on next tick).
 */
export async function persistNewActiveSession(userId: string): Promise<void> {
  const token = crypto.randomUUID()
  const { error } = await supabase.from("active_sessions").upsert(
    {
      user_id: userId,
      session_token: token,
      created_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  )
  if (error) return
  if (typeof window !== "undefined") {
    localStorage.setItem(BUDDY_SESSION_TOKEN_KEY, token)
  }
}

/**
 * Compare localStorage token to DB. No row or mismatch means another login replaced this session.
 */
export async function verifyActiveSessionForUser(userId: string): Promise<ActiveSessionVerifyResult> {
  const stored =
    typeof window !== "undefined" ? localStorage.getItem(BUDDY_SESSION_TOKEN_KEY) : null
  const { data, error } = await supabase
    .from("active_sessions")
    .select("session_token")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) return "ok"
  const dbToken = data?.session_token
  if (dbToken == null || dbToken === "") return "replaced"
  if (stored !== dbToken) return "replaced"
  return "ok"
}

/**
 * User-initiated or server-valid sign-out: remove DB row and token, then sign out.
 * Pass `userId` when the caller already has it so DELETE runs immediately while the session is still valid.
 */
export async function voluntarySignOut(userId?: string): Promise<{ error: AuthError | null }> {
  if (userId) {
    await supabase.from("active_sessions").delete().eq("user_id", userId)
  }

  if (typeof window !== "undefined") {
    localStorage.removeItem(BUDDY_SESSION_TOKEN_KEY)
  }

  const { error } = await supabase.auth.signOut()
  return { error }
}

/**
 * Another device logged in: do not delete active_sessions (new session owns the row).
 */
export async function sessionReplacedSignOut(router: { replace: (path: string) => void }): Promise<void> {
  if (typeof window !== "undefined") {
    localStorage.removeItem(BUDDY_SESSION_TOKEN_KEY)
  }
  await supabase.auth.signOut()
  router.replace("/login?reason=session_replaced")
}
