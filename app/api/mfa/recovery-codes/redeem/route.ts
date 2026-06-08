import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"
import { NextRequest, NextResponse } from "next/server"
import { authenticateBearerRequest, createAdminClient } from "@/lib/mfa-api-auth"
import { logMfaRecoveryActivity } from "@/lib/log-mfa-activity-server"
import { normalizeRecoveryCode, verifyRecoveryCode } from "@/lib/recovery-codes"

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(20, "1 h"),
  analytics: true,
})

const ELEVATION_TTL_MINUTES = 60

/**
 * Supabase Auth only elevates sessions to AAL2 via native TOTP verify — there is no
 * recovery-code factor type. After a valid recovery code is redeemed we insert a
 * short-lived row in mfa_recovery_elevations; the custom_access_token_hook
 * (Part 1B SQL — merge into your existing hook) sets JWT claim `aal` = `aal2` on the next token
 * refresh. The client MUST call supabase.auth.refreshSession() after success.
 */
async function grantPendingAal2Elevation(
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

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "anonymous"
  const { success, limit, reset, remaining } = await ratelimit.limit(`mfa-recovery-redeem:${ip}`)

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

    const { user, sessionId } = auth
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
      await logMfaRecoveryActivity(
        admin,
        user.id,
        "MFA Recovery Code Redeem Failed",
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

    const elevationGranted = await grantPendingAal2Elevation(admin, user.id, sessionId)
    if (!elevationGranted) {
      // Code consumed — user must regenerate; elevation requires hook + session_id in JWT.
      await logMfaRecoveryActivity(
        admin,
        user.id,
        "MFA Recovery Code Redeemed",
        "Recovery code redeemed but AAL2 elevation could not be scheduled (missing session_id or hook not configured).",
      )
      return NextResponse.json(
        {
          error:
            "Recovery code accepted but session could not be elevated. Ensure the access token hook is configured, then sign in again.",
          remainingCount: remainingBefore - 1,
        },
        { status: 500 },
      )
    }

    await logMfaRecoveryActivity(
      admin,
      user.id,
      "MFA Recovery Code Redeemed",
      `Recovery code redeemed successfully. ${remainingBefore - 1} unused code(s) remain.`,
    )

    return NextResponse.json({
      success: true,
      remainingCount: remainingBefore - 1,
      refreshSession: true,
    })
  } catch (error) {
    console.error("MFA recovery codes redeem route failed:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
