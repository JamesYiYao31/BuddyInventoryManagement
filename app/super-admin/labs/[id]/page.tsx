"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  Loader2,
  FlaskConical,
  ArrowLeft,
  ChevronRight,
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import { resolveMfaGateRedirect } from "@/lib/mfa-gate"

// ─── Types ───────────────────────────────────────────────────────────────────

type LabDetail = {
  id: string
  name: string
  created_at: string
  is_archived: boolean
  archived_at: string | null
  org_id: string | null
  tech_key: string | null
  trial_starts_at: string | null
  trial_ends_at: string | null
}

type LabSettings = {
  lab_id: string
  urgent_days: number | null
  expiring_soon_days: number | null
  low_stock_threshold: number | null
  lab_timezone: string | null
  require_coa_approval: boolean | null
  techs_can_edit_thresholds: boolean | null
  onboarding_complete: boolean | null
  audit_log_retention_years: number | null
}

type MemberRow = {
  id: string
  full_name: string | null
  role: string
  created_at: string | null
}

type OrgDetail = {
  id: string
  name: string
  plan: string
  created_at: string
  trial_ends_at: string | null
}

type InviteRow = {
  id: string
  token: string
  role: string | null
  used: boolean
  created_at: string
  revoked_at: string | null
  created_by: string | null
}

type ActiveTab = "overview" | "members" | "billing" | "invites"

type Toast = { kind: "success" | "error"; text: string } | null

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    })
  } catch {
    return iso
  }
}

function formatDateOnly(iso: string | null | undefined): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium" })
  } catch {
    return iso
  }
}

function computeTrialInfo(org: OrgDetail) {
  const now = new Date()
  const trialEnd = org.trial_ends_at
    ? new Date(org.trial_ends_at)
    : new Date(new Date(org.created_at).getTime() + 90 * 86400000)
  const daysRemaining = Math.max(
    0,
    Math.ceil((trialEnd.getTime() - now.getTime()) / 86400000)
  )
  const elapsed = Math.max(0, 90 - daysRemaining)
  const pct = Math.min(100, Math.max(0, (elapsed / 90) * 100))
  return { trialEnd, daysRemaining, pct }
}

function computeLabTrialInfo(lab: LabDetail) {
  const now = new Date()
  const trialEnd = lab.trial_ends_at
    ? new Date(lab.trial_ends_at)
    : new Date(new Date(lab.created_at).getTime() + 90 * 86400000)
  const trialStart = lab.trial_starts_at
    ? new Date(lab.trial_starts_at)
    : new Date(lab.created_at)
  const daysRemaining = Math.max(
    0,
    Math.ceil((trialEnd.getTime() - now.getTime()) / 86400000)
  )
  const elapsed = Math.max(0, 90 - daysRemaining)
  const pct = Math.min(100, Math.max(0, (elapsed / 90) * 100))
  return { trialEnd, trialStart, daysRemaining, pct }
}

