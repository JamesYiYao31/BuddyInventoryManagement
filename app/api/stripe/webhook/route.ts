import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { createAdminClient } from "@/lib/mfa-api-auth"
import type { SupabaseClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

/**
 * Stripe webhook — verify, receipt (idempotent), then map state into billing_accounts.
 * Signature verification IS authentication. No bearer auth, no Upstash limiter.
 * State applies ONLY on first delivery (duplicate upsert → early return).
 *
 * Stripe client is created inside the handler (not module scope) so Next.js
 * build-time page-data collection does not require STRIPE_SECRET_KEY.
 */

function epochToIso(epoch: number | null | undefined): string | null {
  if (typeof epoch !== "number" || !Number.isFinite(epoch)) return null
  return new Date(epoch * 1000).toISOString()
}

function asId(
  value: string | { id: string } | null | undefined,
): string | null {
  if (!value) return null
  if (typeof value === "string") return value
  if (typeof value === "object" && typeof value.id === "string") return value.id
  return null
}

function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  // Classic field (still present on many API versions).
  const direct = asId(
    (invoice as Stripe.Invoice & { subscription?: string | { id: string } | null })
      .subscription ?? null,
  )
  if (direct) return direct

  // Newer Invoice parent shape — inspect the receipted payload in-place.
  const parent = (
    invoice as Stripe.Invoice & {
      parent?: {
        subscription_details?: { subscription?: string | { id: string } | null }
      } | null
    }
  ).parent
  return asId(parent?.subscription_details?.subscription ?? null)
}

function getInvoiceBillingAccountId(invoice: Stripe.Invoice): string | null {
  const meta = invoice.metadata?.billing_account_id
  if (typeof meta === "string" && meta.length > 0) return meta

  const parentMeta = (
    invoice as Stripe.Invoice & {
      parent?: {
        subscription_details?: { metadata?: Record<string, string> | null }
      } | null
    }
  ).parent?.subscription_details?.metadata?.billing_account_id
  if (typeof parentMeta === "string" && parentMeta.length > 0) return parentMeta

  return null
}

function getInvoicePeriodEnd(invoice: Stripe.Invoice): string | null {
  const firstLine = invoice.lines?.data?.[0] as
    | (Stripe.InvoiceLineItem & {
        period?: { end?: number | null } | null
      })
    | undefined
  const fromLine = epochToIso(firstLine?.period?.end ?? null)
  if (fromLine) return fromLine

  const invoicePeriodEnd = (
    invoice as Stripe.Invoice & { period_end?: number | null }
  ).period_end
  return epochToIso(invoicePeriodEnd ?? null)
}

async function resolveBillingAccountId(
  admin: SupabaseClient,
  event: Stripe.Event,
): Promise<string | null> {
  const object = event.data.object as unknown as Record<string, unknown>

  if (event.type === "checkout.session.completed") {
    const session = object as unknown as Stripe.Checkout.Session
    return typeof session.client_reference_id === "string"
      ? session.client_reference_id
      : null
  }

  if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const sub = object as unknown as Stripe.Subscription
    const fromMeta = sub.metadata?.billing_account_id
    return typeof fromMeta === "string" && fromMeta.length > 0 ? fromMeta : null
  }

  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    const invoice = object as unknown as Stripe.Invoice
    const subscriptionId = getInvoiceSubscriptionId(invoice)

    if (subscriptionId) {
      const { data, error } = await admin
        .from("billing_accounts")
        .select("id")
        .eq("stripe_subscription_id", subscriptionId)
        .maybeSingle()

      if (error) {
        console.error(
          "[stripe/webhook] billing_accounts lookup by subscription failed:",
          error.message,
        )
      } else if (data?.id) {
        return data.id as string
      }
    }

    // Fallback: metadata path on the receipted invoice payload (this event).
    return getInvoiceBillingAccountId(invoice)
  }

  return null
}

function getSubscriptionPeriodEnd(sub: Stripe.Subscription): string | null {
  // Stripe SDK 22+ types period on subscription items; webhook payloads may
  // still carry a top-level current_period_end depending on account API version.
  const fromItem = sub.items?.data?.[0]?.current_period_end
  if (typeof fromItem === "number") return epochToIso(fromItem)
  const legacy = (
    sub as Stripe.Subscription & { current_period_end?: number | null }
  ).current_period_end
  return epochToIso(legacy ?? null)
}

