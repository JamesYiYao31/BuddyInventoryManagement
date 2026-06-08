import { randomUUID } from "crypto"
import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"
import { NextRequest, NextResponse } from "next/server"
import { authenticateBearerRequest, createAdminClient } from "@/lib/mfa-api-auth"
import { generateRecoveryCodes, hashRecoveryCode } from "@/lib/recovery-codes"

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "1 h"),
  analytics: true,
})

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "anonymous"
  const { success, limit, reset, remaining } = await ratelimit.limit(`mfa-recovery-gen:${ip}`)

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

    const { data: factorsData } = await admin.auth.admin.mfa.listFactors({ userId: user.id })
    const hasVerifiedTotp = (factorsData?.factors ?? []).some(
      (f) => f.factor_type === "totp" && f.status === "verified",
    )
    if (!hasVerifiedTotp) {
      return NextResponse.json(
        { error: "Two-factor authentication must be enabled before generating recovery codes." },
        { status: 400 },
      )
    }

    const plaintextCodes = generateRecoveryCodes()
    const batchId = randomUUID()
    const rows = await Promise.all(
      plaintextCodes.map(async (code) => ({
        user_id: user.id,
        code_hash: await hashRecoveryCode(code),
        batch_id: batchId,
      })),
    )

    const { error: deleteError } = await admin
      .from("mfa_recovery_codes")
      .delete()
      .eq("user_id", user.id)

    if (deleteError) {
      console.error("MFA recovery codes delete failed:", deleteError.message)
      return NextResponse.json({ error: "Could not regenerate recovery codes." }, { status: 500 })
    }

    const { error: insertError } = await admin.from("mfa_recovery_codes").insert(rows)

    if (insertError) {
      console.error("MFA recovery codes insert failed:", insertError.message)
      return NextResponse.json({ error: "Could not generate recovery codes." }, { status: 500 })
    }

    return NextResponse.json({ codes: plaintextCodes, batchId })
  } catch (error) {
    console.error("MFA recovery codes generate route failed:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
