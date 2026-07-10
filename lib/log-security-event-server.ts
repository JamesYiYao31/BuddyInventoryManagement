import type { SupabaseClient } from "@supabase/supabase-js"

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