function generateTechKey(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  const arr = new Uint8Array(8)
  crypto.getRandomValues(arr)
  return Array.from(arr)
    .map((b) => chars[b % chars.length])
    .join("")
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ToastBanner({
  toast,
  onDismiss,
}: {
  toast: Toast
  onDismiss: () => void
}) {
  if (!toast) return null
  const cls =
    toast.kind === "success"
      ? "bg-green-500/10 border-green-500/20 text-green-700 dark:text-green-400"
      : "bg-destructive/10 border-destructive/20 text-destructive"
  return (
    <div
      className={`fixed top-5 right-5 z-50 max-w-sm rounded-xl border px-5 py-3 text-sm font-medium shadow-lg ${cls}`}
    >
      <div className="flex items-center gap-3">
        <span className="flex-1">{toast.text}</span>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="shrink-0 opacity-60 hover:opacity-100 text-lg leading-none"
        >
          ×
        </button>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LabDetailPage() {
  const router = useRouter()
  const params = useParams()
  const labId = params.id as string

  // Gate
  const [gateLoading, setGateLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  // Data
  const [lab, setLab] = useState<LabDetail | null>(null)
  const [settings, setSettings] = useState<LabSettings | null>(null)
  const [org, setOrg] = useState<OrgDetail | null>(null)
  const [members, setMembers] = useState<MemberRow[]>([])
  const [invites, setInvites] = useState<InviteRow[]>([])
  const [creatorNameById, setCreatorNameById] = useState<
    Record<string, string>
  >({})

  // Loading states
  const [dataLoading, setDataLoading] = useState(true)
  const [membersLoading, setMembersLoading] = useState(false)
  const [invitesLoading, setInvitesLoading] = useState(false)

  // UI
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview")
  const [toast, setToast] = useState<Toast>(null)

  // Edit role modal
  const [editRoleMember, setEditRoleMember] = useState<MemberRow | null>(null)
  const [editRoleValue, setEditRoleValue] = useState("")
  const [editRoleBusy, setEditRoleBusy] = useState(false)

  // Revoke invite modal
  const [revokeInvite, setRevokeInvite] = useState<InviteRow | null>(null)
  const [revokeBusy, setRevokeBusy] = useState(false)

  // Tech key
  const [techKeyBusy, setTechKeyBusy] = useState(false)

  // Billing extend busy
  const [extendBusy, setExtendBusy] = useState(false)

  // Audit log retention
  const [retentionInput, setRetentionInput] = useState<string>("3")
  const [retentionBusy, setRetentionBusy] = useState(false)
  const [retentionError, setRetentionError] = useState<string | null>(null)

  // ── Toast helpers ──────────────────────────────────────────────────────────

  function showToast(kind: "success" | "error", text: string) {
    setToast({ kind, text })
    setTimeout(() => setToast(null), 4000)
  }

  // ── Auth gate ──────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setGateLoading(true)
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.user) {
        if (!cancelled) router.replace("/dashboard")
        return
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .maybeSingle()

      if (cancelled) return

      if (profile?.role !== "super_admin") {
        router.replace("/dashboard")
        return
      }

      const mfaRedirect = await resolveMfaGateRedirect("/super-admin")
      if (mfaRedirect) {
        if (!cancelled) router.replace(mfaRedirect)
        return
      }

      setCurrentUserId(session.user.id)
      setAuthorized(true)
      setGateLoading(false)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [router])

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchLab = useCallback(async () => {
    const { data, error } = await supabase
      .from("labs")
      .select("id, name, created_at, is_archived, archived_at, org_id, tech_key, trial_starts_at, trial_ends_at")
      .eq("id", labId)
      .maybeSingle()

    if (error || !data) {
      showToast("error", "Could not load lab.")
      return
    }
    const labData = data as LabDetail
    setLab(labData)

    if (labData.org_id) {
      const { data: orgData } = await supabase
        .from("organizations")
        .select("id, name, plan, created_at, trial_ends_at")
        .eq("id", labData.org_id)
        .maybeSingle()
      setOrg(orgData as OrgDetail | null)
    }
  }, [labId])

  const fetchSettings = useCallback(async () => {
    const { data } = await supabase
      .from("lab_settings")
      .select("*")
      .eq("lab_id", labId)
      .maybeSingle()
    const settingsData = data as LabSettings | null
    setSettings(settingsData)
    if (settingsData?.audit_log_retention_years != null) {
      setRetentionInput(String(settingsData.audit_log_retention_years))
    }
  }, [labId])

  const fetchMembers = useCallback(async () => {
    setMembersLoading(true)
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, role, created_at")
      .eq("lab_id", labId)
      .order("full_name")
    setMembers((data as MemberRow[]) || [])
    setMembersLoading(false)
  }, [labId])

  const fetchInvites = useCallback(async () => {
    setInvitesLoading(true)
    const { data } = await supabase
      .from("lab_invites")
      .select("id, token, role, used, created_at, revoked_at, created_by")
      .eq("lab_id", labId)
      .order("created_at", { ascending: false })

    const rows = (data as InviteRow[]) || []
    setInvites(rows)

    const ids = [
      ...new Set(rows.map((r) => r.created_by).filter(Boolean)),
    ] as string[]
    if (ids.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", ids)
      const map: Record<string, string> = {}
      for (const p of profs || []) {
        if (p.id) map[p.id] = (p as { id: string; full_name: string | null }).full_name || "Unknown"
      }
      setCreatorNameById(map)
    }
    setInvitesLoading(false)
  }, [labId])

  useEffect(() => {
    if (!authorized) return
    const run = async () => {
      setDataLoading(true)
      await Promise.all([fetchLab(), fetchSettings(), fetchMembers(), fetchInvites()])
      setDataLoading(false)
    }
    void run()
  }, [authorized, fetchLab, fetchSettings, fetchMembers, fetchInvites])

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleResetTechKey = async () => {
    if (!lab) return
    setTechKeyBusy(true)
    const newKey = generateTechKey()
    const { error } = await supabase
      .from("labs")
      .update({ tech_key: newKey })
      .eq("id", labId)
    setTechKeyBusy(false)

    if (error) {
      if (error.code === "23505") {
        showToast("error", "Key already exists, try again.")
      } else {
        showToast("error", error.message)
      }
      return
    }
    setLab((prev) => (prev ? { ...prev, tech_key: newKey } : prev))
    showToast("success", "Tech key reset successfully.")
  }

  const handleSaveRetention = async () => {
    setRetentionError(null)
    const parsed = parseInt(retentionInput, 10)
    if (isNaN(parsed) || parsed < 1 || parsed > 10) {
      setRetentionError("Must be a whole number between 1 and 10.")
      return
    }
    setRetentionBusy(true)
    const { error } = await supabase
      .from("lab_settings")
      .update({ audit_log_retention_years: parsed })
      .eq("lab_id", labId)
    setRetentionBusy(false)
    if (error) {
      setRetentionError(error.message)
      return
    }
    setSettings((prev) => (prev ? { ...prev, audit_log_retention_years: parsed } : prev))
    showToast("success", `Audit log retention updated to ${parsed} ${parsed === 1 ? "year" : "years"}.`)
  }

  const handleEditRoleConfirm = async () => {
    if (!editRoleMember || !editRoleValue) return
    setEditRoleBusy(true)
    const { error } = await supabase
      .from("profiles")
      .update({ role: editRoleValue })
      .eq("id", editRoleMember.id)
    setEditRoleBusy(false)

    if (error) {
      showToast("error", error.message)
      return
    }
    setEditRoleMember(null)
    showToast("success", "Role updated. Change takes effect on next login.")
    await fetchMembers()
  }

  const handleRevokeConfirm = async () => {
    if (!revokeInvite || !currentUserId) return
    setRevokeBusy(true)
    const { error } = await supabase
      .from("lab_invites")
      .update({ revoked_at: new Date().toISOString(), revoked_by: currentUserId })
      .eq("id", revokeInvite.id)
    setRevokeBusy(false)

    if (error) {
      showToast("error", error.message)
      return
    }
    setRevokeInvite(null)
    showToast("success", "Invite revoked.")
    await fetchInvites()
  }

  const handleExtendTrial = async (days: number) => {
    if (!org) return
    setExtendBusy(true)
    const base = org.trial_ends_at ? new Date(org.trial_ends_at) : new Date()
    const newDate = new Date(base.getTime() + days * 86400000)
    const { error } = await supabase
      .from("organizations")
      .update({ trial_ends_at: newDate.toISOString() })
      .eq("id", org.id)
    setExtendBusy(false)

    if (error) {
      showToast("error", error.message)
      return
    }
    setOrg((prev) => (prev ? { ...prev, trial_ends_at: newDate.toISOString() } : prev))
    showToast("success", `Trial extended by ${days} days.`)
  }

  // ── Gate loading ───────────────────────────────────────────────────────────

  if (gateLoading || !authorized) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
        <Loader2 className="size-10 text-primary animate-spin" aria-hidden />
        <p className="text-sm font-medium text-muted-foreground">
          Verifying access...
        </p>
      </div>
    )
  }

  // ── Trial info ─────────────────────────────────────────────────────────────

  const trialInfo = org ? computeTrialInfo(org) : null
  const daysRemainingColor =
    trialInfo && trialInfo.daysRemaining > 30
      ? "text-green-700 dark:text-green-400"
      : trialInfo && trialInfo.daysRemaining > 10
      ? "text-amber-700 dark:text-amber-400"
      : "text-red-700 dark:text-red-400"

  const progressColor =
    trialInfo && trialInfo.daysRemaining > 30
      ? "bg-green-500"
      : trialInfo && trialInfo.daysRemaining > 10
      ? "bg-amber-500"
      : "bg-red-500"

  const planBadgeClass =
    org?.plan === "trial"
      ? "bg-amber-500/15 text-amber-800 dark:text-amber-400"
      : org?.plan === "starter"
      ? "bg-sky-500/15 text-sky-800 dark:text-sky-300"
      : org?.plan === "pro"
      ? "bg-violet-500/15 text-violet-800 dark:text-violet-300"
      : "bg-indigo-500/15 text-indigo-800 dark:text-indigo-300"

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />

      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center gap-4">
          <button
            type="button"
            aria-label="Back to super admin"
            onClick={() => router.push("/super-admin")}
            className="shrink-0 size-9 rounded-lg border border-border flex items-center justify-center hover:bg-muted/50"
          >
            <ArrowLeft className="size-4" />
          </button>

          <div className="p-2.5 rounded-xl bg-primary/10 shrink-0">
            <FlaskConical className="size-5 text-primary" aria-hidden />
          </div>

          {dataLoading ? (
            <div className="h-7 w-48 rounded-lg bg-muted/60 animate-pulse" />
          ) : (
            <div className="flex items-center gap-3 flex-wrap min-w-0">
              <h1 className="text-xl font-black tracking-tight truncate">
                {lab?.name ?? "Lab"}
              </h1>
              {lab?.org_id ? (
                <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-500/15 text-violet-800 dark:text-violet-300">
                  Org Lab
                </span>
              ) : (
                <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/15 text-sky-800 dark:text-sky-300">
                  Single
                </span>
              )}
              {lab?.is_archived ? (
                <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-500/15 text-zinc-600 dark:text-zinc-400">
                  Archived
                </span>
              ) : (
                <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-500/15 text-green-700 dark:text-green-400">
                  Active
                </span>
              )}
              {lab?.created_at && (
                <span className="text-xs text-muted-foreground">
                  Created {formatDateOnly(lab.created_at)}
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        {/* Tab bar */}
        <div className="flex p-1.5 bg-muted/40 rounded-2xl border border-border gap-1">
          {(["overview", "members", "billing", "invites"] as ActiveTab[]).map(
            (tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`flex-1 h-9 rounded-xl text-xs font-bold capitalize transition-colors ${
                  activeTab === tab
                    ? "bg-card shadow-sm text-foreground border border-border"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab}
              </button>
            )
          )}
        </div>

        {/* Tab content */}
        {dataLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-7 text-muted-foreground animate-spin" />
          </div>
        ) : (
          <>
            {/* ── Overview ── */}
            {activeTab === "overview" && (
              <div className="space-y-6">
                {/* Lab Settings card */}
                <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Lab Settings
                  </p>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                    {(
                      [
                        ["Timezone", settings?.lab_timezone ?? "—"],
                        ["Urgent Days", settings?.urgent_days != null ? String(settings.urgent_days) : "—"],
                        ["Expiring Soon Days", settings?.expiring_soon_days != null ? String(settings.expiring_soon_days) : "—"],
                        ["Low Stock Threshold", settings?.low_stock_threshold != null ? String(settings.low_stock_threshold) : "—"],
                        ["Require COA Approval", settings?.require_coa_approval != null ? (settings.require_coa_approval ? "Yes" : "No") : "—"],
                        ["Techs Can Edit Thresholds", settings?.techs_can_edit_thresholds != null ? (settings.techs_can_edit_thresholds ? "Yes" : "No") : "—"],
                        ["Onboarding Complete", settings?.onboarding_complete != null ? (settings.onboarding_complete ? "Yes" : "No") : "—"],
                      ] as [string, string][]
                    ).map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          {label}
                        </dt>
                        <dd className="mt-1 text-sm font-medium">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>

                {/* Tech Key card */}
                <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Tech Key
                  </p>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <code className="font-mono bg-muted/40 border border-border rounded-xl px-4 py-2 tracking-widest text-lg font-bold flex-1 text-center sm:text-left">
                      {lab?.tech_key ?? "—"}
                    </code>
                    <button
                      type="button"
                      disabled={techKeyBusy}
                      onClick={() => void handleResetTechKey()}
                      className="h-9 px-4 rounded-xl border border-border text-xs font-bold hover:bg-muted/50 disabled:opacity-50 disabled:pointer-events-none inline-flex items-center justify-center gap-2"
                    >
                      {techKeyBusy && (
                        <Loader2 className="size-3.5 animate-spin" />
                      )}
                      Reset Tech Key
                    </button>
                  </div>
                </div>

                {/* Audit Log Retention card */}
                <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Audit Log Retention
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    How long activity logs, COA records, and lot validation documents are retained for this lab. Default is 3 years (matches COA records policy and 21 CFR Part 11 requirements). Range: 1-10 years.
                  </p>
                  <div className="flex flex-col sm:flex-row sm:items-end gap-4">
                    <div className="flex-1 space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Years
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={retentionInput}
                        onChange={(e) => {
                          setRetentionInput(e.target.value)
                          setRetentionError(null)
                        }}
                        className="w-full h-11 border border-input bg-background rounded-xl px-4 text-base font-bold outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={retentionBusy || retentionInput === String(settings?.audit_log_retention_years ?? 3)}
                      onClick={() => void handleSaveRetention()}
                      className="h-11 px-5 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none inline-flex items-center justify-center gap-2"
                    >
                      {retentionBusy && <Loader2 className="size-3.5 animate-spin" />}
                      Save Retention
                    </button>
                  </div>
                  {retentionError && (
                    <p className="text-xs text-destructive">{retentionError}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground italic">
                    Changes take effect immediately on the customer's Lab Settings page. Decreasing retention does not delete existing records — only future cleanup behavior is affected.
                  </p>
                </div>
              </div>
            )}

            {/* ── Members ── */}
            {activeTab === "members" && (
              <div className="space-y-4">
                {membersLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="size-6 text-muted-foreground animate-spin" />
                  </div>
                ) : (
                  <div className="rounded-2xl border border-border overflow-hidden">
                    <div className="hidden sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 px-6 py-3 bg-muted/30 border-b border-border text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      <span>Name</span>
                      <span>Role</span>
                      <span>Joined</span>
                      <span>Actions</span>
                    </div>

                    {members.length === 0 ? (
                      <div className="py-12 text-center text-sm text-muted-foreground italic">
                        No members yet.
                      </div>
                    ) : (
                      members.map((member) => (
                        <div
                          key={member.id}
                          className="grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 px-6 py-4 border-t border-border/60 items-center text-sm"
                        >
                          <span className="font-bold truncate">
                            {member.full_name || "—"}
                          </span>
                          <span>
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                member.role === "manager"
                                  ? "bg-sky-500/15 text-sky-800 dark:text-sky-300"
                                  : "bg-emerald-500/15 text-emerald-800 dark:text-emerald-400"
                              }`}
                            >
                              {member.role}
                            </span>
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDateOnly(member.created_at)}
                          </span>
                          <div>
                            <button
                              type="button"
                              onClick={() => {
                                setEditRoleMember(member)
                                setEditRoleValue(member.role)
                              }}
                              className="h-9 px-3 rounded-lg border border-border text-xs font-bold hover:bg-muted/50 inline-flex items-center gap-1.5"
                            >
                              <ChevronRight className="size-3.5" />
                              Edit Role
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Billing ── */}
            {activeTab === "billing" && (
              <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-6">
                {lab?.org_id && org ? (
                  <>
                    <div className="flex items-center gap-3">
                      <span
                        className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold capitalize ${planBadgeClass}`}
                      >
                        {org.plan}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {org.name}
                      </span>
                    </div>

                    <dl className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          Trial Start
                        </dt>
                        <dd className="mt-1 text-sm font-medium">
                          {formatDateOnly(org.created_at)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          Trial End
                        </dt>
                        <dd className="mt-1 text-sm font-medium">
                          {trialInfo
                            ? formatDateOnly(trialInfo.trialEnd.toISOString())
                            : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          Days Remaining
                        </dt>
                        <dd
                          className={`mt-1 text-2xl font-black ${daysRemainingColor}`}
                        >
                          {trialInfo?.daysRemaining ?? "—"}
                        </dd>
                      </div>
                    </dl>

                    {trialInfo && (
                      <div className="space-y-1.5">
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${progressColor}`}
                            style={{ width: `${trialInfo.pct}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-muted-foreground font-medium">
                          {Math.round(trialInfo.pct)}% of 90-day trial elapsed
                        </p>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        disabled={extendBusy}
                        onClick={() => void handleExtendTrial(30)}
                        className="h-9 px-4 rounded-xl border border-border text-xs font-bold hover:bg-muted/50 disabled:opacity-50 disabled:pointer-events-none inline-flex items-center gap-2"
                      >
                        {extendBusy && (
                          <Loader2 className="size-3.5 animate-spin" />
                        )}
                        +30 Days
                      </button>
                      <button
                        type="button"
                        disabled={extendBusy}
                        onClick={() => void handleExtendTrial(90)}
                        className="h-9 px-4 rounded-xl border border-border text-xs font-bold hover:bg-muted/50 disabled:opacity-50 disabled:pointer-events-none inline-flex items-center gap-2"
                      >
                        {extendBusy && (
                          <Loader2 className="size-3.5 animate-spin" />
                        )}
                        +90 Days
                      </button>
                      <button
                        type="button"
                        disabled
                        className="h-9 px-4 rounded-xl border border-border text-xs font-bold opacity-40 inline-flex items-center gap-2 cursor-not-allowed"
                      >
                        Manage Billing
                      </button>
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold bg-zinc-500/10 text-zinc-500">
                        Stripe Integration Coming Soon
                      </span>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Billing will be managed via Stripe.
                    </p>
                  </>
                ) : (
                  (() => {
                    const labTrial = computeLabTrialInfo(lab!)
                    const labDaysColor =
                      labTrial.daysRemaining > 30
                        ? "text-green-700 dark:text-green-400"
                        : labTrial.daysRemaining > 10
                        ? "text-amber-700 dark:text-amber-400"
                        : "text-red-700 dark:text-red-400"
                    const labProgressColor =
                      labTrial.daysRemaining > 30
                        ? "bg-green-500"
                        : labTrial.daysRemaining > 10
                        ? "bg-amber-500"
                        : "bg-red-500"
                    return (
                      <>
                        <div className="flex items-center gap-3">
                          <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-bold capitalize bg-amber-500/15 text-amber-800 dark:text-amber-400">
                            trial
                          </span>
                          <span className="text-sm text-muted-foreground">
                            Single Lab
                          </span>
                        </div>

                        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                          <div>
                            <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                              Trial Start
                            </dt>
                            <dd className="mt-1 text-sm font-medium">
                              {formatDateOnly(labTrial.trialStart.toISOString())}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                              Trial End
                            </dt>
                            <dd className="mt-1 text-sm font-medium">
                              {formatDateOnly(labTrial.trialEnd.toISOString())}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                              Days Remaining
                            </dt>
                            <dd className={`mt-1 text-2xl font-black ${labDaysColor}`}>
                              {labTrial.daysRemaining}
                            </dd>
                          </div>
                        </dl>

                        <div className="space-y-1.5">
                          <div className="h-2 rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${labProgressColor}`}
                              style={{ width: `${labTrial.pct}%` }}
                            />
                          </div>
                          <p className="text-[10px] text-muted-foreground font-medium">
                            {Math.round(labTrial.pct)}% of 90-day trial elapsed
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            disabled
                            className="h-9 px-4 rounded-xl border border-border text-xs font-bold opacity-40 inline-flex items-center gap-2 cursor-not-allowed"
                          >
                            Manage Billing
                          </button>
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold bg-zinc-500/10 text-zinc-500">
                            Stripe Integration Coming Soon
                          </span>
                        </div>
                      </>
                    )
                  })()
                )}
              </div>
            )}

            {/* ── Invites ── */}
            {activeTab === "invites" && (
              <div className="space-y-4">
                {invitesLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="size-6 text-muted-foreground animate-spin" />
                  </div>
                ) : (
                  <div className="rounded-2xl border border-border overflow-hidden">
                    <div className="hidden sm:grid sm:grid-cols-[minmax(0,1.5fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 px-6 py-3 bg-muted/30 border-b border-border text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      <span>Token</span>
                      <span>Role</span>
                      <span>Status</span>
                      <span>Created</span>
                      <span>Created By</span>
                      <span>Actions</span>
                    </div>

                    {invites.length === 0 ? (
                      <div className="py-12 text-center text-sm text-muted-foreground italic">
                        No invites yet.
                      </div>
                    ) : (
                      invites.map((inv) => (
                        <div
                          key={inv.id}
                          className="grid grid-cols-1 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 px-6 py-4 border-t border-border/60 items-center text-sm"
                        >
                          <code className="text-xs font-mono text-muted-foreground">
                            {inv.token.length > 8
                              ? `${inv.token.slice(0, 8)}...`
                              : inv.token}
                          </code>
                          <span>
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                inv.role === "org_admin"
                                  ? "bg-violet-500/15 text-violet-800 dark:text-violet-300"
                                  : "bg-sky-500/15 text-sky-800 dark:text-sky-300"
                              }`}
                            >
                              {inv.role === "org_admin" ? "Org Admin" : "Manager"}
                            </span>
                          </span>
                          <span>
                            {inv.revoked_at ? (
                              <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/15 text-red-800 dark:text-red-300">
                                Revoked
                              </span>
                            ) : inv.used ? (
                              <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-500/15 text-zinc-600 dark:text-zinc-400">
                                Used
                              </span>
                            ) : (
                              <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-800 dark:text-amber-400">
                                Pending
                              </span>
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground font-mono">
                            {formatDate(inv.created_at)}
                          </span>
                          <span className="text-xs text-muted-foreground truncate">
                            {inv.created_by
                              ? creatorNameById[inv.created_by] || "Unknown"
                              : "Super Admin"}
                          </span>
                          <div>
                            {!inv.revoked_at && !inv.used && (
                              <button
                                type="button"
                                onClick={() => setRevokeInvite(inv)}
                                className="h-9 px-3 rounded-lg border border-border text-xs font-bold hover:bg-muted/50 inline-flex items-center gap-1.5 text-destructive border-destructive/30"
                              >
                                Revoke
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* ── Edit Role Modal ── */}
      {editRoleMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-xl space-y-5 p-6">
            <h2 className="text-lg font-bold">Edit Role</h2>
            <p className="text-sm font-medium text-muted-foreground">
              {editRoleMember.full_name || "This member"}
            </p>

            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-400 font-medium">
              This change takes effect the next time the user logs in. Their current session will not be updated.
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                New Role
              </label>
              <select
                value={editRoleValue}
                onChange={(e) => setEditRoleValue(e.target.value)}
                className="w-full h-11 border border-input bg-background rounded-xl px-3 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="manager">manager</option>
                <option value="technician">technician</option>
              </select>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setEditRoleMember(null)}
                className="h-9 px-4 rounded-xl border border-border text-xs font-bold hover:bg-muted/50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={editRoleBusy || editRoleValue === editRoleMember.role}
                onClick={() => void handleEditRoleConfirm()}
                className="h-9 px-4 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none inline-flex items-center gap-2"
              >
                {editRoleBusy && <Loader2 className="size-3.5 animate-spin" />}
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Revoke Invite Modal ── */}
      {revokeInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-xl space-y-5 p-6">
            <h2 className="text-lg font-bold">Revoke Invite</h2>
            <p className="text-sm text-muted-foreground">
              Revoke this invite? The link will stop working immediately.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setRevokeInvite(null)}
                className="h-9 px-4 rounded-xl border border-border text-xs font-bold hover:bg-muted/50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={revokeBusy}
                onClick={() => void handleRevokeConfirm()}
                className="h-9 px-4 rounded-xl bg-destructive text-destructive-foreground text-xs font-bold hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none inline-flex items-center gap-2"
              >
                {revokeBusy && (
                  <Loader2 className="size-3.5 animate-spin" />
                )}
                Revoke
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
