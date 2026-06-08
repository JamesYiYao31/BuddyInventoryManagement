import type { SupabaseClient } from "@supabase/supabase-js"

export type MfaRecoveryActivityAction =
  | "MFA Recovery Code Redeemed"
  | "MFA Recovery Code Redeem Failed"

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "??"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Server-side audit log for MFA recovery events (service role insert). */
export async function logMfaRecoveryActivity(
  admin: SupabaseClient,
  userId: string,
  actionType: MfaRecoveryActivityAction,
  details: string,
): Promise<void> {
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name, lab_id")
    .eq("id", userId)
    .maybeSingle()

  if (!profile?.lab_id) {
    // org_admin / super_admin have no lab_id — activity_logs is lab-scoped.
    return
  }

  let name = profile.full_name?.trim() ?? ""
  if (!name) {
    const { data: authUser } = await admin.auth.admin.getUserById(userId)
    const email = authUser.user?.email ?? ""
    name = email ? email.split("@")[0] : "Unknown user"
  }

  const { error } = await admin.from("activity_logs").insert([
    {
      lab_id: profile.lab_id,
      user_name: name,
      user_initials: initialsFromName(name),
      action_type: actionType,
      item_name: "Account Security",
      lot_number: "",
      details,
    },
  ])

  if (error) {
    console.error("[logMfaRecoveryActivity] Insert failed:", error.message)
  }
}
