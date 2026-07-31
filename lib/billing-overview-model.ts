/**
 * Pure billing-overview model for the super-admin server route.
 * No Supabase / Next.js imports — safe for node --test.
 */

export const STALE_UNAPPLIED_EVENT_MS = 15 * 60 * 1000

export type OrgInput = {
  id: string
  name: string
}

export type LabInput = {
  id: string
  name: string
  org_id: string | null
  is_archived: boolean
}

export type BillingAccountInput = {
  id: string
  org_id: string | null
  lab_id: string | null
  billing_status: string | null
  current_period_end: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
}

export type StripeEventInput = {
  event_id: string
  event_type: string
  received_at: string
  applied_at: string | null
  payload: unknown
}

export type TenantRow = {
  key: string
  name: string
  type: "Org" | "Lab"
  labCount: number
  billingStatus: string | null
  currentPeriodEnd: string | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  expectedMonthlyUsd: number | null
}

export type AnomalyKind =
  | "org_lab_billing_row"
  | "orphan_billing_row"
  | "stale_unapplied_event"
  | "period_end_passed"

export type Anomaly = {
  kind: AnomalyKind
  detail: string
}

export type EventRow = {
  eventId: string
  eventType: string
  receivedAt: string
  appliedAt: string | null
  tenantLabel: string
  amountUsd: number | null
  /** From payload.data.object.customer when present; null if absent/malformed. */
  stripeCustomerId: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function asId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value
  if (isRecord(value)) return asNonEmptyString(value.id)
  return null
}

export function buildTenantRows(
  orgs: OrgInput[],
  labs: LabInput[],
  billingAccounts: BillingAccountInput[],
): TenantRow[] {
  const rows: TenantRow[] = []

  for (const org of orgs) {
    const labCount = labs.filter(
      (l) => l.org_id === org.id && !l.is_archived,
    ).length
    const account = billingAccounts.find((a) => a.org_id === org.id)
    const billingStatus = account?.billing_status ?? null
    rows.push({
      key: `org:${org.id}`,
      name: org.name,
      type: "Org",
      labCount,
      billingStatus,
      currentPeriodEnd: account?.current_period_end ?? null,
      stripeCustomerId: account?.stripe_customer_id ?? null,
      stripeSubscriptionId: account?.stripe_subscription_id ?? null,
      expectedMonthlyUsd:
        billingStatus === "active" ? labCount * 200 : null,
    })
  }

  for (const lab of labs.filter((l) => l.org_id === null)) {
    const account = billingAccounts.find((a) => a.lab_id === lab.id)
    const billingStatus = account?.billing_status ?? null
    const labCount = lab.is_archived ? 0 : 1
    rows.push({
      key: `lab:${lab.id}`,
      name: lab.name,
      type: "Lab",
      labCount,
      billingStatus,
      currentPeriodEnd: account?.current_period_end ?? null,
      stripeCustomerId: account?.stripe_customer_id ?? null,
      stripeSubscriptionId: account?.stripe_subscription_id ?? null,
      expectedMonthlyUsd:
        billingStatus === "active" ? labCount * 200 : null,
    })
  }

  return rows
}

export function findAnomalies(
  orgs: OrgInput[],
  labs: LabInput[],
  billingAccounts: BillingAccountInput[],
  events: StripeEventInput[],
  nowMs: number,
): Anomaly[] {
  const anomalies: Anomaly[] = []
  const orgIds = new Set(orgs.map((o) => o.id))
  const labsById = new Map(labs.map((l) => [l.id, l]))

  for (const account of billingAccounts) {
    if (account.lab_id) {
      const lab = labsById.get(account.lab_id)
      if (lab && lab.org_id != null) {
        anomalies.push({
          kind: "org_lab_billing_row",
          detail: `billing_accounts ${account.id} has lab_id=${account.lab_id} but that lab belongs to org ${lab.org_id}`,
        })
      }
    }

    const orgOk = account.org_id == null || orgIds.has(account.org_id)
    const labOk = account.lab_id == null || labsById.has(account.lab_id)
    if (!orgOk || !labOk) {
      anomalies.push({
        kind: "orphan_billing_row",
        detail: `billing_accounts ${account.id} org_id=${account.org_id ?? "null"} lab_id=${account.lab_id ?? "null"} matches no loaded tenant`,
      })
    }

    if (account.billing_status === "active" && account.current_period_end) {
      const endMs = Date.parse(account.current_period_end)
      if (!Number.isNaN(endMs) && endMs < nowMs) {
        anomalies.push({
          kind: "period_end_passed",
          detail: `billing_accounts ${account.id} is active but current_period_end=${account.current_period_end} is in the past`,
        })
      }
    }
  }

  for (const event of events) {
    if (event.applied_at != null) continue
    const receivedMs = Date.parse(event.received_at)
    if (Number.isNaN(receivedMs)) continue
    if (nowMs - receivedMs > STALE_UNAPPLIED_EVENT_MS) {
      anomalies.push({
        kind: "stale_unapplied_event",
        detail: `event ${event.event_id} (${event.event_type}) received_at=${event.received_at} still has applied_at NULL`,
      })
    }
  }

  return anomalies
}

