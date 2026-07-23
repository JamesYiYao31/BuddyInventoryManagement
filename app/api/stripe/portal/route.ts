import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"
import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { authenticateBearerRequest, createAdminClient } from "@/lib/mfa-api-auth"

export const runtime = "nodejs"

// Prefixed key so this 10/hr bucket does not collide with other limiters.
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "1 h"),
  analytics: true,
})

type BillingAccountRow = {
  id: string
  lab_id: string | null
  org_id: string | null
  billing_status: string
  stripe_customer_id: string | null
}

function failureResponse(errorCode: string, status: number, message: string) {
  return NextResponse.json({ error: message, error_code: errorCode }, { status })
}

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "anonymous"
  const { success, limit, reset, remaining } = await ratelimit.limit(
    `stripe-portal:${ip}`,
  )

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
    const auth = await authenticateBearerRequest(
      request.headers.get("Authorization"),
    )
    if (!auth.ok) return auth.response

    const { user } = auth
    const admin = createAdminClient()

    // profiles has no email column — identity email comes from Auth user.
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role, lab_id, org_id, is_active")
      .eq("id", user.id)
      .maybeSingle()

    if (profileError || !profile) {
      console.error(
        "[stripe/portal] Profile load failed:",
        profileError?.message ?? "missing profile",
      )
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }

    if (profile.is_active === false) {
      return failureResponse("actor_inactive", 403, "Forbidden.")
    }

    const role = profile.role as string
    if (role !== "manager" && role !== "org_admin") {
      return failureResponse("forbidden", 403, "Forbidden.")
    }

    let ownerFilter: { lab_id: string } | { org_id: string }
    if (role === "manager") {
      if (!profile.lab_id) {
        console.error("[stripe/portal] Manager missing lab_id:", user.id)
        return NextResponse.json({ error: "Internal server error" }, { status: 500 })
      }
      ownerFilter = { lab_id: profile.lab_id as string }
    } else {
      if (!profile.org_id) {
        console.error("[stripe/portal] Org admin missing org_id:", user.id)
        return NextResponse.json({ error: "Internal server error" }, { status: 500 })
      }
      ownerFilter = { org_id: profile.org_id as string }
    }

    // Do NOT create — portal requires an existing Stripe customer.
    const { data: existing, error: selectError } = await admin
      .from("billing_accounts")
      .select("id, lab_id, org_id, billing_status, stripe_customer_id")
      .match(ownerFilter)
      .maybeSingle()

    if (selectError) {
      console.error("[stripe/portal] billing_accounts select failed:", selectError.message)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }

    const billingAccount = existing as BillingAccountRow | null
    if (!billingAccount?.stripe_customer_id) {
      return failureResponse(
        "no_subscription",
        409,
        "No subscription found for this account.",
      )
    }

    const secretKey = process.env.STRIPE_SECRET_KEY
    if (!secretKey) {
      console.error("[stripe/portal] STRIPE_SECRET_KEY missing")
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }

    const allowedOrigins = new Set([
      "https://www.yourbuddyapp.com",
      "https://yourbuddyapp.com",
      "http://localhost:3000",
    ])
    const originHeader = request.headers.get("origin")
    const origin =
      originHeader && allowedOrigins.has(originHeader)
        ? originHeader
        : "https://www.yourbuddyapp.com"
    const returnUrl =
      role === "manager"
        ? `${origin}/dashboard?tab=billing`
        : `${origin}/org-admin`

    // Lazy-init Stripe inside the handler (never module scope — see ec3de11).
    const stripe = new Stripe(secretKey)
    const session = await stripe.billingPortal.sessions.create({
      customer: billingAccount.stripe_customer_id,
      return_url: returnUrl,
    })

    if (!session.url) {
      console.error("[stripe/portal] Portal session missing url")
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error("[stripe/portal] Unexpected error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
