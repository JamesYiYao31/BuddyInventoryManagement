import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"
import { NextRequest, NextResponse } from "next/server"
import { authenticateBearerRequest, createAdminClient } from "@/lib/mfa-api-auth"
import { logSecurityEvent } from "@/lib/log-security-event-server"
import { initialsFromDisplayName } from "@/lib/user-initials"

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(60, "1 h"),
  analytics: true,
})

const ALLOWED_EVENT_TYPES = new Set(["login", "logout"])
const ALLOWED_OUTCOMES = new Set(["success", "failure"])
const ALLOWED_ROLES = new Set(["super_admin", "org_admin", "manager", "technician"])

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    null
  const rateLimitKey = ip ?? "anonymous"
  const { success, limit, reset, remaining } = await ratelimit.limit(`security-log:${rateLimitKey}`)

  if (!success) {
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: {
        "X-RateLimit-Limit": limit.toString(),
        "X-RateLimit-Remaining": remaining.toString(),
        "X-RateLimit-Reset": reset.toString(),
        "Content-Type": "application/json",
      },
    })
  }

  try {
    const auth = await authenticateBearerRequest(request.headers.get("Authorization"))
    if (!auth.ok) return auth.response

    const { user } = auth
    const admin = createAdminClient()

    let body: { eventType?: string; outcome?: string; details?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
    }

    const eventType = typeof body.eventType === "string" ? body.eventType.trim() : ""
    const outcome = typeof body.outcome === "string" ? body.outcome.trim() : ""
    const details =
      typeof body.details === "string" ? body.details.trim().slice(0, 500) || null : null

    if (!ALLOWED_EVENT_TYPES.has(eventType)) {
      return NextResponse.json({ error: "Invalid event type." }, { status: 400 })
    }

    if (!ALLOWED_OUTCOMES.has(outcome)) {
      return NextResponse.json({ error: "Invalid outcome." }, { status: 400 })
    }

    // DB constraint: logout and recovery_codes_generated require outcome = success.
    if (eventType === "logout" && outcome !== "success") {
      return NextResponse.json({ error: "Invalid outcome for event type." }, { status: 400 })
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("full_name, role, lab_id")
      .eq("id", user.id)
      .maybeSingle()

    if (!profile?.role || !ALLOWED_ROLES.has(profile.role)) {
      return NextResponse.json({ error: "Could not resolve user profile." }, { status: 400 })
    }

    let userName = profile.full_name?.trim() ?? ""
    if (!userName) {
      const email = user.email ?? ""
      userName = email ? email.split("@")[0] : "Unknown User"
    }

    await logSecurityEvent(admin, {
      userId: user.id,
      userName,
      userInitials: initialsFromDisplayName(userName),
      userRole: profile.role,
      labId: profile.lab_id ?? null,
      eventType,
      outcome,
      details,
      ipAddress: ip,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Security log route failed:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
