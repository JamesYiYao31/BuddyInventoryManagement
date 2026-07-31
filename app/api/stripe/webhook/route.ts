import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { createAdminClient } from "@/lib/mfa-api-auth"
import { decideSubscriptionBillingAccount } from "@/lib/stripe-subscription-account-resolution"
import type { SupabaseClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

/**
 * Stripe webhook — verify, claim receipt (applied_at NULL), apply state, then
 * stamp applied_at. Signature verification IS authentication.
 *
 * Durability (F-1): skip only when applied_at is set. Unapplied receipts are
 * re-applied on Stripe retry. Write failures return 500; terminal ignores
 * (unhandled type, unmatched account) return 200 with applied_at set.
 */

type ApplyBillingResult =
  | { ok: true }
  | { ok: false; reason: string }

type ResolveAccountResult =
  | { status: "found"; accountId: string }
  | { status: "unmatched" }
  | { status: "error"; reason: string }

const HANDLED_TYPES = new Set([
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
])

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
): Promise<ResolveAccountResult> {
  const object = event.data.object as unknown as Record<string, unknown>

  if (event.type === "checkout.session.completed") {
    const session = object as unknown as Stripe.Checkout.Session
    const id =
      typeof session.client_reference_id === "string"
        ? session.client_reference_id
        : null
    return id ? { status: "found", accountId: id } : { status: "unmatched" }
  }

  if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const sub = object as unknown as Stripe.Subscription
    const { data, error } = await admin
      .from("billing_accounts")
      .select("id")
      .eq("stripe_subscription_id", sub.id)
      .maybeSingle()

    const fromMeta = sub.metadata?.billing_account_id
    const metadataAccountId =
      typeof fromMeta === "string" && fromMeta.length > 0 ? fromMeta : null

    const decision = decideSubscriptionBillingAccount({
      lookup: {
        data: data?.id ? { id: data.id as string } : null,
        error: error ? { message: error.message } : null,
      },
      metadataAccountId,
    })

    if (decision.kind === "lookup_failed") {
      console.error(
        "[stripe/webhook] billing_accounts lookup by subscription failed:",
        decision.reason,
      )
      return { status: "error", reason: decision.reason }
    }
    if (decision.kind === "account") {
      return { status: "found", accountId: decision.accountId }
    }
    return { status: "unmatched" }
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
        // Keep out-of-order invoice metadata fallback load-bearing: log and
        // fall through rather than hard-failing the invoice path on lookup error.
        console.error(
          "[stripe/webhook] billing_accounts lookup by subscription failed:",
          error.message,
        )
      } else if (data?.id) {
        return { status: "found", accountId: data.id as string }
      }
    }

    const fromMeta = getInvoiceBillingAccountId(invoice)
    return fromMeta
      ? { status: "found", accountId: fromMeta }
      : { status: "unmatched" }
  }

  return { status: "unmatched" }
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
): Promise<ApplyBillingResult> {
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

    if (readError) {
      console.error(
        "[stripe/webhook] checkout.session.completed read failed:",
        readError.message,
      )
      return { ok: false, reason: readError.message }
    }

    if (!row) {
      console.error(
        `[stripe/webhook] UNMATCHED ${event.id} (checkout row missing)`,
      )
      // Terminal: bad reference will not appear on retry.
      return { ok: true }
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
      // Terminal: refuse overwrite; do not retry forever.
      return { ok: true }
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
      return { ok: false, reason: updateError.message }
    }
    return { ok: true }
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
      return { ok: false, reason: updateError.message }
    }
    return { ok: true }
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
      return { ok: false, reason: updateError.message }
    }
    return { ok: true }
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
      return { ok: false, reason: updateError.message }
    }
    return { ok: true }
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
      return { ok: false, reason: updateError.message }
    }
    return { ok: true }
  }

  // Unhandled type should be filtered before calling apply — treat as terminal.
  return { ok: true }
}

type ClaimResult =
  | { status: "ready" }
  | { status: "already_applied" }
  | { status: "error"; reason: string }

