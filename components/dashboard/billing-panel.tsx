"use client"

import { useCallback, useEffect, useState } from "react"
import { CreditCard, Loader2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { resolveCurrentUserLabId } from "@/lib/inventory-utils"
import {
  createCheckoutSession,
  createCheckoutErrorMessage,
} from "@/lib/create-checkout"
import {
  createBillingPortalSession,
  createBillingPortalErrorMessage,
} from "@/lib/billing-portal"

type BillingPanelProps = {
  /** manager = lab-scoped; org_admin = org-scoped */
  mode: "manager" | "org_admin"
  orgId?: string | null
}

/** Four-state account load — never invent "trialing" from a failed/empty misread. */
type AccountLoadState = "loading" | "resolved" | "none" | "unknown"

type BillingAccountRow = {
  id: string
  lab_id: string | null
  org_id: string | null
  billing_status: string
  current_period_end: string | null
}

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null
  const end = new Date(iso)
  if (Number.isNaN(end.getTime())) return null
  const ms = end.getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)))
}

function formatUsd(amount: number): string {
  return amount.toLocaleString("en-US")
}

/** Viewer-local date + short timezone label (period-end is timezone-sensitive). */
function formatRenewalDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  try {
    // dateStyle and timeZoneName cannot be combined in Intl — that throws and
    // was silently nulling every renewal label after C5.
    const date = new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(d)
    const tz =
      new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
        .formatToParts(d)
        .find((part) => part.type === "timeZoneName")?.value ?? ""
    return tz ? `${date} (${tz})` : date
  } catch {
    return null
  }
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "active":
      return "bg-green-500/15 text-green-800 dark:text-green-400"
    case "trialing":
      return "bg-blue-500/15 text-blue-800 dark:text-blue-400"
    case "past_due":
      return "bg-amber-500/15 text-amber-800 dark:text-amber-400"
    case "suspended":
      return "bg-red-500/15 text-red-800 dark:text-red-400"
    default:
      return "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400"
  }
}

/**
 * Prefer the org-keyed row when RLS returns more than one (duplicate-billing
 * residue). Should be impossible after Phase B1; warn so we hear about it.
 */
function pickBillingAccount(rows: BillingAccountRow[]): BillingAccountRow {
  if (rows.length > 1) {
    console.warn(
      "[billing] multiple billing_accounts visible to caller;",
      "preferring org-keyed row. ids=",
      rows.map((r) => r.id),
    )
  }
  const orgKeyed = rows.find((r) => r.org_id != null)
  return orgKeyed ?? rows[0]
}

const BTN_PRIMARY =
  "h-11 px-6 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-sm hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none inline-flex items-center justify-center gap-2"
const BTN_AMBER =
  "h-11 px-6 rounded-xl bg-amber-600 text-white font-bold text-sm shadow-sm hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none inline-flex items-center justify-center gap-2"
const BTN_RED =
  "h-11 px-6 rounded-xl bg-red-600 text-white font-bold text-sm shadow-sm hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none inline-flex items-center justify-center gap-2"

const ORG_MANAGED_COPY =
  "Billing is managed by your organization. Please contact your organization administrator."

