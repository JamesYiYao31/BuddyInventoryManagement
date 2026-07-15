import { supabase } from "@/lib/supabase"

export type SetUserRoleResult =
  | { ok: true; oldRole: string; newRole: string }
  | { ok: false; errorCode: string }

/**
 * Calls POST /api/users/set-role with the viewer's bearer token.
 * Shared by all four member-list surfaces (dashboard Team Management,
 * /org-admin, /super-admin lab and org detail pages).
 */
export async function setUserRole(
  targetUserId: string,
  newRole: "manager" | "technician",
): Promise<SetUserRoleResult> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session?.access_token) return { ok: false, errorCode: "not_authenticated" }

    const response = await fetch("/api/users/set-role", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ targetUserId, newRole }),
    })

    const data = (await response.json().catch(() => ({}))) as {
      error_code?: string
      oldRole?: string
      newRole?: string
    }

    if (!response.ok) {
      return {
        ok: false,
        errorCode: typeof data.error_code === "string" ? data.error_code : "request_failed",
      }
    }

    return {
      ok: true,
      oldRole: typeof data.oldRole === "string" ? data.oldRole : "",
      newRole: typeof data.newRole === "string" ? data.newRole : newRole,
    }
  } catch {
    return { ok: false, errorCode: "request_failed" }
  }
}

/** Human copy for route error_codes, shared so all surfaces stay consistent. */
export function setUserRoleErrorMessage(errorCode: string): string {
  switch (errorCode) {
    case "last_manager":
      return "Last active manager — demoting them leaves the lab without an admin."
    case "forbidden":
      return "You don't have permission to do this."
    case "already_in_state":
      return "User already has the requested role."
    case "super_admin_target":
      return "This account's role cannot be changed."
    case "invalid_role":
      return "Invalid role."
    default:
      return "Could not update role."
  }
}
