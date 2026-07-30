"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  Package,
  ClipboardList,
  Settings,
  PackageOpen,
  Activity,
  BarChart3,
  Network,
  Shield,
  ShieldCheck,
  ShieldAlert,
  CreditCard,
} from "lucide-react"
import { SidebarPage, resolveCurrentUserLabId } from "@/lib/inventory-utils"
import { supabase } from "@/lib/supabase"
import Image from "next/image"

interface DashboardSidebarProps {
  activePage: SidebarPage
  setActivePage: (page: SidebarPage) => void
  isMobileOpen: boolean
  onMobileClose: () => void
  /** When true, show internal link to the super-admin control panel (never for manager/technician). */
  showSuperAdminLink?: boolean
  userRole?: "manager" | "technician"
}

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null
  const end = new Date(iso)
  if (Number.isNaN(end.getTime())) return null
  const ms = end.getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)))
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

type BillingAccountRow = {
  id: string
  lab_id: string | null
  org_id: string | null
  billing_status: string
  current_period_end: string | null
}

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

/** Shared Lab License box for manager and technician. */
function LabLicenseCard() {
  // Start empty — never flash "Trial" while a paid org plan is still loading.
  const [line, setLine] = useState<string>("")

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      const labId = await resolveCurrentUserLabId()
      if (!labId || cancelled) {
        if (!cancelled) setLine("Plan status unavailable")
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
          .select("trial_ends_at")
          .eq("id", labId)
          .maybeSingle(),
      ])

      if (cancelled) return

      if (accountError) {
        console.error("[LabLicenseCard] billing_accounts read failed:", accountError.message)
        setLine("Plan status unavailable")
        return
      }

      const trialEndsAt =
        !labError && typeof lab?.trial_ends_at === "string" ? lab.trial_ends_at : null

      if (!accounts || accounts.length === 0) {
        // Positive empty read — genuine pre-purchase trial UI.
        const n = daysUntil(trialEndsAt)
        setLine(n !== null ? `Trial · ${n} day${n === 1 ? "" : "s"} left` : "Trial")
        return
      }

      const account = pickBillingAccount(accounts as BillingAccountRow[])
      const status =
        typeof account.billing_status === "string" ? account.billing_status : null
      const periodEnd =
        typeof account.current_period_end === "string"
          ? account.current_period_end
          : null

      if (status === "active") {
        const renews = formatRenewalDate(periodEnd)
        setLine(renews ? `Standard plan · Renews ${renews}` : "Standard plan")
        return
      }

      if (status === "past_due") {
        setLine("Payment issue")
        return
      }

      if (status === "suspended") {
        setLine("Suspended")
        return
      }

      if (status === "trialing") {
        const n = daysUntil(trialEndsAt)
        setLine(n !== null ? `Trial · ${n} day${n === 1 ? "" : "s"} left` : "Trial")
        return
      }

      setLine("Plan status unavailable")
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="hidden border-t border-border p-4 xl:block">
      <div className="rounded-2xl bg-muted/50 p-4">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
          Lab License
        </p>
        <p className="mt-1 text-sm font-black text-foreground">{line || "…"}</p>
      </div>
    </div>
  )
}

export function DashboardSidebar({ activePage, setActivePage, isMobileOpen, onMobileClose, showSuperAdminLink = false, userRole }: DashboardSidebarProps) {
  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "inventory", label: "Inventory", icon: Package },
    { id: "lotinuse", label: "Lot in Use", icon: PackageOpen },
    { id: "requests", label: "Requests", icon: ClipboardList },
    { id: "activitylog", label: "Activity Log", icon: Activity },
    ...(userRole === "manager" ? [{ id: "validation", label: "Validation & COA", icon: ShieldCheck }] : []),
    ...(userRole === "manager" ? [{ id: "securitylog", label: "Security Log", icon: ShieldAlert }] : []),
    ...(userRole === "manager" ? [{ id: "billing", label: "Billing", icon: CreditCard }] : []),
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "labsharing", label: "Lab Sharing", icon: Network },
    { id: "settings", label: "Settings", icon: Settings },
  ]

  const showLicense =
    userRole === "manager" || userRole === "technician"

  return (
    <>
      {isMobileOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={onMobileClose}
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
        />
      )}
      <aside className={`fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-border bg-card transition-all duration-300 w-64 lg:w-16 xl:w-64 lg:translate-x-0 ${isMobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex h-16 items-center justify-center border-b border-border xl:justify-start xl:px-6">
        <Image src="/buddy-logo.png" alt="Buddy Logo" width={40} height={40} className="h-10 w-auto object-contain" priority />
      </div>
      <nav className="flex-1 space-y-1 p-4 overflow-y-auto">
        {navItems.map((item) => (
          <button
            key={item.id}
            title={item.label}
            onClick={() => { setActivePage(item.id as SidebarPage); onMobileClose(); }}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold transition-all lg:justify-center lg:px-2 xl:justify-start xl:px-4",
              activePage === item.id
                ? "bg-primary/10 text-primary shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <item.icon className="h-5 w-5" />
            <span className="block lg:hidden xl:block">{item.label}</span>
          </button>
        ))}

        {showSuperAdminLink ? (
          <>
            <div className="my-2 border-t border-border" aria-hidden />
            <Link
              href="/super-admin"
              title="Admin Panel"
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold transition-all lg:justify-center lg:px-2 xl:justify-start xl:px-4",
                "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Shield className="h-5 w-5 shrink-0" />
              <span className="block lg:hidden xl:block">Admin Panel</span>
            </Link>
          </>
        ) : null}
      </nav>
      {showLicense ? <LabLicenseCard /> : null}
      </aside>
    </>
  )
}