/**
 * Claim the event receipt with applied_at NULL. Skip only when a prior
 * attempt already stamped applied_at (true duplicate). A row with
 * applied_at NULL means re-apply.
 */
async function claimEventReceipt(
  admin: SupabaseClient,
  event: Stripe.Event,
): Promise<ClaimResult> {
  const { data: existing, error: selectError } = await admin
    .from("processed_stripe_events")
    .select("event_id, applied_at")
    .eq("event_id", event.id)
    .maybeSingle()

  if (selectError) {
    console.error(
      "[stripe/webhook] processed_stripe_events select failed:",
      selectError.message,
    )
    return { status: "error", reason: selectError.message }
  }

  if (existing?.applied_at) {
    return { status: "already_applied" }
  }

  if (existing) {
    // Prior attempt died mid-flight — re-apply without inserting.
    return { status: "ready" }
  }

  const { error: insertError } = await admin
    .from("processed_stripe_events")
    .insert({
      event_id: event.id,
      event_type: event.type,
      payload: event,
      applied_at: null,
    })

  if (!insertError) {
    return { status: "ready" }
  }

  // Race: another delivery inserted first — re-read applied_at.
  const { data: raced, error: raceError } = await admin
    .from("processed_stripe_events")
    .select("event_id, applied_at")
    .eq("event_id", event.id)
    .maybeSingle()

  if (raceError) {
    console.error(
      "[stripe/webhook] processed_stripe_events race re-select failed:",
      raceError.message,
    )
    return { status: "error", reason: raceError.message }
  }

  if (!raced) {
    console.error(
      "[stripe/webhook] processed_stripe_events insert failed and row missing:",
      insertError.message,
    )
    return { status: "error", reason: insertError.message }
  }

  if (raced.applied_at) {
    return { status: "already_applied" }
  }

  return { status: "ready" }
}

async function markEventApplied(
  admin: SupabaseClient,
  eventId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { error } = await admin
    .from("processed_stripe_events")
    .update({ applied_at: new Date().toISOString() })
    .eq("event_id", eventId)
    .is("applied_at", null)

  if (error) {
    console.error(
      "[stripe/webhook] processed_stripe_events applied_at stamp failed:",
      error.message,
    )
    return { ok: false, reason: error.message }
  }
  return { ok: true }
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

    const claim = await claimEventReceipt(admin, event)
    if (claim.status === "error") {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
    if (claim.status === "already_applied") {
      return NextResponse.json({ received: true, duplicate: true })
    }

    // Unhandled types are terminal — receipt + applied_at, no retry storm.
    if (!HANDLED_TYPES.has(event.type)) {
      const stamped = await markEventApplied(admin, event.id)
      if (!stamped.ok) {
        return NextResponse.json({ error: "Internal server error" }, { status: 500 })
      }
      return NextResponse.json({ received: true })
    }

    const resolved = await resolveBillingAccountId(admin, event)
    if (resolved.status === "error") {
      // Leave applied_at NULL so Stripe retries.
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }

    if (resolved.status === "unmatched") {
      const subId =
        event.type === "customer.subscription.updated" ||
        event.type === "customer.subscription.deleted"
          ? (event.data.object as Stripe.Subscription).id
          : null
      if (subId) {
        console.error(
          `[stripe/webhook] UNMATCHED ${event.id} type=${event.type} subscription=${subId}`,
        )
      } else {
        console.error(`[stripe/webhook] UNMATCHED ${event.id}`)
      }
      const stamped = await markEventApplied(admin, event.id)
      if (!stamped.ok) {
        return NextResponse.json({ error: "Internal server error" }, { status: 500 })
      }
      return NextResponse.json({ received: true })
    }

    const applied = await applyBillingEvent(admin, event, resolved.accountId)
    if (!applied.ok) {
      // Write failed — applied_at stays NULL; Stripe retries.
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }

    const stamped = await markEventApplied(admin, event.id)
    if (!stamped.ok) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }

    return NextResponse.json({ received: true })
  } catch (err) {
    console.error("[stripe/webhook] Unexpected error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
