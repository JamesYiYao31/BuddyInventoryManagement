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

function formatRenewalDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" })
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

const BTN_PRIMARY =
  "h-11 px-6 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-sm hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none inline-flex items-center justify-center gap-2"
const BTN_AMBER =
  "h-11 px-6 rounded-xl bg-amber-600 text-white font-bold text-sm shadow-sm hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none inline-flex items-center justify-center gap-2"
const BTN_RED =
  "h-11 px-6 rounded-xl bg-red-600 text-white font-bold text-sm shadow-sm hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none inline-flex items-center justify-center gap-2"

export function BillingPanel({ mode, orgId }: BillingPanelProps) {
  const [loading, setLoading] = useState(true)
  const [billingStatus, setBillingStatus] = useState<string>("trialing")
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null)
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null)
  const [labCount, setLabCount] = useState(1)
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
      setLoading(true)
      setErrorMsg(null)
    }

    try {
      if (mode === "manager") {
        const labId = await resolveCurrentUserLabId()
        if (!labId) {
          if (!opts?.quiet) setErrorMsg("Could not resolve lab context.")
          setLoading(false)
          return
        }

        const [{ data: account }, { data: lab }] = await Promise.all([
          supabase
            .from("billing_accounts")
            .select("billing_status, current_period_end")
            .eq("lab_id", labId)
            .maybeSingle(),
          supabase
            .from("labs")
            .select("trial_ends_at")
            .eq("id", labId)
            .maybeSingle(),
        ])

        setBillingStatus(
          typeof account?.billing_status === "string"
            ? account.billing_status
            : "trialing",
        )
        setCurrentPeriodEnd(
          typeof account?.current_period_end === "string"
            ? account.current_period_end
            : null,
        )
        setTrialEndsAt(
          typeof lab?.trial_ends_at === "string" ? lab.trial_ends_at : null,
        )
        setLabCount(1)
      } else {
        if (!orgId) {
          if (!opts?.quiet) setErrorMsg("Could not resolve organization context.")
          setLoading(false)
          return
        }

        const [{ data: account }, { data: org }, { count }] = await Promise.all([
          supabase
            .from("billing_accounts")
            .select("billing_status, current_period_end")
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

        setBillingStatus(
          typeof account?.billing_status === "string"
            ? account.billing_status
            : "trialing",
        )
        setCurrentPeriodEnd(
          typeof account?.current_period_end === "string"
            ? account.current_period_end
            : null,
        )
        setTrialEndsAt(
          typeof org?.trial_ends_at === "string" ? org.trial_ends_at : null,
        )
        setLabCount(count ?? 0)
      }
    } catch {
      if (!opts?.quiet) setErrorMsg("Could not load billing information.")
    } finally {
      setLoading(false)
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
  const isActive = billingStatus === "active"
  // Branch CTAs on billing_status only — stripe_customer_id is not client-readable.
  const showActivatingCta = activating && !isActive
  const showCheckout = !activating && billingStatus === "trialing"
  const showPortal =
    !activating &&
    (billingStatus === "active" ||
      billingStatus === "past_due" ||
      billingStatus === "suspended")

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

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 text-muted-foreground animate-spin" aria-hidden />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold ${statusBadgeClass(billingStatus)}`}
              >
                {billingStatus === "trialing"
                  ? "Trial"
                  : billingStatus === "active"
                    ? "Active · $200/lab/month"
                    : billingStatus === "past_due"
                      ? "Payment issue"
                      : billingStatus === "suspended"
                        ? "Suspended — read-only"
                        : billingStatus}
              </span>
              {billingStatus === "trialing" && daysLeft !== null ? (
                <span className="text-sm text-muted-foreground font-medium">
                  {daysLeft} day{daysLeft === 1 ? "" : "s"} remaining
                </span>
              ) : null}
            </div>

            {isActive ? (
              <div className="space-y-1">
                {renewalDate ? (
                  <p className="text-xs text-muted-foreground">
                    Renews {renewalDate}
                  </p>
                ) : null}
                {mode === "org_admin" ? (
                  <p className="text-xs text-muted-foreground">
                    {labCount} lab{labCount === 1 ? "" : "s"} × $200 = $
                    {formatUsd(monthlyTotal)}/month
                  </p>
                ) : null}
              </div>
            ) : billingStatus === "trialing" ? (
              mode === "org_admin" ? (
                <p className="text-sm font-medium text-foreground">
                  {labCount} lab{labCount === 1 ? "" : "s"} × $200 = $
                  {formatUsd(monthlyTotal)}/month
                </p>
              ) : (
                <p className="text-sm font-medium text-foreground">$200/month</p>
              )
            ) : null}

            {errorMsg ? (
              <p
                role="alert"
                className="text-sm font-medium rounded-xl border border-destructive/30 bg-destructive/10 text-destructive px-4 py-3"
              >
                {errorMsg}
              </p>
            ) : null}

            {showActivatingCta ? (
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
