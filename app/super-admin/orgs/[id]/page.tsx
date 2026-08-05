"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  Loader2,
  Building2,
  ArrowLeft,
  ChevronRight,
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import { deactivatedSignOut } from "@/lib/active-session"
import { resolveMfaGateRedirect } from "@/lib/mfa-gate"
import { setUserActiveStatus, setUserActiveErrorMessage } from "@/lib/set-user-active"
import { setUserRole, setUserRoleErrorMessage } from "@/lib/set-user-role"
import { loadBillingOverview } from "@/lib/load-billing-overview"
import type { TenantRow } from "@/lib/billing-overview-model"
import { formatRenewalDate } from "@/lib/format-renewal-date"
import {
  billingStatusBadgeClass,
  billingStatusLabel,
} from "@/lib/billing-status-badge"
import { truncateStripeId, copyStripeId } from "@/lib/stripe-id-display"

// ─── Types ───────────────────────────────────────────────────────────────────

type OrgDetail = {
  id: string
  name: string
  created_at: string
  trial_ends_at: string | null
}

type OrgLab = {
  id: string
  name: string
  created_at: string
  is_archived: boolean
}

type MemberRow = {
  id: string
  full_name: string | null
  role: string
  lab_id: string | null
  created_at: string | null
  is_active: boolean
  deactivated_at: string | null
}

type OrgAdminProfile = {
  id: string
  full_name: string | null
}

type InviteRow = {
  id: string
  token: string
  role: string | null
  used: boolean
  created_at: string
  revoked_at: string | null
  lab_name: string | null
  lab_id: string | null
}

type ActiveTab = "overview" | "labs" | "members" | "billing" | "invites"

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

