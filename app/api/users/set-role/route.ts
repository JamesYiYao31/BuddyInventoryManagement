import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"
import { NextRequest, NextResponse } from "next/server"
import { authenticateBearerRequest, createAdminClient } from "@/lib/mfa-api-auth"
import {
  appendSecurityLogDetails,
  logSecurityEvent,
  resolveSecurityLogIdentity,
} from "@/lib/log-security-event-server"

// Prefixed key (set-role:${ip}) mirrors set-active / MFA route convention.
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(20, "1 h"),
  analytics: true,
})

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type RpcSuccess = {
  success: true
  old_role: string
  new_role: string
  target_full_name: string
  target_lab_id: string | null
}

type RpcFailure = {
  success: false
  error_code: string
}

type RpcResult = RpcSuccess | RpcFailure

const FAILURE_STATUS: Record<string, number> = {
  target_not_found: 404,
  actor_not_found: 403,
  actor_inactive: 403,
  forbidden: 403,
  super_admin_target: 403,
  invalid_role: 403,
  last_manager: 409,
  already_in_state: 409,
}

const FAILURE_MESSAGE: Record<string, string> = {
  target_not_found: "User not found.",
  actor_not_found: "Forbidden.",
  actor_inactive: "Forbidden.",
  forbidden: "Forbidden.",
  super_admin_target: "This account's role cannot be changed.",
  invalid_role: "Invalid role.",
  last_manager: "Cannot demote the last active manager.",
  already_in_state: "User already has the requested role.",
  rpc_error: "Could not update role.",
}

function failureResponse(errorCode: string, status: number) {
  return NextResponse.json(
    {
      error: FAILURE_MESSAGE[errorCode] ?? "Request failed.",
      error_code: errorCode,
    },
    { status },
  )
}

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "anonymous"
  const { success, limit, reset, remaining } = await ratelimit.limit(`set-role:${ip}`)

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

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
    }

    const { targetUserId, newRole } = body as {
      targetUserId?: unknown
      newRole?: unknown
    }

    if (typeof targetUserId !== "string" || !UUID_RE.test(targetUserId)) {
      return NextResponse.json(
        { error: "Missing or invalid targetUserId." },
        { status: 400 },
      )
    }

    if (typeof newRole !== "string" || !newRole.trim()) {
      return NextResponse.json(
        { error: "Missing or invalid newRole." },
        { status: 400 },
      )
    }

    const admin = createAdminClient()

    const { data: rpcData, error: rpcError } = await admin.rpc("set_user_role", {
      p_actor_id: user.id,
      p_target_id: targetUserId,
      p_new_role: newRole.trim(),
    })

    if (rpcError) {
      console.error("[set-role] RPC transport error:", rpcError.message)
      return failureResponse("rpc_error", 500)
    }

    const result = rpcData as RpcResult | null
    if (!result || typeof result !== "object" || typeof result.success !== "boolean") {
      console.error("[set-role] Unexpected RPC payload:", rpcData)
      return failureResponse("rpc_error", 500)
    }

    if (!result.success) {
      const code = result.error_code || "rpc_error"
      const status = FAILURE_STATUS[code] ?? 500
      return failureResponse(code, status)
    }

    const detailsBase = `${result.target_full_name}: ${result.old_role} → ${result.new_role}`

    const { detailsSuffix, ...identity } = await resolveSecurityLogIdentity(
      admin,
      user,
      accessToken,
    )

    // lab_id = target's lab (nullable for org-scoped / null-lab targets).
    // Log failure must not fail the request (helper is non-throwing).
    await logSecurityEvent(admin, {
      ...identity,
      labId: result.target_lab_id ?? null,
      eventType: "role_changed",
      outcome: "success",
      details: appendSecurityLogDetails(detailsBase, detailsSuffix),
      ipAddress: ip === "anonymous" ? null : ip,
    })

    return NextResponse.json({
      success: true,
      oldRole: result.old_role,
      newRole: result.new_role,
      targetUserId,
      targetFullName: result.target_full_name,
    })
  } catch (error) {
    console.error("[set-role] Unexpected error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
