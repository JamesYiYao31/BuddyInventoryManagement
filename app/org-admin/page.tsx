"use client"

import { useCallback, useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import {
  Building2,
  Loader2,
  LogOut,
  Copy,
  Check,
  Link2,
  Users,
  X,
  Settings,
} from "lucide-react"
import type { User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import {
  deactivatedSignOut,
  sessionReplacedSignOut,
  verifyActiveSessionForUser,
  voluntarySignOut,
} from "@/lib/active-session"
import { resolveMfaGateRedirect } from "@/lib/mfa-gate"
import { recordSecurityEvent } from "@/lib/security-log"
import { setUserActiveStatus, setUserActiveErrorMessage } from "@/lib/set-user-active"
import { setUserRole, setUserRoleErrorMessage } from "@/lib/set-user-role"
import { ProfileSettingsDialog } from "@/components/dashboard/profile-settings-dialog"

type LabRow = {
  id: string
  name: string
  is_archived: boolean
  archived_at: string | null
}

type MemberRow = {
  id: string
  full_name: string
  role: string
  lab_id: string
  created_at: string | null
  is_active: boolean
  deactivated_at: string | null
}

function formatJoinDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" })
  } catch {
    return iso
  }
}

type ActiveInviteRow = {
  id: string
  lab_id: string
  token: string
  lab_name: string
}

type RoleModalState = {
  memberId: string
  memberName: string
  labName: string
  targetRole: "manager" | "technician"
} | null

type DeactivateModalState = {
  memberId: string
  memberName: string
  labName: string
} | null

function shortenToken(t: string) {
  return t.length <= 8 ? t : `${t.slice(0, 8)}...`
}

function isTextareaFocused() {
  return document.activeElement?.tagName === "TEXTAREA"
}