export default function OrgDetailPage() {
  const router = useRouter()
  const params = useParams()
  const orgId = params.id as string

  // Gate
  const [gateLoading, setGateLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [sessionToken, setSessionToken] = useState<string | null>(null)

  // Data
  const [org, setOrg] = useState<OrgDetail | null>(null)
  const [labs, setLabs] = useState<OrgLab[]>([])
  const [orgAdmin, setOrgAdmin] = useState<OrgAdminProfile | null>(null)
  const [orgAdminEmail, setOrgAdminEmail] = useState<string | null>(null)
  const [members, setMembers] = useState<MemberRow[]>([])
  const [memberCountsByLabId, setMemberCountsByLabId] = useState<
    Record<string, number>
  >({})
  const [invites, setInvites] = useState<InviteRow[]>([])

  // Loading
  const [dataLoading, setDataLoading] = useState(true)
  const [membersLoading, setMembersLoading] = useState(false)
  const [invitesLoading, setInvitesLoading] = useState(false)

  // UI
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview")
  const [toast, setToast] = useState<Toast>(null)

  // Deactivate confirm modal
  const [deactivateMember, setDeactivateMember] = useState<MemberRow | null>(null)
  const [activeBusyId, setActiveBusyId] = useState<string | null>(null)
  const deactivateMemberRef = useRef<MemberRow | null>(null)
  deactivateMemberRef.current = deactivateMember

  // Edit role modal
  const [editRoleMember, setEditRoleMember] = useState<MemberRow | null>(null)
  const [editRoleValue, setEditRoleValue] = useState("")
  const [editRoleBusy, setEditRoleBusy] = useState(false)

  // Revoke invite modal
  const [revokeInvite, setRevokeInvite] = useState<InviteRow | null>(null)
  const [revokeBusy, setRevokeBusy] = useState(false)

  // Billing
  const [extendBusy, setExtendBusy] = useState(false)
  const [billingTenants, setBillingTenants] = useState<TenantRow[] | null>(null)
  const [billingLoading, setBillingLoading] = useState(false)
  const [billingError, setBillingError] = useState<{
    status: number
    code: string
  } | null>(null)

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
        .select("role, is_active")
        .eq("id", session.user.id)
        .maybeSingle()

      if (cancelled) return

      if (profile?.is_active === false) {
        await deactivatedSignOut(router, session.user.id)
        return
      }

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
      setSessionToken(session.access_token)
      setAuthorized(true)
      setGateLoading(false)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [router])

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setDataLoading(true)

    // 1. Fetch org
    const { data: orgData } = await supabase
      .from("organizations")
      .select("id, name, created_at, trial_ends_at")
      .eq("id", orgId)
      .maybeSingle()
    const orgDetail = orgData as OrgDetail | null
    setOrg(orgDetail)

    // 2. Fetch labs
    const { data: labsData } = await supabase
      .from("labs")
      .select("id, name, created_at, is_archived")
      .eq("org_id", orgId)
      .order("name")
    const labList = (labsData as OrgLab[]) || []
    setLabs(labList)
    const labIds = labList.map((l) => l.id)

    // 3. Fetch org admin profile
    const { data: adminData } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", orgId)
      .eq("role", "org_admin")
      .is("lab_id", null)
      .maybeSingle()
    const adminProfile = adminData as OrgAdminProfile | null
    setOrgAdmin(adminProfile)

    // 4. Fetch org admin email via API route
    if (adminProfile?.id && sessionToken) {
      try {
        const res = await fetch(
          `/api/super-admin/user-email?userId=${adminProfile.id}`,
          {
            headers: { Authorization: `Bearer ${sessionToken}` },
          }
        )
        if (res.ok) {
          const json = (await res.json()) as { email?: string }
          setOrgAdminEmail(json.email ?? null)
        }
      } catch {
        setOrgAdminEmail(null)
      }
    }

    // 5. Fetch members (all profiles in labs that belong to this org)
    if (labIds.length > 0) {
      setMembersLoading(true)
      const { data: membersData } = await supabase
        .from("profiles")
        .select("id, full_name, role, lab_id, created_at, is_active, deactivated_at")
        .in("lab_id", labIds)
        .order("full_name")
      const memberList = (membersData as MemberRow[]) || []
      setMembers(memberList)

      const counts: Record<string, number> = {}
      for (const m of memberList) {
        if (m.lab_id) counts[m.lab_id] = (counts[m.lab_id] ?? 0) + 1
      }
      setMemberCountsByLabId(counts)
      setMembersLoading(false)
    } else {
      setMembers([])
      setMemberCountsByLabId({})
    }

    // 6. Fetch invites — two queries, deduplicate by id
    setInvitesLoading(true)
    const inviteQueries: PromiseLike<InviteRow[]>[] = []

    inviteQueries.push(
      supabase
        .from("lab_invites")
        .select("id, token, role, used, created_at, revoked_at, lab_name, lab_id")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .then(({ data }) => (data as InviteRow[]) || [])
    )

    if (labIds.length > 0) {
      inviteQueries.push(
        supabase
          .from("lab_invites")
          .select("id, token, role, used, created_at, revoked_at, lab_name, lab_id")
          .in("lab_id", labIds)
          .order("created_at", { ascending: false })
          .then(({ data }) => (data as InviteRow[]) || [])
      )
    }

    const inviteResults = await Promise.all(inviteQueries)
    const allInvites = inviteResults.flat()
    const seen = new Set<string>()
    const deduped: InviteRow[] = []
    for (const inv of allInvites) {
      if (!seen.has(inv.id)) {
        seen.add(inv.id)
        deduped.push(inv)
      }
    }
    deduped.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    setInvites(deduped)
    setInvitesLoading(false)

    setDataLoading(false)
  }, [orgId, sessionToken])

  useEffect(() => {
    if (!authorized) return
    void fetchAll()
  }, [authorized, fetchAll])

  const fetchBilling = useCallback(async () => {
    setBillingLoading(true)
    setBillingError(null)
    const result = await loadBillingOverview()
    if (!result.ok) {
      setBillingError({ status: result.status, code: result.code })
      setBillingTenants(null)
    } else {
      setBillingTenants(result.data.tenants)
      setBillingError(null)
    }
    setBillingLoading(false)
  }, [])

  useEffect(() => {
    if (!authorized) return
    void fetchBilling()
  }, [authorized, fetchBilling])

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleEditRoleConfirm = useCallback(async () => {
    if (!editRoleMember || !editRoleValue) return
    if (editRoleValue !== "manager" && editRoleValue !== "technician") return
    setEditRoleBusy(true)
    const result = await setUserRole(editRoleMember.id, editRoleValue)
    setEditRoleBusy(false)

    if (!result.ok) {
      showToast("error", setUserRoleErrorMessage(result.errorCode))
      return
    }
    setEditRoleMember(null)
    showToast("success", "Role updated. Change takes effect on next login.")
    await fetchAll()
  }, [editRoleMember, editRoleValue, fetchAll])

  const handleSetActive = useCallback(async (member: MemberRow, nextActive: boolean) => {
    setActiveBusyId(member.id)
    const result = await setUserActiveStatus(member.id, nextActive)
    setActiveBusyId(null)

    if (result.ok) {
      setDeactivateMember(null)
      setToast({
        kind: "success",
        text: `${member.full_name || "Member"} ${nextActive ? "reactivated" : "deactivated"}.`,
      })
      setTimeout(() => setToast(null), 4000)
      await fetchAll()
      return
    }

    if (result.errorCode === "already_in_state") {
      // State drifted since load — silently refresh the list.
      setDeactivateMember(null)
      await fetchAll()
      return
    }

    setToast({ kind: "error", text: setUserActiveErrorMessage(result.errorCode) })
    setTimeout(() => setToast(null), 4000)
  }, [fetchAll])

  const confirmDeactivate = useCallback(async () => {
    const member = deactivateMemberRef.current
    if (!member) return
    await handleSetActive(member, false)
  }, [handleSetActive])

  // Deactivate confirm modal: Enter submits (textarea-guarded), ESC closes,
  // Android back closes via pushState/popstate (established modal conventions).
  useEffect(() => {
    if (!deactivateMember) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDeactivateMember(null)
      if (e.key === "Enter" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault()
        void confirmDeactivate()
      }
    }

    window.history.pushState(null, "", window.location.href)
    const onPopState = () => setDeactivateMember(null)

    document.addEventListener("keydown", onKeyDown)
    window.addEventListener("popstate", onPopState)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("popstate", onPopState)
    }
  }, [deactivateMember, confirmDeactivate])

  const handleRevokeConfirm = useCallback(async () => {
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
    await fetchAll()
  }, [revokeInvite, currentUserId, fetchAll])

  // Edit Role modal: Enter submits (textarea-guarded), ESC closes,
  // Android back closes via pushState/popstate (established modal conventions).
  useEffect(() => {
    if (!editRoleMember) return
    const isTextareaFocused = () => document.activeElement?.tagName === "TEXTAREA"
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditRoleMember(null)
    }
    const handleEnter = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !isTextareaFocused()) {
        e.preventDefault()
        void handleEditRoleConfirm()
      }
    }
    window.history.pushState(null, "", window.location.href)
    const handlePopState = () => setEditRoleMember(null)
    document.addEventListener("keydown", handleEsc)
    document.addEventListener("keydown", handleEnter)
    window.addEventListener("popstate", handlePopState)
    return () => {
      document.removeEventListener("keydown", handleEsc)
      document.removeEventListener("keydown", handleEnter)
      window.removeEventListener("popstate", handlePopState)
    }
  }, [editRoleMember, handleEditRoleConfirm])

  // Revoke Invite modal: same conventions as Edit Role / requests-table.
  useEffect(() => {
    if (!revokeInvite) return
    const isTextareaFocused = () => document.activeElement?.tagName === "TEXTAREA"
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRevokeInvite(null)
    }
    const handleEnter = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !isTextareaFocused()) {
        e.preventDefault()
        void handleRevokeConfirm()
      }
    }
    window.history.pushState(null, "", window.location.href)
    const handlePopState = () => setRevokeInvite(null)
    document.addEventListener("keydown", handleEsc)
    document.addEventListener("keydown", handleEnter)
    window.addEventListener("popstate", handlePopState)
    return () => {
      document.removeEventListener("keydown", handleEsc)
      document.removeEventListener("keydown", handleEnter)
      window.removeEventListener("popstate", handlePopState)
    }
  }, [revokeInvite, handleRevokeConfirm])

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
    setOrg((prev) =>
      prev ? { ...prev, trial_ends_at: newDate.toISOString() } : prev
    )
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

  // ── Lab name lookup ────────────────────────────────────────────────────────

  function labNameById(id: string | null): string {
    if (!id) return "—"
    return labs.find((l) => l.id === id)?.name ?? "—"
  }

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
            <Building2 className="size-5 text-primary" aria-hidden />
          </div>

          {dataLoading ? (
            <div className="h-7 w-48 rounded-lg bg-muted/60 animate-pulse" />
          ) : (
            <div className="flex items-center gap-3 flex-wrap min-w-0">
              <h1 className="text-xl font-black tracking-tight truncate">
                {org?.name ?? "Organization"}
              </h1>
              <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-500/15 text-violet-800 dark:text-violet-300">
                {labs.length} {labs.length === 1 ? "lab" : "labs"}
              </span>
              {org?.created_at && (
                <span className="text-xs text-muted-foreground">
                  Created {formatDateOnly(org.created_at)}
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        {/* Tab bar */}
        <div className="flex p-1.5 bg-muted/40 rounded-2xl border border-border gap-1">
          {(
            ["overview", "labs", "members", "billing", "invites"] as ActiveTab[]
          ).map((tab) => (
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
          ))}
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
                {/* Org Details card */}
                <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Org Details
                  </p>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                    <div>
                      <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Org Admin
                      </dt>
                      <dd className="mt-1 text-sm font-medium">
                        {orgAdmin ? (
                          <span>
                            {orgAdmin.full_name || "—"}
                            {orgAdminEmail && (
                              <span className="ml-2 text-muted-foreground font-normal">
                                ({orgAdminEmail})
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground italic">
                            No org admin yet
                          </span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Total Labs
                      </dt>
                      <dd className="mt-1 text-sm font-medium">{labs.length}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Total Members
                      </dt>
                      <dd className="mt-1 text-sm font-medium">
                        {members.length}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            )}

            {/* ── Labs ── */}
            {activeTab === "labs" && (
              <div className="rounded-2xl border border-border overflow-hidden">
                <div className="hidden sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.4fr)] gap-2 px-6 py-3 bg-muted/30 border-b border-border text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  <span>Lab Name</span>
                  <span>Members</span>
                  <span>Created</span>
                  <span>Status</span>
                  <span />
                </div>

                {labs.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground italic">
                    No labs yet.
                  </div>
                ) : (
                  labs.map((lab) => (
                    <button
                      key={lab.id}
                      type="button"
                      onClick={() =>
                        router.push(`/super-admin/labs/${lab.id}`)
                      }
                      className="w-full text-left grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.4fr)] gap-2 px-6 py-4 border-t border-border/60 items-center text-sm hover:bg-muted/20 transition-colors"
                    >
                      <span className="font-bold truncate">{lab.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {memberCountsByLabId[lab.id] ?? 0}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono">
                        {formatDateOnly(lab.created_at)}
                      </span>
                      <span>
                        {lab.is_archived ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-500/15 text-zinc-600 dark:text-zinc-400">
                            Archived
                          </span>
                        ) : (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-500/15 text-green-700 dark:text-green-400">
                            Active
                          </span>
                        )}
                      </span>
                      <span className="flex justify-end">
                        <ChevronRight className="size-4 text-muted-foreground" />
                      </span>
                    </button>
                  ))
                )}
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
                    <div className="hidden sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 px-6 py-3 bg-muted/30 border-b border-border text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      <span>Name</span>
                      <span>Role</span>
                      <span>Lab</span>
                      <span>Joined</span>
                      <span>Actions</span>
                    </div>

                    {members.length === 0 ? (
                      <div className="py-12 text-center text-sm text-muted-foreground italic">
                        No members yet.
                      </div>
                    ) : (
                      members.map((member) => {
                        const memberActive = member.is_active !== false
                        return (
                        <div
                          key={member.id}
                          className="grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 px-6 py-4 border-t border-border/60 items-center text-sm"
                        >
                          <span className="font-bold truncate">
                            {member.full_name || "—"}
                          </span>
                          <span className="inline-flex flex-wrap items-center gap-1.5">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                member.role === "manager"
                                  ? "bg-sky-500/15 text-sky-800 dark:text-sky-300"
                                  : "bg-emerald-500/15 text-emerald-800 dark:text-emerald-400"
                              }`}
                            >
                              {member.role}
                            </span>
                            {!memberActive ? (
                              <span
                                title={member.deactivated_at ? `Deactivated ${formatDateOnly(member.deactivated_at)}` : undefined}
                                className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-500/15 text-zinc-600 dark:text-zinc-400"
                              >
                                Deactivated
                              </span>
                            ) : null}
                          </span>
                          <span className="text-xs text-muted-foreground truncate">
                            {labNameById(member.lab_id)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDateOnly(member.created_at)}
                          </span>
                          {/* No client-side last-admin disable on this org-wide list:
                              the API's 409 last_admin surfaces through the error path
                              instead. For org_admin targets specifically, a client-side
                              peer-count query is deliberately deferred — the org layer
                              is unexercised in production (zero orgs post-wipe). */}
                          <div className="flex flex-wrap items-center gap-2">
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
                            {member.role !== "super_admin" ? (
                              memberActive ? (
                                <button
                                  type="button"
                                  disabled={activeBusyId === member.id}
                                  onClick={() => setDeactivateMember(member)}
                                  className="h-9 px-3 rounded-lg border border-destructive/40 text-destructive text-xs font-bold hover:bg-destructive/10 disabled:opacity-50 disabled:pointer-events-none"
                                >
                                  Deactivate
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={activeBusyId === member.id}
                                  onClick={() => void handleSetActive(member, true)}
                                  className="h-9 px-3 rounded-lg bg-primary/10 text-primary text-xs font-bold hover:bg-primary/15 disabled:opacity-50 inline-flex items-center gap-1.5"
                                >
                                  {activeBusyId === member.id ? <Loader2 className="size-3.5 animate-spin" /> : null}
                                  Reactivate
                                </button>
                              )
                            ) : null}
                          </div>
                        </div>
                        )
                      })
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Billing ── */}
            {activeTab === "billing" && (
              <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => void fetchBilling()}
                    disabled={billingLoading}
                    className="h-9 px-4 rounded-xl border border-border text-xs font-bold hover:bg-muted/50 disabled:opacity-50 disabled:pointer-events-none inline-flex items-center gap-2"
                  >
                    {billingLoading ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : null}
                    Refresh
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push("/super-admin")}
                    className="text-xs font-bold text-primary hover:underline"
                  >
                    View full billing overview
                  </button>
                </div>

                {billingLoading ? (
                  <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                    <Loader2 className="size-5 animate-spin" aria-hidden />
                    Loading billing…
                  </div>
                ) : billingError ? (
                  <div
                    role="alert"
                    className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-4 space-y-1"
                  >
                    <p className="text-sm font-bold text-destructive">
                      Billing could not be loaded.
                    </p>
                    <p className="text-xs text-destructive/90 font-mono">
                      HTTP {billingError.status || "—"} · code={billingError.code}
                    </p>
                  </div>
                ) : !org ? (
                  <p className="text-sm text-destructive font-medium">
                    Organization details could not be loaded.
                  </p>
                ) : (() => {
                  const row = billingTenants?.find(
                    (t) => t.key === `org:${orgId}`,
                  )
                  if (!row) {
                    return (
                      <p className="text-sm text-muted-foreground">
                        No billing row found for this organization.
                      </p>
                    )
                  }
                  const showTrial =
                    row.billingStatus === null ||
                    row.billingStatus === "trialing"
                  const trialEnded = trialInfo
                    ? trialInfo.trialEnd.getTime() < Date.now()
                    : false
                  const showTrialCountdown = showTrial && !trialEnded
                  const showExtendButtons = showTrial
                  return (
                    <>
                      <div className="flex items-center gap-3">
                        <span
                          className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold capitalize ${billingStatusBadgeClass(row.billingStatus)}`}
                        >
                          {billingStatusLabel(row.billingStatus)}
                        </span>
                      </div>

                      <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        <div>
                          <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            Renewal
                          </dt>
                          <dd className="mt-1 text-sm font-medium">
                            {formatRenewalDate(row.currentPeriodEnd) ?? "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            Expected $/mo
                          </dt>
                          <dd className="mt-1 text-sm font-medium">
                            {row.expectedMonthlyUsd !== null
                              ? `$${row.expectedMonthlyUsd.toLocaleString("en-US")}`
                              : "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            Labs covered
                          </dt>
                          <dd className="mt-1 text-sm font-medium">
                            {row.labCount}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            Stripe customer
                          </dt>
                          <dd className="mt-1">
                            {row.stripeCustomerId ? (
                              <button
                                type="button"
                                title={row.stripeCustomerId}
                                onClick={() =>
                                  void copyStripeId(row.stripeCustomerId!)
                                }
                                className="font-mono text-xs text-left hover:underline"
                              >
                                {truncateStripeId(row.stripeCustomerId)}
                              </button>
                            ) : (
                              "—"
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            Stripe subscription
                          </dt>
                          <dd className="mt-1">
                            {row.stripeSubscriptionId ? (
                              <button
                                type="button"
                                title={row.stripeSubscriptionId}
                                onClick={() =>
                                  void copyStripeId(row.stripeSubscriptionId!)
                                }
                                className="font-mono text-xs text-left hover:underline"
                              >
                                {truncateStripeId(row.stripeSubscriptionId)}
                              </button>
                            ) : (
                              "—"
                            )}
                          </dd>
                        </div>
                      </dl>

                      {showTrialCountdown && trialInfo ? (
                        <>
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
                                {formatDateOnly(
                                  trialInfo.trialEnd.toISOString(),
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                Days Remaining
                              </dt>
                              <dd
                                className={`mt-1 text-2xl font-black ${daysRemainingColor}`}
                              >
                                {trialInfo.daysRemaining}
                              </dd>
                            </div>
                          </dl>

                          <div className="space-y-1.5">
                            <div className="h-2 rounded-full bg-muted overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${progressColor}`}
                                style={{ width: `${trialInfo.pct}%` }}
                              />
                            </div>
                            <p className="text-[10px] text-muted-foreground font-medium">
                              {Math.round(trialInfo.pct)}% of 90-day trial
                              elapsed
                            </p>
                          </div>
                        </>
                      ) : null}

                      {showTrial && trialEnded && trialInfo ? (
                        <p className="text-sm text-muted-foreground">
                          Trial ended{" "}
                          {formatDateOnly(trialInfo.trialEnd.toISOString())}
                        </p>
                      ) : null}

                      {showExtendButtons ? (
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
                        </div>
                      ) : null}
                    </>
                  )
                })()}
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
                    <div className="hidden sm:grid sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_minmax(0,0.75fr)_minmax(0,0.75fr)_minmax(0,0.9fr)_minmax(0,0.8fr)] gap-2 px-6 py-3 bg-muted/30 border-b border-border text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      <span>Lab</span>
                      <span>Token</span>
                      <span>Role</span>
                      <span>Status</span>
                      <span>Created</span>
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
                          className="grid grid-cols-1 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_minmax(0,0.75fr)_minmax(0,0.75fr)_minmax(0,0.9fr)_minmax(0,0.8fr)] gap-2 px-6 py-4 border-t border-border/60 items-center text-sm"
                        >
                          <span className="text-xs font-medium truncate">
                            {inv.lab_name ||
                              labNameById(inv.lab_id) ||
                              "—"}
                          </span>
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
                              {inv.role === "org_admin"
                                ? "Org Admin"
                                : "Manager"}
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
                          <div>
                            {!inv.revoked_at && !inv.used && (
                              <button
                                type="button"
                                onClick={() => setRevokeInvite(inv)}
                                className="h-9 px-3 rounded-lg border border-destructive/30 text-destructive text-xs font-bold hover:bg-muted/50 inline-flex items-center gap-1.5"
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

      {/* ── Deactivate Confirm Modal ── */}
      {deactivateMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-xl space-y-5 p-6">
            <h2 className="text-lg font-bold">Deactivate Member</h2>
            <p className="text-sm text-muted-foreground">
              Deactivate <span className="font-bold text-foreground">{deactivateMember.full_name || "this member"}</span>?
              They will lose all access immediately. This is reversible.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setDeactivateMember(null)}
                className="h-9 px-4 rounded-xl border border-border text-xs font-bold hover:bg-muted/50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={activeBusyId === deactivateMember.id}
                onClick={() => void confirmDeactivate()}
                className="h-9 px-4 rounded-xl bg-destructive text-destructive-foreground text-xs font-bold hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none inline-flex items-center gap-2"
              >
                {activeBusyId === deactivateMember.id && <Loader2 className="size-3.5 animate-spin" />}
                Deactivate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Role Modal ── */}
      {editRoleMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-xl space-y-5 p-6">
            <h2 className="text-lg font-bold">Edit Role</h2>
            <p className="text-sm font-medium text-muted-foreground">
              {editRoleMember.full_name || "This member"}
            </p>

            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-400 font-medium">
              This change takes effect the next time the user logs in. Their
              current session will not be updated.
            </div>

            {/* Viewer here is super_admin (RPC exempt from last_manager) —
                warn when demoting a lab's last active manager. Dashboard /
                org-admin keep the disabled-control pattern instead. */}
            {editRoleMember.role === "manager" &&
            editRoleValue === "technician" &&
            editRoleMember.is_active !== false &&
            editRoleMember.lab_id &&
            members.filter(
              (x) =>
                x.lab_id === editRoleMember.lab_id &&
                x.role === "manager" &&
                x.is_active !== false &&
                x.id !== editRoleMember.id
            ).length === 0 ? (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-400 font-medium">
                This is the lab&apos;s last active manager. After demotion, that lab will have no active admin.
              </div>
            ) : null}

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
                disabled={
                  editRoleBusy || editRoleValue === editRoleMember.role
                }
                onClick={() => void handleEditRoleConfirm()}
                className="h-9 px-4 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none inline-flex items-center gap-2"
              >
                {editRoleBusy && (
                  <Loader2 className="size-3.5 animate-spin" />
                )}
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
                {revokeBusy && <Loader2 className="size-3.5 animate-spin" />}
                Revoke
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
