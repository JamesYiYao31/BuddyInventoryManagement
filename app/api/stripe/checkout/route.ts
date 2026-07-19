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
    `stripe-checkout:${ip}`,
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
        "[stripe/checkout] Profile load failed:",
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
        console.error("[stripe/checkout] Manager missing lab_id:", user.id)
        return NextResponse.json({ error: "Internal server error" }, { status: 500 })
      }
      ownerFilter = { lab_id: profile.lab_id as string }
    } else {
      if (!profile.org_id) {
        console.error("[stripe/checkout] Org admin missing org_id:", user.id)
        return NextResponse.json({ error: "Internal server error" }, { status: 500 })
      }
      ownerFilter = { org_id: profile.org_id as string }
    }

    let billingAccount: BillingAccountRow | null = null

    const { data: existing, error: selectError } = await admin
      .from("billing_accounts")
      .select("id, lab_id, org_id, billing_status")
      .match(ownerFilter)
      .maybeSingle()

    if (selectError) {
      console.error("[stripe/checkout] billing_accounts select failed:", selectError.message)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }

    if (existing) {
      billingAccount = existing as BillingAccountRow
    } else {
      const insertRow =
        "lab_id" in ownerFilter
          ? { lab_id: ownerFilter.lab_id, billing_status: "trialing" }
          : { org_id: ownerFilter.org_id, billing_status: "trialing" }

      const { data: created, error: insertError } = await admin
        .from("billing_accounts")
        .insert(insertRow)
        .select("id, lab_id, org_id, billing_status")
        .single()

      if (insertError || !created) {
        // Concurrent create: unique owner constraint — re-select.
        const { data: raced, error: raceError } = await admin
          .from("billing_accounts")
          .select("id, lab_id, org_id, billing_status")
          .match(ownerFilter)
          .maybeSingle()

        if (raceError || !raced) {
          console.error(
            "[stripe/checkout] billing_accounts insert failed:",
            insertError?.message ?? raceError?.message,
          )
          return NextResponse.json({ error: "Internal server error" }, { status: 500 })
        }
        billingAccount = raced as BillingAccountRow
      } else {
        billingAccount = created as BillingAccountRow
      }
    }

    if (billingAccount.billing_status === "active") {
      return failureResponse(
        "already_subscribed",
        409,
        "This account already has an active subscription.",
      )
    }

    let quantity = 1
    if (role === "org_admin" && "org_id" in ownerFilter) {
      const orgId = ownerFilter.org_id
      const { count, error: countError } = await admin
        .from("labs")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("is_archived", false)

      if (countError) {
        console.error("[stripe/checkout] lab count failed:", countError.message)
        return NextResponse.json({ error: "Internal server error" }, { status: 500 })
      }

      quantity = count ?? 0
      if (quantity === 0) {
        return failureResponse(
          "no_active_labs",
          409,
          "No active labs to subscribe.",
        )
      }
    }

    const secretKey = process.env.STRIPE_SECRET_KEY
    const priceId = process.env.STRIPE_PRICE_ID
    if (!secretKey || !priceId) {
      console.error("[stripe/checkout] STRIPE_SECRET_KEY or STRIPE_PRICE_ID missing")
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }

    const email = user.email
    if (!email) {
      console.error("[stripe/checkout] Caller has no email:", user.id)
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
    const successUrl =
      role === "manager"
        ? `${origin}/dashboard?tab=billing&checkout=success`
        : `${origin}/org-admin?checkout=success`
    const cancelUrl =
      role === "manager"
        ? `${origin}/dashboard?tab=billing&checkout=cancelled`
        : `${origin}/org-admin?checkout=cancelled`

    // Lazy-init Stripe inside the handler (never module scope — see ec3de11).
    const stripe = new Stripe(secretKey)
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity }],
      client_reference_id: billingAccount.id,
      subscription_data: {
        metadata: { billing_account_id: billingAccount.id },
      },
      customer_email: email,
      success_url: successUrl,
      cancel_url: cancelUrl,
    })

    if (!session.url) {
      console.error("[stripe/checkout] Checkout session missing url")
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error("[stripe/checkout] Unexpected error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
