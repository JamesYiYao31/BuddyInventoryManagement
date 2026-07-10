import { supabase } from "@/lib/supabase"

export async function recordSecurityEvent(
  eventType: "login" | "logout",
  outcome: "success",
  details?: string,
): Promise<void> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session?.access_token) return

    await fetch("/api/security-log", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ eventType, outcome, details }),
    })
  } catch (err) {
    console.error("[recordSecurityEvent] Failed:", err)
  }
}
