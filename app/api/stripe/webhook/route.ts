import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { createAdminClient } from "@/lib/mfa-api-auth"

export const runtime = "nodejs"

/**
 * Stripe webhook — LOG-ONLY.
 * Signature verification IS authentication. No bearer auth, no Upstash limiter.
 * Observes events into processed_stripe_events; does not touch billing_accounts.
 *
 * Stripe client is created inside the handler (not module scope) so Next.js
 * build-time page-data collection does not require STRIPE_SECRET_KEY.
 */
export async function POST(req: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error(
      "[stripe/webhook] STRIPE_WEBHOOK_SECRET is missing — refusing to verify.",
    )
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }

  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    console.error(
      "[stripe/webhook] STRIPE_SECRET_KEY is missing — refusing to verify.",
    )
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }

  const signature = req.headers.get("stripe-signature")
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header." }, { status: 400 })
  }

  // Raw body required for constructEvent — never parse JSON before verification.
  const body = await req.text()

  let event: Stripe.Event
  try {
    const stripe = new Stripe(secretKey)
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 400 })
  }

  try {
    const admin = createAdminClient()

    // ignoreDuplicates: true → duplicate event_id returns data: [] and no error
    // (service role bypasses RLS, so empty array can only mean duplicate).
    const { data, error } = await admin
      .from("processed_stripe_events")
      .upsert(
        {
          event_id: event.id,
          event_type: event.type,
          payload: event,
        },
        { onConflict: "event_id", ignoreDuplicates: true },
      )
      .select()

    if (error) {
      console.error("[stripe/webhook] processed_stripe_events upsert failed:", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ received: true, duplicate: true })
    }

    return NextResponse.json({ received: true })
  } catch (err) {
    console.error("[stripe/webhook] Unexpected error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