export default function OrgAdminPage() {
  const router = useRouter()

  const [gateLoading, setGateLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [authUser, setAuthUser] = useState<User | null>(null)
  const [profileDialogOpen, setProfileDialogOpen] = useState(false)
  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgName, setOrgName] = useState<string>("")
  const [labs, setLabs] = useState<LabRow[]>([])
  const [membersByLabId, setMembersByLabId] = useState<Record<string, MemberRow[]>>({})
  const [invitesByLabId, setInvitesByLabId] = useState<Record<string, ActiveInviteRow>>({})
  const [pageError, setPageError] = useState<string | null>(null)

  const [generatingLabId, setGeneratingLabId] = useState<string | null>(null)
  const [revokingInviteId, setRevokingInviteId] = useState<string | null>(null)
  const [copyLabId, setCopyLabId] = useState<string | null>(null)

  const [roleModal, setRoleModal] = useState<RoleModalState>(null)
  const [roleBusyId, setRoleBusyId] = useState<string | null>(null)
  const [origin, setOrigin] = useState("")

  const roleModalRef = useRef<RoleModalState>(null)
  roleModalRef.current = roleModal

  const [deactivateModal, setDeactivateModal] = useState<DeactivateModalState>(null)
  const [activeBusyId, setActiveBusyId] = useState<string | null>(null)

  const deactivateModalRef = useRef<DeactivateModalState>(null)
  deactivateModalRef.current = deactivateModal

  const loadDashboard = useCallback(async (oid: string) => {
    setPageError(null)

    const { data: orgRow, error: orgErr } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", oid)
      .maybeSingle()

    if (orgErr) {
      setPageError(`Could not load organization: ${orgErr.message}`)
      setOrgName("")
    } else {
      setOrgName(orgRow?.name ?? "")
    }

    const { data: labRows, error: labsErr } = await supabase
      .from("labs")
      .select("id, name, is_archived, archived_at")
      .eq("org_id", oid)
      .order("name", { ascending: true })

    if (labsErr) {
      setPageError((prev) => prev ?? `Could not load labs: ${labsErr.message}`)
      setLabs([])
      setMembersByLabId({})
      setInvitesByLabId({})
      return
    }

    const labList = (labRows as LabRow[]) || []
    setLabs(labList)
    const labIds = labList.map((l) => l.id)

    if (labIds.length === 0) {
      setMembersByLabId({})
      setInvitesByLabId({})
      return
    }

    const { data: memberRows, error: memErr } = await supabase
      .from("profiles")
      .select("id, full_name, role, lab_id, created_at, is_active, deactivated_at")
      .in("lab_id", labIds)
      .order("full_name", { ascending: true })

    if (memErr) {
      setPageError((prev) => prev ?? `Could not load members: ${memErr.message}`)
      setMembersByLabId({})
    } else {
      const byLab: Record<string, MemberRow[]> = {}
      for (const id of labIds) byLab[id] = []
      for (const m of (memberRows as MemberRow[]) || []) {
        if (m.lab_id && byLab[m.lab_id]) {
          byLab[m.lab_id].push(m)
        }
      }
      setMembersByLabId(byLab)
    }

    const { data: inviteRows, error: invErr } = await supabase
      .from("lab_invites")
      .select("id, lab_id, token, lab_name")
      .eq("org_id", oid)
      .eq("role", "manager")
      .eq("used", false)
      .is("revoked_at", null)

    if (invErr) {
      setPageError((prev) => prev ?? `Could not load invites: ${invErr.message}`)
      setInvitesByLabId({})
      return
    }

    const invMap: Record<string, ActiveInviteRow> = {}
    for (const row of (inviteRows as ActiveInviteRow[]) || []) {
      if (row.lab_id) invMap[row.lab_id] = row
    }
    setInvitesByLabId(invMap)
  }, [])

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setGateLoading(true)
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.user) {
        if (!cancelled) router.replace("/login")
        return
      }

      const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("role, org_id, is_active")
        .eq("id", session.user.id)
        .maybeSingle()

      if (cancelled) return

      if (profileErr || !profile) {
        router.replace("/login")
        return
      }

      if (profile.is_active === false) {
        await deactivatedSignOut(router, session.user.id)
        return
      }

      if (profile.role === "super_admin") {
        router.replace("/super-admin")
        return
      }

      if (profile.role === "manager" || profile.role === "technician") {
        router.replace("/dashboard")
        return
      }

      if (profile.role !== "org_admin" || !profile.org_id) {
        router.replace("/dashboard")
        return
      }

      const mfaRedirect = await resolveMfaGateRedirect("/org-admin")
      if (mfaRedirect) {
        if (!cancelled) router.replace(mfaRedirect)
        return
      }

      const oid = profile.org_id as string
      setAuthUser(session.user)
      setOrgId(oid)
      await loadDashboard(oid)

      if (!cancelled) {
        setAuthorized(true)
        setGateLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [router, loadDashboard])

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  useEffect(() => {
    const interval = setInterval(async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session) {
        router.replace("/login")
        return
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role, org_id")
        .eq("id", session.user.id)
        .maybeSingle()

      if (!profile) {
        await voluntarySignOut(session.user.id)
        router.replace("/login")
        return
      }

      if (profile.role === "super_admin") {
        router.replace("/super-admin")
        return
      }

      if (profile.role === "manager" || profile.role === "technician") {
        router.replace("/dashboard")
        return
      }

      if (profile.role !== "org_admin" || !profile.org_id) {
        router.replace("/dashboard")
        return
      }

      const activeOk = await verifyActiveSessionForUser(session.user.id)
      if (activeOk === "replaced") {
        await sessionReplacedSignOut(router)
      }
    }, 30000)

    return () => clearInterval(interval)
  }, [router])

  const refresh = useCallback(async () => {
    if (!orgId) return
    await loadDashboard(orgId)
  }, [orgId, loadDashboard])

  const handleSignOut = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    await recordSecurityEvent("logout", "success")
    await voluntarySignOut(session?.user?.id)
    router.replace("/login")
  }

  const handleGenerateInvite = async (lab: LabRow) => {
    if (!orgId) return
    setPageError(null)
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const userId = session?.user?.id
    if (!userId) {
      router.replace("/login")
      return
    }

    setGeneratingLabId(lab.id)
    const token = crypto.randomUUID()
    const { error } = await supabase.from("lab_invites").insert({
      token,
      lab_name: lab.name,
      lab_id: lab.id,
      org_id: orgId,
      role: "manager",
      used: false,
      created_by: userId,
    })
    setGeneratingLabId(null)

    if (error) {
      setPageError(error.message.includes("unique") || error.code === "23505"
        ? "This lab already has an active invite. Refresh or revoke it first."
        : error.message)
      await refresh()
      return
    }

    await refresh()
  }

  const handleRevokeInvite = async (invite: ActiveInviteRow) => {
    setPageError(null)
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const userId = session?.user?.id
    if (!userId) {
      router.replace("/login")
      return
    }

    setRevokingInviteId(invite.id)
    const { error } = await supabase
      .from("lab_invites")
      .update({
        revoked_at: new Date().toISOString(),
        revoked_by: userId,
      })
      .eq("id", invite.id)
    setRevokingInviteId(null)

    if (error) {
      setPageError(error.message)
      return
    }

    await refresh()
  }

  const handleCopyInviteUrl = async (labId: string, token: string) => {
    const url = `${window.location.origin}/register-lab?token=${token}`
    try {
      await navigator.clipboard.writeText(url)
      setCopyLabId(labId)
      setTimeout(() => setCopyLabId(null), 2000)
    } catch {
      setPageError("Could not copy to clipboard.")
    }
  }

  const confirmRoleChange = useCallback(async () => {
    const modal = roleModalRef.current
    if (!modal) return
    setPageError(null)
    setRoleBusyId(modal.memberId)
    const result = await setUserRole(modal.memberId, modal.targetRole)
    setRoleBusyId(null)

    if (!result.ok) {
      setPageError(setUserRoleErrorMessage(result.errorCode))
      return
    }

    setRoleModal(null)
    await refresh()
  }, [refresh])

  useEffect(() => {
    if (!roleModal) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRoleModal(null)
      if (e.key === "Enter" && !isTextareaFocused()) {
        e.preventDefault()
        void confirmRoleChange()
      }
    }

    window.history.pushState(null, "", window.location.href)
    const onPopState = () => setRoleModal(null)

    document.addEventListener("keydown", onKeyDown)
    window.addEventListener("popstate", onPopState)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("popstate", onPopState)
    }
  }, [roleModal, confirmRoleChange])

  const handleSetActive = useCallback(async (memberId: string, nextActive: boolean) => {
    setPageError(null)
    setActiveBusyId(memberId)
    const result = await setUserActiveStatus(memberId, nextActive)
    setActiveBusyId(null)

    if (result.ok || result.errorCode === "already_in_state") {
      // already_in_state: state drifted since load — silently refresh.
      setDeactivateModal(null)
      await refresh()
      return
    }

    setPageError(setUserActiveErrorMessage(result.errorCode))
  }, [refresh])

  const confirmDeactivate = useCallback(async () => {
    const modal = deactivateModalRef.current
    if (!modal) return
    await handleSetActive(modal.memberId, false)
  }, [handleSetActive])

  useEffect(() => {
    if (!deactivateModal) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDeactivateModal(null)
      if (e.key === "Enter" && !isTextareaFocused()) {
        e.preventDefault()
        void confirmDeactivate()
      }
    }

    window.history.pushState(null, "", window.location.href)
    const onPopState = () => setDeactivateModal(null)

    document.addEventListener("keydown", onKeyDown)
    window.addEventListener("popstate", onPopState)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("popstate", onPopState)
    }
  }, [deactivateModal, confirmDeactivate])

  if (gateLoading || !authorized) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
        <Loader2 className="size-10 text-primary animate-spin" aria-hidden />
        <p className="text-sm font-medium text-muted-foreground">Verifying access...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-4 sm:py-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-primary/10 shrink-0">
              <Building2 className="size-6 text-primary" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-black tracking-tight truncate">{orgName || "Organization"}</h1>
              <p className="text-xs text-muted-foreground truncate">Organization Admin</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setProfileDialogOpen(true)}
              aria-label="Profile settings"
              className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-border bg-background text-sm font-bold hover:bg-muted/50"
            >
              <Settings className="size-4" aria-hidden />
              Settings
            </button>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-border bg-background text-sm font-bold hover:bg-muted/50"
            >
              <LogOut className="size-4" aria-hidden />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <ProfileSettingsDialog
        open={profileDialogOpen}
        onOpenChange={setProfileDialogOpen}
        user={authUser}
        role="org_admin"
        mfaReturnTo="/org-admin"
      />

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-10 space-y-10">
        {pageError ? (
          <p
            role="alert"
            className="text-sm font-medium rounded-xl border border-destructive/30 bg-destructive/10 text-destructive px-4 py-3"
          >
            {pageError}
          </p>
        ) : null}

        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Users className="size-5 text-primary shrink-0" aria-hidden />
            <h2 className="text-base font-bold">Labs &amp; members</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Manage manager invites and roles per lab. Inventory data stays in each lab&apos;s dashboard.
          </p>

          {labs.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground italic">
              No labs in this organization yet.
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-1 lg:grid-cols-2">
              {labs.map((lab) => {
                const members = membersByLabId[lab.id] ?? []
                const invite = invitesByLabId[lab.id]
                return (
                  <div
                    key={lab.id}
                    className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-5 flex flex-col"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-lg font-bold truncate">{lab.name}</h3>
                        {lab.is_archived ? (
                          <span className="inline-flex mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-500/15 text-zinc-600 dark:text-zinc-400">
                            Archived
                          </span>
                        ) : (
                          <span className="inline-flex mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-500/15 text-green-700 dark:text-green-400">
                            Active
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Members</p>
                      {members.length === 0 ? (
                        <p className="text-sm text-muted-foreground italic py-2">No members yet</p>
                      ) : (
                        <ul className="space-y-2">
                          {members.map((m) => {
                            const memberActive = m.is_active !== false
                            const lastAdminBlocked =
                              m.role === "manager" &&
                              memberActive &&
                              members.filter(
                                (x) => x.role === "manager" && x.is_active !== false && x.id !== m.id
                              ).length === 0
                            return (
                            <li
                              key={m.id}
                              className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-3"
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-bold truncate">{m.full_name || "—"}</p>
                                <span className="inline-flex flex-wrap items-center gap-1.5 mt-1">
                                  <span
                                    className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                      m.role === "manager"
                                        ? "bg-violet-500/15 text-violet-800 dark:text-violet-300"
                                        : "bg-sky-500/15 text-sky-800 dark:text-sky-300"
                                    }`}
                                  >
                                    {m.role === "manager" ? "Manager" : "Technician"}
                                  </span>
                                  {!memberActive ? (
                                    <span
                                      title={m.deactivated_at ? `Deactivated ${formatJoinDate(m.deactivated_at)}` : undefined}
                                      className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-500/15 text-zinc-600 dark:text-zinc-400"
                                    >
                                      Deactivated
                                    </span>
                                  ) : null}
                                </span>
                                <p className="text-xs text-muted-foreground mt-1">Joined {formatJoinDate(m.created_at)}</p>
                              </div>
                              <div className="flex flex-wrap gap-2 shrink-0">
                                {m.role === "manager" ? (
                                  <div className="flex flex-col gap-1">
                                    <button
                                      type="button"
                                      disabled={roleBusyId === m.id || lastAdminBlocked}
                                      onClick={() =>
                                        setRoleModal({
                                          memberId: m.id,
                                          memberName: m.full_name || "Member",
                                          labName: lab.name,
                                          targetRole: "technician",
                                        })
                                      }
                                      className="h-9 px-3 rounded-lg border border-border text-xs font-bold hover:bg-muted/50 disabled:opacity-50 disabled:pointer-events-none"
                                    >
                                      Make Technician
                                    </button>
                                    {/* Viewer is org_admin: last-manager demotion is
                                        blocked by the RPC — disable client-side.
                                        Super_admin surfaces warn instead. */}
                                    {lastAdminBlocked ? (
                                      <p className="text-[10px] text-muted-foreground leading-tight max-w-[160px]">
                                        Last active manager — demoting them leaves the lab without an admin.
                                      </p>
                                    ) : null}
                                  </div>
                                ) : null}
                                {m.role === "technician" ? (
                                  <button
                                    type="button"
                                    disabled={roleBusyId === m.id}
                                    onClick={() =>
                                      setRoleModal({
                                        memberId: m.id,
                                        memberName: m.full_name || "Member",
                                        labName: lab.name,
                                        targetRole: "manager",
                                      })
                                    }
                                    className="h-9 px-3 rounded-lg bg-primary/10 text-primary text-xs font-bold hover:bg-primary/15 disabled:opacity-50"
                                  >
                                    Make Manager
                                  </button>
                                ) : null}
                                {m.role !== "super_admin" ? (
                                  memberActive ? (
                                    <div className="flex flex-col gap-1">
                                      <button
                                        type="button"
                                        disabled={activeBusyId === m.id || lastAdminBlocked}
                                        onClick={() =>
                                          setDeactivateModal({
                                            memberId: m.id,
                                            memberName: m.full_name || "Member",
                                            labName: lab.name,
                                          })
                                        }
                                        className="h-9 px-3 rounded-lg border border-destructive/40 text-destructive text-xs font-bold hover:bg-destructive/10 disabled:opacity-50 disabled:pointer-events-none"
                                      >
                                        Deactivate
                                      </button>
                                      {lastAdminBlocked ? (
                                        <p className="text-[10px] text-muted-foreground leading-tight max-w-[160px]">
                                          Last active manager — another admin must exist first.
                                        </p>
                                      ) : null}
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={activeBusyId === m.id}
                                      onClick={() => void handleSetActive(m.id, true)}
                                      className="h-9 px-3 rounded-lg bg-primary/10 text-primary text-xs font-bold hover:bg-primary/15 disabled:opacity-50 inline-flex items-center gap-1.5"
                                    >
                                      {activeBusyId === m.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
                                      Reactivate
                                    </button>
                                  )
                                ) : null}
                              </div>
                            </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>

                    <div className="space-y-3 pt-2 border-t border-border/60">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                        <Link2 className="size-3.5" aria-hidden />
                        Invite Manager
                      </p>
                      {invite ? (
                        <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Active invite</p>
                          <div className="flex flex-col gap-2">
                            <code className="text-xs font-mono break-all text-foreground bg-background border border-border rounded-lg px-3 py-2">
                              {origin ? `${origin}/register-lab?token=${invite.token}` : "…"}
                            </code>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void handleCopyInviteUrl(lab.id, invite.token)}
                                className="h-10 px-4 rounded-lg border border-border bg-background font-bold text-xs inline-flex items-center justify-center gap-2 hover:bg-muted/50"
                              >
                                {copyLabId === lab.id ? (
                                  <Check className="size-4 text-green-600" aria-hidden />
                                ) : (
                                  <Copy className="size-4" aria-hidden />
                                )}
                                {copyLabId === lab.id ? "Copied" : "Copy link"}
                              </button>
                              <button
                                type="button"
                                disabled={revokingInviteId === invite.id}
                                onClick={() => void handleRevokeInvite(invite)}
                                className="h-10 px-4 rounded-lg border border-destructive/40 text-destructive font-bold text-xs hover:bg-destructive/10 disabled:opacity-50 inline-flex items-center gap-2"
                              >
                                {revokingInviteId === invite.id ? (
                                  <Loader2 className="size-4 animate-spin" aria-hidden />
                                ) : null}
                                Revoke
                              </button>
                            </div>
                            <p className="text-xs text-muted-foreground font-mono">Token: {shortenToken(invite.token)}</p>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={generatingLabId === lab.id}
                          onClick={() => void handleGenerateInvite(lab)}
                          className="w-full sm:w-auto h-11 px-6 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-sm hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-2"
                        >
                          {generatingLabId === lab.id ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                          Generate invite
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </main>

      {roleModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
            <div className="flex justify-between items-center px-6 py-4 border-b border-border bg-muted/30">
              <h4 className="font-bold text-lg text-foreground">
                {roleModal.targetRole === "manager" ? "Promote to Manager" : "Demote to Technician"}
              </h4>
              <button
                type="button"
                onClick={() => setRoleModal(null)}
                className="p-2 rounded-full hover:bg-muted text-muted-foreground"
                aria-label="Close"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">
                Change <span className="font-bold text-foreground">{roleModal.memberName}</span> at{" "}
                <span className="font-bold text-foreground">{roleModal.labName}</span> to{" "}
                <span className="font-bold text-foreground">
                  {roleModal.targetRole === "manager" ? "Manager" : "Technician"}
                </span>
                ? They may need to sign out and back in for some permissions to update.
              </p>
            </div>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 px-6 py-4 border-t border-border bg-muted/20">
              <button
                type="button"
                onClick={() => setRoleModal(null)}
                className="h-11 px-5 rounded-xl border border-border bg-background font-bold text-sm text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={roleBusyId === roleModal.memberId}
                onClick={() => void confirmRoleChange()}
                className="h-11 px-6 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-sm hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {roleBusyId === roleModal.memberId ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deactivateModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
            <div className="flex justify-between items-center px-6 py-4 border-b border-border bg-muted/30">
              <h4 className="font-bold text-lg text-foreground">Deactivate Member</h4>
              <button
                type="button"
                onClick={() => setDeactivateModal(null)}
                className="p-2 rounded-full hover:bg-muted text-muted-foreground"
                aria-label="Close"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">
                Deactivate <span className="font-bold text-foreground">{deactivateModal.memberName}</span> at{" "}
                <span className="font-bold text-foreground">{deactivateModal.labName}</span>?
                They will lose all access immediately. This is reversible.
              </p>
            </div>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 px-6 py-4 border-t border-border bg-muted/20">
              <button
                type="button"
                onClick={() => setDeactivateModal(null)}
                className="h-11 px-5 rounded-xl border border-border bg-background font-bold text-sm text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={activeBusyId === deactivateModal.memberId}
                onClick={() => void confirmDeactivate()}
                className="h-11 px-6 rounded-xl bg-destructive text-destructive-foreground font-bold text-sm shadow-sm hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {activeBusyId === deactivateModal.memberId ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Deactivate
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