async function applyBillingEvent(
  admin: SupabaseClient,
  event: Stripe.Event,
  accountId: string,
): Promise<void> {
  const now = new Date().toISOString()
  const object = event.data.object

  if (event.type === "checkout.session.completed") {
    const session = object as Stripe.Checkout.Session
    const incomingSub = asId(session.subscription)
    const customerId = asId(session.customer)

    const { data: row, error: readError } = await admin
      .from("billing_accounts")
      .select("id, stripe_subscription_id")
      .eq("id", accountId)
      .maybeSingle()

    if (readError || !row) {
      console.error(
        `[stripe/webhook] UNMATCHED ${event.id} (checkout row missing)`,
      )
      return
    }

    const existingSub =
      typeof row.stripe_subscription_id === "string"
        ? row.stripe_subscription_id
        : null

    if (
      existingSub &&
      incomingSub &&
      existingSub !== incomingSub
    ) {
      console.error(
        `[stripe/webhook] DUPLICATE SUBSCRIPTION account=${accountId} existing=${existingSub} incoming=${incomingSub}`,
      )
      return
    }

    const { error: updateError } = await admin
      .from("billing_accounts")
      .update({
        stripe_customer_id: customerId,
        stripe_subscription_id: incomingSub,
        billing_status: "active",
        updated_at: now,
      })
      .eq("id", accountId)

    if (updateError) {
      console.error(
        "[stripe/webhook] checkout.session.completed update failed:",
        updateError.message,
      )
    }
    return
  }

  if (event.type === "invoice.paid") {
    const invoice = object as Stripe.Invoice
    const { error: updateError } = await admin
      .from("billing_accounts")
      .update({
        billing_status: "active",
        current_period_end: getInvoicePeriodEnd(invoice),
        updated_at: now,
      })
      .eq("id", accountId)

    if (updateError) {
      console.error(
        "[stripe/webhook] invoice.paid update failed:",
        updateError.message,
      )
    }
    return
  }

  if (event.type === "invoice.payment_failed") {
    const { error: updateError } = await admin
      .from("billing_accounts")
      .update({
        billing_status: "past_due",
        updated_at: now,
      })
      .eq("id", accountId)

    if (updateError) {
      console.error(
        "[stripe/webhook] invoice.payment_failed update failed:",
        updateError.message,
      )
    }
    return
  }

  if (event.type === "customer.subscription.updated") {
    const sub = object as Stripe.Subscription
    const patch: Record<string, unknown> = {
      current_period_end: getSubscriptionPeriodEnd(sub),
      updated_at: now,
    }
    if (sub.status === "active") patch.billing_status = "active"
    else if (sub.status === "past_due") patch.billing_status = "past_due"
    // Anything else → leave billing_status unchanged.

    const { error: updateError } = await admin
      .from("billing_accounts")
      .update(patch)
      .eq("id", accountId)

    if (updateError) {
      console.error(
        "[stripe/webhook] customer.subscription.updated update failed:",
        updateError.message,
      )
    }
    return
  }

  if (event.type === "customer.subscription.deleted") {
    const { error: updateError } = await admin
      .from("billing_accounts")
      .update({
        billing_status: "suspended",
        updated_at: now,
      })
      .eq("id", accountId)

    if (updateError) {
      console.error(
        "[stripe/webhook] customer.subscription.deleted update failed:",
        updateError.message,
      )
    }
  }
}

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

    // First delivery only — map into billing_accounts (never INSERT).
    const handledTypes = new Set([
      "checkout.session.completed",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "invoice.paid",
      "invoice.payment_failed",
    ])

    if (handledTypes.has(event.type)) {
      const accountId = await resolveBillingAccountId(admin, event)
      if (!accountId) {
        console.error(`[stripe/webhook] UNMATCHED ${event.id}`)
        return NextResponse.json({ received: true })
      }
      await applyBillingEvent(admin, event, accountId)
    }

    return NextResponse.json({ received: true })
  } catch (err) {
    console.error("[stripe/webhook] Unexpected error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
