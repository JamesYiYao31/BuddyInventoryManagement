import { supabase } from "@/lib/supabase"

export type SetUserActiveResult =
  | { ok: true; action: "deactivated" | "reactivated" }
  | { ok: false; errorCode: string }

/**
 * Calls POST /api/users/set-active with the viewer's bearer token.
 * Shared by all four member-list surfaces (dashboard Team Management,
 * /org-admin, /super-admin lab and org detail pages).
 */
export async function setUserActiveStatus(
  targetUserId: string,
  active: boolean,
): Promise<SetUserActiveResult> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session?.access_token) return { ok: false, errorCode: "not_authenticated" }

    const response = await fetch("/api/users/set-active", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ targetUserId, active }),
    })

    const data = (await response.json().catch(() => ({}))) as {
      error_code?: string
    }

    if (!response.ok) {
      return {
        ok: false,
        errorCode: typeof data.error_code === "string" ? data.error_code : "request_failed",
      }
    }

    return { ok: true, action: active ? "reactivated" : "deactivated" }
  } catch {
    return { ok: false, errorCode: "request_failed" }
  }
}

/** Human copy for route error_codes, shared so all surfaces stay consistent. */
export function setUserActiveErrorMessage(errorCode: string): string {
  switch (errorCode) {
    case "last_admin":
      return "Last active manager — another admin must exist first."
    case "forbidden":
      return "You don't have permission to do this."
    default:
      return "Could not update account status."
  }
}
