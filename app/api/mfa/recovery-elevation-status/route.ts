import { NextRequest, NextResponse } from "next/server"
import { authenticateBearerRequest, createAdminClient } from "@/lib/mfa-api-auth"

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateBearerRequest(request.headers.get("Authorization"))
    if (!auth.ok) return auth.response

    const { user, sessionId } = auth
    if (!sessionId) {
      return NextResponse.json({ elevated: false })
    }

    const admin = createAdminClient()
    const { data, error } = await admin
      .from("mfa_recovery_elevations")
      .select("id")
      .eq("user_id", user.id)
      .eq("session_id", sessionId)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle()

    if (error) {
      console.error("Recovery elevation status check failed:", error.message)
      return NextResponse.json({ elevated: false })
    }

    return NextResponse.json({ elevated: !!data })
  } catch (error) {
    console.error("Recovery elevation status route failed:", error)
    return NextResponse.json({ elevated: false })
  }
}