function extractEventObject(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) return null
  const data = payload.data
  if (!isRecord(data)) return null
  const object = data.object
  return isRecord(object) ? object : null
}

function extractBillingAccountIdFromObject(
  object: Record<string, unknown>,
): string | null {
  const meta = object.metadata
  if (isRecord(meta)) {
    const fromMeta = asNonEmptyString(meta.billing_account_id)
    if (fromMeta) return fromMeta
  }

  // Invoice parent.subscription_details.metadata (newer Invoice shape).
  const parent = object.parent
  if (isRecord(parent)) {
    const subDetails = parent.subscription_details
    if (isRecord(subDetails) && isRecord(subDetails.metadata)) {
      const fromParent = asNonEmptyString(
        subDetails.metadata.billing_account_id,
      )
      if (fromParent) return fromParent
    }
  }

  return null
}

function extractSubscriptionIdFromObject(
  object: Record<string, unknown>,
  eventType: string,
): string | null {
  if (
    eventType === "customer.subscription.updated" ||
    eventType === "customer.subscription.deleted"
  ) {
    return asId(object.id)
  }

  const direct = asId(object.subscription)
  if (direct) return direct

  const parent = object.parent
  if (isRecord(parent)) {
    const subDetails = parent.subscription_details
    if (isRecord(subDetails)) {
      const fromParent = asId(subDetails.subscription)
      if (fromParent) return fromParent
    }
  }

  return null
}

function extractCustomerIdFromObject(
  object: Record<string, unknown>,
): string | null {
  return asId(object.customer)
}

function resolveAccountForEvent(
  event: StripeEventInput,
  billingAccounts: BillingAccountInput[],
): BillingAccountInput | null {
  const object = extractEventObject(event.payload)
  if (!object) return null

  const billingAccountId = extractBillingAccountIdFromObject(object)
  if (billingAccountId) {
    const byId = billingAccounts.find((a) => a.id === billingAccountId)
    if (byId) return byId
  }

  const subscriptionId = extractSubscriptionIdFromObject(
    object,
    event.event_type,
  )
  if (subscriptionId) {
    const bySub = billingAccounts.find(
      (a) => a.stripe_subscription_id === subscriptionId,
    )
    if (bySub) return bySub
  }

  const customerId = extractCustomerIdFromObject(object)
  if (customerId) {
    const byCustomer = billingAccounts.find(
      (a) => a.stripe_customer_id === customerId,
    )
    if (byCustomer) return byCustomer
  }

  // Checkout session often carries client_reference_id = billing_accounts.id
  if (event.event_type === "checkout.session.completed") {
    const ref = asNonEmptyString(object.client_reference_id)
    if (ref) {
      const byRef = billingAccounts.find((a) => a.id === ref)
      if (byRef) return byRef
    }
  }

  return null
}

function tenantLabelForAccount(
  account: BillingAccountInput,
  orgs: OrgInput[],
  labs: LabInput[],
): string {
  if (account.org_id) {
    const org = orgs.find((o) => o.id === account.org_id)
    if (org) return org.name
  }
  if (account.lab_id) {
    const lab = labs.find((l) => l.id === account.lab_id)
    if (lab) return lab.name
  }
  return "Unresolved"
}

function extractInvoiceAmountUsd(payload: unknown, eventType: string): number | null {
  if (eventType !== "invoice.paid" && eventType !== "invoice.payment_failed") {
    return null
  }
  const object = extractEventObject(payload)
  if (!object) return null

  // Prefer amount_paid; fall back to total. Both are cents on Stripe invoices.
  const centsCandidate = object.amount_paid ?? object.total
  if (typeof centsCandidate !== "number" || !Number.isFinite(centsCandidate)) {
    return null
  }
  return centsCandidate / 100
}

export function buildEventRows(
  events: StripeEventInput[],
  billingAccounts: BillingAccountInput[],
  orgs: OrgInput[],
  labs: LabInput[],
): EventRow[] {
  const rows: EventRow[] = []

  for (const event of events) {
    let tenantLabel = "Unresolved"
    let amountUsd: number | null = null
    let stripeCustomerId: string | null = null

    try {
      const account = resolveAccountForEvent(event, billingAccounts)
      if (account) {
        tenantLabel = tenantLabelForAccount(account, orgs, labs)
      }
      amountUsd = extractInvoiceAmountUsd(event.payload, event.event_type)
      const object = extractEventObject(event.payload)
      stripeCustomerId = object ? extractCustomerIdFromObject(object) : null
    } catch {
      tenantLabel = "Unresolved"
      amountUsd = null
      stripeCustomerId = null
    }

    if (tenantLabel === "") tenantLabel = "Unresolved"
    if (stripeCustomerId === "") stripeCustomerId = null

    rows.push({
      eventId: event.event_id,
      eventType: event.event_type,
      receivedAt: event.received_at,
      appliedAt: event.applied_at,
      tenantLabel,
      amountUsd,
      stripeCustomerId,
    })
  }

  rows.sort((a, b) => {
    const aMs = Date.parse(a.receivedAt)
    const bMs = Date.parse(b.receivedAt)
    const aSafe = Number.isNaN(aMs) ? 0 : aMs
    const bSafe = Number.isNaN(bMs) ? 0 : bMs
    return bSafe - aSafe
  })

  return rows
}