export function BillingPanel({ mode, orgId }: BillingPanelProps) {
  const [accountLoadState, setAccountLoadState] =
    useState<AccountLoadState>("loading")
  const [billingStatus, setBillingStatus] = useState<string | null>(null)
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null)
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null)
  const [labCount, setLabCount] = useState(1)
  /**
   * Org membership from labs.org_id (same signal as the server resolver).
   * unknown = lab read failed → hide purchase controls (fail closed).
   */
  const [orgMembership, setOrgMembership] = useState<
    "standalone" | "org" | "unknown"
  >(mode === "org_admin" ? "standalone" : "unknown")
  const [actionBusy, setActionBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [checkoutBanner, setCheckoutBanner] = useState<"success" | "cancelled" | null>(
    null,
  )
  const [activating, setActivating] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const checkout = params.get("checkout")
    if (checkout === "success") {
      setCheckoutBanner("success")
      setActivating(true)
    } else if (checkout === "cancelled") {
      setCheckoutBanner("cancelled")
    }

    if (checkout === "success" || checkout === "cancelled") {
      params.delete("checkout")
      const qs = params.toString()
      const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`
      window.history.replaceState(null, "", next)
    }
  }, [])

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) {
      setAccountLoadState("loading")
      setErrorMsg(null)
    }

    try {
      if (mode === "manager") {
        const labId = await resolveCurrentUserLabId()
        if (!labId) {
          if (!opts?.quiet) setErrorMsg("Could not resolve lab context.")
          setAccountLoadState("unknown")
          setBillingStatus(null)
          setOrgMembership("unknown")
          return
        }

        // No lab_id filter — RLS scopes to this lab's row OR the org's row.
        const [
          { data: accounts, error: accountError },
          { data: lab, error: labError },
        ] = await Promise.all([
          supabase
            .from("billing_accounts")
            .select("id, lab_id, org_id, billing_status, current_period_end"),
          supabase
            .from("labs")
            .select("trial_ends_at, org_id")
            .eq("id", labId)
            .maybeSingle(),
        ])

        if (labError || !lab) {
          // Fail closed on purchase controls; lab.org_id is the org-membership signal.
          setOrgMembership("unknown")
          setTrialEndsAt(null)
        } else {
          setOrgMembership(lab.org_id == null ? "standalone" : "org")
          setTrialEndsAt(
            typeof lab.trial_ends_at === "string" ? lab.trial_ends_at : null,
          )
        }

        if (accountError) {
          console.error("[billing-panel] billing_accounts read failed:", accountError.message)
          setAccountLoadState("unknown")
          setBillingStatus(null)
          setCurrentPeriodEnd(null)
        } else if (!accounts || accounts.length === 0) {
          setAccountLoadState("none")
          setBillingStatus(null)
          setCurrentPeriodEnd(null)
        } else {
          const account = pickBillingAccount(accounts as BillingAccountRow[])
          setAccountLoadState("resolved")
          setBillingStatus(
            typeof account.billing_status === "string" ? account.billing_status : null,
          )
          setCurrentPeriodEnd(
            typeof account.current_period_end === "string"
              ? account.current_period_end
              : null,
          )
        }
        setLabCount(1)
      } else {
        if (!orgId) {
          if (!opts?.quiet) setErrorMsg("Could not resolve organization context.")
          setAccountLoadState("unknown")
          setBillingStatus(null)
          return
        }

        const [
          { data: account, error: accountError },
          { data: org, error: orgError },
          { count, error: countError },
        ] = await Promise.all([
          supabase
            .from("billing_accounts")
            .select("id, lab_id, org_id, billing_status, current_period_end")
            .eq("org_id", orgId)
            .maybeSingle(),
          supabase
            .from("organizations")
            .select("trial_ends_at")
            .eq("id", orgId)
            .maybeSingle(),
          supabase
            .from("labs")
            .select("id", { count: "exact", head: true })
            .eq("org_id", orgId)
            .eq("is_archived", false),
        ])

        if (accountError) {
          console.error("[billing-panel] billing_accounts read failed:", accountError.message)
          setAccountLoadState("unknown")
          setBillingStatus(null)
          setCurrentPeriodEnd(null)
        } else if (!account) {
          setAccountLoadState("none")
          setBillingStatus(null)
          setCurrentPeriodEnd(null)
        } else {
          setAccountLoadState("resolved")
          setBillingStatus(
            typeof account.billing_status === "string" ? account.billing_status : null,
          )
          setCurrentPeriodEnd(
            typeof account.current_period_end === "string"
              ? account.current_period_end
              : null,
          )
        }

        if (orgError) {
          console.error("[billing-panel] organizations read failed:", orgError.message)
          setTrialEndsAt(null)
        } else {
          setTrialEndsAt(
            typeof org?.trial_ends_at === "string" ? org.trial_ends_at : null,
          )
        }

        if (countError) {
          console.error("[billing-panel] lab count failed:", countError.message)
          setLabCount(0)
        } else {
          setLabCount(count ?? 0)
        }

        setOrgMembership("standalone")
      }
    } catch (err) {
      console.error("[billing-panel] unexpected load error:", err)
      if (!opts?.quiet) setErrorMsg("Could not load billing information.")
      setAccountLoadState("unknown")
      setBillingStatus(null)
      if (mode === "manager") setOrgMembership("unknown")
    }
  }, [mode, orgId])

  useEffect(() => {
    void load()
  }, [load])

  // After Checkout success: wait ~3s for webhook, then refetch once.
  useEffect(() => {
    if (!activating) return
    const timer = setTimeout(() => {
      void (async () => {
        await load({ quiet: true })
        setActivating(false)
      })()
    }, 3000)
    return () => clearTimeout(timer)
  }, [activating, load])

  const handleCheckout = async () => {
    setErrorMsg(null)
    setActionBusy(true)
    const result = await createCheckoutSession()
    setActionBusy(false)

    if (!result.ok) {
      setErrorMsg(createCheckoutErrorMessage(result.errorCode))
      return
    }

    window.location.href = result.url
  }

  const handlePortal = async () => {
    setErrorMsg(null)
    setActionBusy(true)
    const result = await createBillingPortalSession()
    setActionBusy(false)

    if (!result.ok) {
      setErrorMsg(createBillingPortalErrorMessage(result.errorCode))
      return
    }

    window.location.href = result.url
  }

  const daysLeft = daysUntil(trialEndsAt)
  const monthlyTotal = labCount * 200
  const renewalDate = formatRenewalDate(currentPeriodEnd)
  // org_admin always manages; manager only when labs.org_id is positively NULL.
  const canManageBilling =
    mode === "org_admin" || orgMembership === "standalone"

  // Display status: only invent "trialing" for a positive empty read ("none").
  const displayStatus =
    accountLoadState === "resolved"
      ? billingStatus
      : accountLoadState === "none"
        ? "trialing"
        : null
  const isActive = displayStatus === "active"
  const showActivatingCta =
    canManageBilling && activating && !isActive && accountLoadState !== "unknown"
  const showCheckout =
    canManageBilling &&
    !activating &&
    (accountLoadState === "none" ||
      (accountLoadState === "resolved" && billingStatus === "trialing"))
  const showPortal =
    canManageBilling &&
    !activating &&
    accountLoadState === "resolved" &&
    (billingStatus === "active" ||
      billingStatus === "past_due" ||
      billingStatus === "suspended")
  // Only show the org-managed notice when we positively know this is an org lab.
  const showOrgManagedNotice =
    mode === "manager" &&
    orgMembership === "org" &&
    accountLoadState !== "loading" &&
    accountLoadState !== "unknown"

  const portalCta =
    billingStatus === "past_due"
      ? { label: "Update payment method", className: BTN_AMBER }
      : billingStatus === "suspended"
        ? { label: "Reactivate subscription", className: BTN_RED }
        : { label: "Manage billing", className: BTN_PRIMARY }

  return (
    <div className="space-y-6">
      {checkoutBanner === "success" && !isActive ? (
        <p
          role="status"
          className="text-sm font-medium rounded-xl border border-green-500/30 bg-green-500/10 text-green-800 dark:text-green-300 px-4 py-3"
        >
          Payment received — your subscription is being activated.
        </p>
      ) : null}
      {checkoutBanner === "cancelled" ? (
        <p
          role="status"
          className="text-sm font-medium rounded-xl border border-border bg-muted/40 text-muted-foreground px-4 py-3"
        >
          Checkout cancelled — no charge was made.
        </p>
      ) : null}

      <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10">
            <CreditCard className="size-5 text-primary" aria-hidden />
          </div>
          <div>
            <h2 className="text-lg font-bold">Billing</h2>
            <p className="text-xs text-muted-foreground">
              Subscription status for this {mode === "manager" ? "lab" : "organization"}.
            </p>
          </div>
        </div>

        {accountLoadState === "loading" ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 text-muted-foreground animate-spin" aria-hidden />
          </div>
        ) : accountLoadState === "unknown" ? (
          <p className="text-sm text-muted-foreground font-medium">
            Plan status unavailable
          </p>
        ) : (
          <>
            {/* Information — status / price / renewal. Never gated on canManageBilling. */}
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold ${statusBadgeClass(displayStatus ?? "")}`}
              >
                {displayStatus === "trialing"
                  ? "Trial"
                  : displayStatus === "active"
                    ? "Active"
                    : displayStatus === "past_due"
                      ? "Payment issue"
                      : displayStatus === "suspended"
                        ? "Suspended — read-only"
                        : displayStatus ?? "—"}
              </span>
              {displayStatus === "trialing" && daysLeft !== null ? (
                <span className="text-sm text-muted-foreground font-medium">
                  {daysLeft} day{daysLeft === 1 ? "" : "s"} remaining
                </span>
              ) : null}
            </div>

            <div className="space-y-1">
              {displayStatus === "trialing" || isActive ? (
                mode === "org_admin" ? (
                  <p className="text-sm font-medium text-foreground">
                    {labCount} lab{labCount === 1 ? "" : "s"} × $200 = $
                    {formatUsd(monthlyTotal)}/month
                  </p>
                ) : (
                  <p className="text-sm font-medium text-foreground">
                    $200/lab/month
                  </p>
                )
              ) : null}
              {renewalDate ? (
                <p className="text-xs text-muted-foreground">
                  Renews {renewalDate}
                </p>
              ) : null}
            </div>

            {errorMsg ? (
              <p
                role="alert"
                className="text-sm font-medium rounded-xl border border-destructive/30 bg-destructive/10 text-destructive px-4 py-3"
              >
                {errorMsg}
              </p>
            ) : null}

            {/* Actions — purchase / portal only. Org-lab staff get copy, never CTAs. */}
            {showOrgManagedNotice ? (
              <p className="text-sm text-muted-foreground font-medium">
                {ORG_MANAGED_COPY}
              </p>
            ) : showActivatingCta ? (
              <button
                type="button"
                disabled
                className="h-11 px-6 rounded-xl border border-border bg-muted/40 text-muted-foreground font-bold text-sm opacity-70 cursor-not-allowed inline-flex items-center justify-center gap-2"
              >
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Payment received — activating…
              </button>
            ) : showCheckout ? (
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => void handleCheckout()}
                className={BTN_PRIMARY}
              >
                {actionBusy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : null}
                Upgrade
              </button>
            ) : showPortal ? (
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => void handlePortal()}
                className={portalCta.className}
              >
                {actionBusy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : null}
                {portalCta.label}
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
