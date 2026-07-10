import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"
import { NextRequest, NextResponse } from "next/server"
import { authenticateBearerRequest, createAdminClient } from "@/lib/mfa-api-auth"
import { appendSecurityLogDetails, logSecurityEvent, resolveSecurityLogIdentity } from "@/lib/log-security-event-server"

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(60, "1 h"),
  analytics: true,
})

const ALLOWED_EVENT_TYPES = new Set(["login", "logout"])
const ALLOWED_OUTCOMES = new Set(["success", "failure"])

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

    const { user, accessToken } = auth
    const admin = createAdminClient()

    let body: { eventType?: string; outcome?: string; details?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
    }

    const eventType = typeof body.eventType === "string" ? body.eventType.trim() : ""
    const outcome = typeof body.outcome === "string" ? body.outcome.trim() : ""
    const rawDetails = typeof body.details === "string" ? body.details.trim() : ""

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

    const { detailsSuffix, ...identity } = await resolveSecurityLogIdentity(admin, user, accessToken)
    const detailsCap = detailsSuffix ? 500 - detailsSuffix.length : 500
    const details = rawDetails ? rawDetails.slice(0, detailsCap) : null

    await logSecurityEvent(admin, {
      ...identity,
      eventType,
      outcome,
      details: appendSecurityLogDetails(details, detailsSuffix),
      ipAddress: ip,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Security log route failed:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
