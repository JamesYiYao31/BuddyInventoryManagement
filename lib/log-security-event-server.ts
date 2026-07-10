import type { SupabaseClient, User } from "@supabase/supabase-js"
import { decodeJwtPayload } from "@/lib/mfa-api-auth"
import { initialsFromDisplayName } from "@/lib/user-initials"

const ALLOWED_ROLES = new Set(["super_admin", "org_admin", "manager", "technician"])

/** Lowest-privilege whitelist value when profile + JWT both lack a valid role. */
const ROLE_FALLBACK = "technician"

export const ROLE_UNVERIFIED_DETAILS_SUFFIX = " [role unverified — attribution fallback]"

export function appendSecurityLogDetails(
  details: string | null | undefined,
  detailsSuffix: string,
): string | null {
  if (!detailsSuffix) return details ?? null
  const merged = `${details ?? ""}${detailsSuffix}`
  return merged.trim() || null
}

export async function resolveSecurityLogIdentity(
  admin: SupabaseClient,
  user: Pick<User, "id" | "email">,
  accessToken?: string | null,
): Promise<{
  userId: string
  userName: string
  userInitials: string
  userRole: string
  labId: string | null
  detailsSuffix: string
}> {
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name, role, lab_id")
    .eq("id", user.id)
    .maybeSingle()

  let userName = profile?.full_name?.trim() ?? ""
  if (!userName) {
    const email = user.email ?? ""
    userName = email ? email.split("@")[0] : "Unknown User"
  }

  let userRole: string | null = null
  let roleUnverified = false
  if (profile?.role && ALLOWED_ROLES.has(profile.role)) {
    userRole = profile.role
  } else if (accessToken) {
    const payload = decodeJwtPayload(accessToken)
    const jwtRole = typeof payload?.user_role === "string" ? payload.user_role : null
    if (jwtRole && ALLOWED_ROLES.has(jwtRole)) {
      userRole = jwtRole
    }
  }

  if (!userRole) {
    console.error(
      "[resolveSecurityLogIdentity] Could not resolve user_role from profile or JWT; using technician fallback.",
      { userId: user.id },
    )
    userRole = ROLE_FALLBACK
    roleUnverified = true
  }

  return {
    userId: user.id,
    userName,
    userInitials: initialsFromDisplayName(userName),
    userRole,
    labId: profile?.lab_id ?? null,
    detailsSuffix: roleUnverified ? ROLE_UNVERIFIED_DETAILS_SUFFIX : "",
  }
}

export async function logSecurityEvent(
  admin: SupabaseClient,
  event: {
    userId: string | null
    userName: string
    userInitials: string
    userRole: string
    labId: string | null
    eventType: string
    outcome: string
    details?: string | null
    ipAddress?: string | null
  },
): Promise<void> {
  try {
    const { error } = await admin.from("security_logs").insert([
      {
        user_id: event.userId,
        user_name: event.userName,
        user_initials: event.userInitials,
        user_role: event.userRole,
        lab_id: event.labId,
        event_type: event.eventType,
        outcome: event.outcome,
        details: event.details ?? null,
        ip_address: event.ipAddress ?? null,
      },
    ])

    if (error) {
      console.error("[logSecurityEvent] Insert failed:", error.message)
    }
  } catch (err) {
    console.error("[logSecurityEvent] Unexpected error:", err)
  }
}
