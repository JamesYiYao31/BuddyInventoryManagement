import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"
import { NextRequest, NextResponse } from "next/server"
import { authenticateBearerRequest, createAdminClient } from "@/lib/mfa-api-auth"
import { appendSecurityLogDetails, logSecurityEvent, resolveSecurityLogIdentity } from "@/lib/log-security-event-server"
import { normalizeRecoveryCode, verifyRecoveryCode } from "@/lib/recovery-codes"

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(20, "1 h"),
  analytics: true,
})

const ELEVATION_TTL_MINUTES = 60

/**
 * Records a temporary recovery elevation after a valid recovery code is redeemed.
 *
 * Supabase only reaches native AAL2 via a genuine TOTP verification — there is no
 * recovery-code factor type, and the custom_access_token_hook cannot set the `aal`
 * claim (Supabase reserves it; the hook sets only lab_id/org_id/user_role). Instead,
 * a successful redeem inserts a short-lived row into mfa_recovery_elevations
 * (60-minute TTL, keyed to the session_id). Both gates — lib/mfa-gate.ts and the
 * dashboard gate in app/dashboard/page.tsx — authorize an aal1 session by
 * live-checking that row via GET /api/mfa/recovery-elevation-status. The session
 * stays at aal1 throughout; recovery login never produces aal2.
 */
async function grantRecoveryElevation(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  sessionId: string | null,
): Promise<boolean> {
  if (!sessionId) return false

  const expiresAt = new Date(Date.now() + ELEVATION_TTL_MINUTES * 60 * 1000).toISOString()

  const { error: deleteError } = await admin
    .from("mfa_recovery_elevations")
    .delete()
    .eq("user_id", userId)

  if (deleteError) {
    console.error("MFA recovery elevation cleanup failed:", deleteError.message)
    return false
  }

  const { error: insertError } = await admin.from("mfa_recovery_elevations").insert([
    {
      user_id: userId,
      session_id: sessionId,
      expires_at: expiresAt,
    },
  ])

  if (insertError) {
    console.error("MFA recovery elevation insert failed:", insertError.message)
    return false
  }

  return true
}

async function logRecoveryRedeemSecurityEvent(
  admin: ReturnType<typeof createAdminClient>,
  user: { id: string; email?: string },
  accessToken: string,
  logIp: string | null,
  outcome: "success" | "failure",
  details: string,
): Promise<void> {
  const { detailsSuffix, ...identity } = await resolveSecurityLogIdentity(admin, user, accessToken)

  await logSecurityEvent(admin, {
    ...identity,
    eventType: "recovery_code_redeemed",
    outcome,
    details: appendSecurityLogDetails(details, detailsSuffix),
    ipAddress: logIp,
  })
}

export async function POST(request: NextRequest) {
  const logIp =
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    null
  const rateLimitKey = logIp ?? "anonymous"
  const { success, limit, reset, remaining } = await ratelimit.limit(`mfa-recovery-redeem:${rateLimitKey}`)

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

    const { user, sessionId, accessToken } = auth
    const admin = createAdminClient()

    let body: { code?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
    }

    const rawCode = typeof body.code === "string" ? body.code.trim() : ""
    const normalized = normalizeRecoveryCode(rawCode)
    if (normalized.length !== 8) {
      return NextResponse.json({ error: "Invalid recovery code." }, { status: 400 })
    }

    const { data: unusedRows, error: fetchError } = await admin
      .from("mfa_recovery_codes")
      .select("id, code_hash")
      .eq("user_id", user.id)
      .is("used_at", null)

    if (fetchError) {
      console.error("MFA recovery codes fetch failed:", fetchError.message)
      return NextResponse.json({ error: "Could not verify recovery code." }, { status: 500 })
    }

    const rows = unusedRows ?? []
    const remainingBefore = rows.length

    let matchedId: string | null = null
    for (const row of rows) {
      const matches = await verifyRecoveryCode(rawCode, row.code_hash)
      if (matches) {
        matchedId = row.id
        break
      }
    }

    if (!matchedId) {
      await logRecoveryRedeemSecurityEvent(
        admin,
        user,
        accessToken,
        logIp,
        "failure",
        "Invalid recovery code submitted during MFA challenge.",
      )
      return NextResponse.json(
        { error: "Invalid recovery code.", remainingCount: remainingBefore },
        { status: 401 },
      )
    }

    const { error: markError } = await admin
      .from("mfa_recovery_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("id", matchedId)
      .eq("user_id", user.id)
      .is("used_at", null)

    if (markError) {
      console.error("MFA recovery code mark-used failed:", markError.message)
      return NextResponse.json({ error: "Could not redeem recovery code." }, { status: 500 })
    }

    const elevationGranted = await grantRecoveryElevation(admin, user.id, sessionId)
    if (!elevationGranted) {
      // Code already consumed above; the mfa_recovery_elevations row could not be
      // recorded (missing session_id or a DB error), so the user must sign in again.
      await logRecoveryRedeemSecurityEvent(
        admin,
        user,
        accessToken,
        logIp,
        "success",
        "Recovery code redeemed but elevation could not be recorded (missing session_id).",
      )
      return NextResponse.json(
        {
          error: "Recovery elevation could not be recorded (missing session_id).",
          remainingCount: remainingBefore - 1,
        },
        { status: 500 },
      )
    }

    await logRecoveryRedeemSecurityEvent(
      admin,
      user,
      accessToken,
      logIp,
      "success",
      `Recovery code redeemed successfully. ${remainingBefore - 1} unused code(s) remain.`,
    )

    return NextResponse.json({
      success: true,
      remainingCount: remainingBefore - 1,
    })
  } catch (error) {
    console.error("MFA recovery codes redeem route failed:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
