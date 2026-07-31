import { NextRequest, NextResponse } from "next/server"
import { authenticateBearerRequest } from "@/lib/mfa-api-auth"
import {
  buildTenantRows,
  findAnomalies,
  buildEventRows,
  type OrgInput,
  type LabInput,
  type BillingAccountInput,
  type StripeEventInput,
} from "@/lib/billing-overview-model"

export const runtime = "nodejs"

function failureResponse(errorCode: string, status: number, message: string) {
  return NextResponse.json({ error: message, error_code: errorCode }, { status })
}

/**
 * GET /api/super-admin/billing-overview
 *
 * Super-admin-only. Service-role reads of orgs/labs/billing_accounts
 * (including Stripe IDs) + recent processed_stripe_events. Pure model
 * assembles tenants / anomalies / events. Fail-closed: any read error → 500
 * with no partial body.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateBearerRequest(
      request.headers.get("Authorization"),
    )
    if (!auth.ok) return auth.response

    const { user } = auth
    // Lazy import so node --test never loads Next.js via this module graph
    // when only the pure model is under test (same technique as resolve-billing-owner).
    const { createAdminClient } = await import("@/lib/mfa-api-auth")
    const admin = createAdminClient()

    // profiles has no email column — identity comes from Auth user.
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role, lab_id, org_id, is_active")
      .eq("id", user.id)
      .maybeSingle()

    if (profileError || !profile) {
      console.error(
        "[super-admin/billing-overview] Profile load failed:",
        profileError?.message ?? "missing profile",
      )
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }

    if (profile.is_active === false) {
      return failureResponse("actor_inactive", 403, "Forbidden.")
    }

    const role = profile.role as string
    if (role !== "super_admin") {
      return failureResponse("forbidden", 403, "Forbidden.")
    }

    const [
      orgsResult,
      labsResult,
      accountsResult,
      eventsResult,
    ] = await Promise.all([
      admin
        .from("organizations")
        .select("id, name")
        .order("created_at", { ascending: false }),
      admin
        .from("labs")
        .select("id, name, org_id, is_archived")
        .order("created_at", { ascending: false }),
      admin
        .from("billing_accounts")
        .select(
          "id, org_id, lab_id, billing_status, current_period_end, stripe_customer_id, stripe_subscription_id",
        ),
      admin
        .from("processed_stripe_events")
        .select("event_id, event_type, received_at, applied_at, payload")
        .order("received_at", { ascending: false })
        .limit(50),
    ])

    if (orgsResult.error) {
      console.error(
        "[super-admin/billing-overview] organizations read failed:",
        orgsResult.error.message,
      )
      return failureResponse("read_failed", 500, "Internal server error")
    }
    if (labsResult.error) {
      console.error(
        "[super-admin/billing-overview] labs read failed:",
        labsResult.error.message,
      )
      return failureResponse("read_failed", 500, "Internal server error")
    }
    if (accountsResult.error) {
      console.error(
        "[super-admin/billing-overview] billing_accounts read failed:",
        accountsResult.error.message,
      )
      return failureResponse("read_failed", 500, "Internal server error")
    }
    if (eventsResult.error) {
      console.error(
        "[super-admin/billing-overview] processed_stripe_events read failed:",
        eventsResult.error.message,
      )
      return failureResponse("read_failed", 500, "Internal server error")
    }

    const orgs = (orgsResult.data ?? []) as OrgInput[]
    const labs = (labsResult.data ?? []) as LabInput[]
    const billingAccounts = (accountsResult.data ?? []) as BillingAccountInput[]
    const events = (eventsResult.data ?? []) as StripeEventInput[]

    const generatedAt = new Date().toISOString()
    const nowMs = Date.parse(generatedAt)

    return NextResponse.json({
      tenants: buildTenantRows(orgs, labs, billingAccounts),
      anomalies: findAnomalies(orgs, labs, billingAccounts, events, nowMs),
      events: buildEventRows(events, billingAccounts, orgs, labs),
      generatedAt,
    })
  } catch (err) {
    console.error("[super-admin/billing-overview] Unexpected error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
