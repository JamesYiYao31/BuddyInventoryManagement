"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Loader2,
  FlaskConical,
  Link2,
  Copy,
  Check,
  Archive,
  RotateCcw,
  Eye,
  Shield,
  Building2,
  Plus,
  X,
  ChevronRight,
  CreditCard,
  Settings,
  LogOut,
  ShieldAlert,
} from "lucide-react"
import type { User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import { voluntarySignOut, deactivatedSignOut } from "@/lib/active-session"
import { resolveMfaGateRedirect } from "@/lib/mfa-gate"
import { recordSecurityEvent } from "@/lib/security-log"
import { formatRenewalDate } from "@/lib/format-renewal-date"
import { resolveBillingOverviewErrorCode } from "@/lib/billing-overview-error-code"
import type {
  Anomaly,
  EventRow,
  TenantRow,
} from "@/lib/billing-overview-model"
import { ProfileSettingsDialog } from "@/components/dashboard/profile-settings-dialog"
import { SecurityLogPanel } from "@/components/dashboard/security-log-panel"

type OrganizationRow = {
  id: string
  name: string
  plan: string
  trial_ends_at: string | null
  created_at: string
  created_by: string | null
}

type LabRow = {
  id: string
  name: string
  created_at: string
  is_archived: boolean
  archived_at: string | null
  org_id: string | null
  trial_ends_at: string | null
}

type InviteRow = {
  id: string
  lab_name: string
  token: string
  used: boolean
  created_at: string
  role: string | null
  org_id: string | null
  lab_id: string | null
  created_by: string | null
  revoked_at: string | null
}

type InlineMsg = { kind: "success" | "error"; text: string } | null

type ProvisionMode = "single" | "organization"

type LabsFilterType = "all" | "single" | "organization"

type LabsFilterStatus = "all" | "active" | "archived"

type GroupedLabDisplay =
  | { kind: "single"; lab: LabRow }
  | { kind: "org"; org: OrganizationRow; labs: LabRow[] }

function InlineAlert({ msg }: { msg: InlineMsg }) {
  if (!msg) return null
  const cls =
    msg.kind === "success"
      ? "text-green-700 dark:text-green-400 bg-green-500/10 border-green-500/20"
      : "text-destructive bg-destructive/10 border-destructive/20"
  return (
    <p role="status" className={`text-sm font-medium rounded-xl border px-4 py-3 ${cls}`}>
      {msg.text}
    </p>
  )
}

function labMatchesStatus(lab: LabRow, status: LabsFilterStatus) {
  if (status === "all") return true
  if (status === "active") return !lab.is_archived
  return lab.is_archived
}

export default function SuperAdminPage() {
  const router = useRouter()

  const [gateLoading, setGateLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [authUser, setAuthUser] = useState<User | null>(null)
  const [profileDialogOpen, setProfileDialogOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const [provisionMode, setProvisionMode] = useState<ProvisionMode>("single")

  const [labNameInput, setLabNameInput] = useState("")
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null)
  const [copyDone, setCopyDone] = useState(false)
  const [generateBusy, setGenerateBusy] = useState(false)
  const [generateMsg, setGenerateMsg] = useState<InlineMsg>(null)

  const [orgNameInput, setOrgNameInput] = useState("")
  const [orgLabNameInputs, setOrgLabNameInputs] = useState<string[]>([""])
  const [orgGeneratedUrl, setOrgGeneratedUrl] = useState<string | null>(null)
  const [orgCopyDone, setOrgCopyDone] = useState(false)
  const [orgCreateBusy, setOrgCreateBusy] = useState(false)
  const [orgCreateMsg, setOrgCreateMsg] = useState<InlineMsg>(null)

  const [organizations, setOrganizations] = useState<OrganizationRow[]>([])
  const [labs, setLabs] = useState<LabRow[]>([])
  const [invites, setInvites] = useState<InviteRow[]>([])
  const [creatorNameById, setCreatorNameById] = useState<Record<string, string>>({})
  const [orgsLoading, setOrgsLoading] = useState(false)
  const [labsLoading, setLabsLoading] = useState(false)
  const [invitesLoading, setInvitesLoading] = useState(false)
  const [labRowBusyId, setLabRowBusyId] = useState<string | null>(null)
  const [labsMsg, setLabsMsg] = useState<InlineMsg>(null)
  const [invitesTableMsg, setInvitesTableMsg] = useState<InlineMsg>(null)

  const [billingTenants, setBillingTenants] = useState<TenantRow[]>([])
  const [billingAnomalies, setBillingAnomalies] = useState<Anomaly[]>([])
  const [billingEvents, setBillingEvents] = useState<EventRow[]>([])
  const [billingGeneratedAt, setBillingGeneratedAt] = useState<string | null>(null)
  const [billingOverviewLoading, setBillingOverviewLoading] = useState(false)
  const [billingOverviewError, setBillingOverviewError] = useState<{
    status: number
    code: string
  } | null>(null)

  const [labsSearch, setLabsSearch] = useState("")
  const [labsTypeFilter, setLabsTypeFilter] = useState<LabsFilterType>("all")
  const [labsStatusFilter, setLabsStatusFilter] = useState<LabsFilterStatus>("all")

  const fetchOrganizations = useCallback(async () => {
    setOrgsLoading(true)
    const { data, error } = await supabase
      .from("organizations")
      .select("id, name, plan, trial_ends_at, created_at, created_by")
      .order("created_at", { ascending: false })

    setOrgsLoading(false)
    if (error) {
      setLabsMsg({ kind: "error", text: `Could not load organizations: ${error.message}` })
      setOrganizations([])
      return
    }
    setOrganizations((data as OrganizationRow[]) || [])
  }, [])

  const fetchLabs = useCallback(async () => {
    setLabsLoading(true)
    const { data, error } = await supabase
      .from("labs")
      .select("id, name, created_at, is_archived, archived_at, org_id, trial_ends_at")
      .order("created_at", { ascending: false })

    setLabsLoading(false)
    if (error) {
      setLabsMsg({ kind: "error", text: `Could not load labs: ${error.message}` })
      setLabs([])
      return
    }
    setLabs((data as LabRow[]) || [])
  }, [])

  const fetchBillingOverview = useCallback(async () => {
    setBillingOverviewLoading(true)
    setBillingOverviewError(null)
    try {
      // Same bearer pattern as lib/create-checkout.ts (0a).
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setBillingOverviewError({ status: 401, code: "not_authenticated" })
        setBillingTenants([])
        setBillingAnomalies([])
        setBillingEvents([])
        setBillingGeneratedAt(null)
        return
      }

      const response = await fetch("/api/super-admin/billing-overview", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      })

      if (!response.ok) {
        const bodyText = await response.text()
        const code = resolveBillingOverviewErrorCode(bodyText)
        setBillingOverviewError({
          status: response.status,
          code,
        })
        setBillingTenants([])
        setBillingAnomalies([])
        setBillingEvents([])
        setBillingGeneratedAt(null)
        return
      }

      const data = (await response.json().catch(() => ({}))) as {
        tenants?: TenantRow[]
        anomalies?: Anomaly[]
        events?: EventRow[]
        generatedAt?: string
      }

      setBillingTenants(Array.isArray(data.tenants) ? data.tenants : [])
      setBillingAnomalies(Array.isArray(data.anomalies) ? data.anomalies : [])
      setBillingEvents(Array.isArray(data.events) ? data.events : [])
      setBillingGeneratedAt(
        typeof data.generatedAt === "string" ? data.generatedAt : null,
      )
    } catch {
      setBillingOverviewError({ status: 0, code: "request_failed" })
      setBillingTenants([])
      setBillingAnomalies([])
      setBillingEvents([])
      setBillingGeneratedAt(null)
    } finally {
      setBillingOverviewLoading(false)
    }
  }, [])

  const fetchInvites = useCallback(async () => {
    setInvitesLoading(true)
    const { data, error } = await supabase
      .from("lab_invites")
      .select("id, lab_name, token, used, created_at, role, org_id, lab_id, created_by, revoked_at")
      .order("created_at", { ascending: false })

    setInvitesLoading(false)
    if (error) {
      setInvitesTableMsg({ kind: "error", text: `Could not load invites: ${error.message}` })
      setInvites([])
      setCreatorNameById({})
      return
    }
    setInvitesTableMsg(null)
    const rows = (data as InviteRow[]) || []
    setInvites(rows)

    const ids = [...new Set(rows.map((r) => r.created_by).filter(Boolean))] as string[]
    if (ids.length === 0) {
      setCreatorNameById({})
      return
    }
    const { data: profs, error: profErr } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", ids)

    if (profErr) {
      setCreatorNameById({})
      return
    }
    const map: Record<string, string> = {}
    for (const p of profs || []) {
      if (p.id) map[p.id] = (p as { full_name: string | null }).full_name || "Unknown"
    }
    setCreatorNameById(map)
  }, [])

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setGateLoading(true)
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.user) {
        if (!cancelled) router.replace("/")
        return
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role, is_active")
        .eq("id", session.user.id)
        .maybeSingle()

      if (cancelled) return

      if (profile?.is_active === false) {
        await deactivatedSignOut(router, session.user.id)
        return
      }

      if (profileError || profile?.role !== "super_admin") {
        router.replace("/dashboard")
        return
      }

      const mfaRedirect = await resolveMfaGateRedirect("/super-admin")
      if (mfaRedirect) {
        if (!cancelled) router.replace(mfaRedirect)
        return
      }

      setAuthUser(session.user)
      setAuthorized(true)
      setGateLoading(false)
      await Promise.all([
        fetchOrganizations(),
        fetchLabs(),
        fetchBillingOverview(),
        fetchInvites(),
      ])
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [router, fetchOrganizations, fetchLabs, fetchBillingOverview, fetchInvites])

  const refreshAll = useCallback(async () => {
    await Promise.all([
      fetchOrganizations(),
      fetchLabs(),
      fetchBillingOverview(),
      fetchInvites(),
    ])
  }, [fetchOrganizations, fetchLabs, fetchBillingOverview, fetchInvites])

  const orgById = useMemo(() => new Map(organizations.map((o) => [o.id, o])), [organizations])

  const groupedLabDisplay = useMemo((): GroupedLabDisplay[] => {
    const q = labsSearch.trim().toLowerCase()

    const labMatchesSearch = (lab: LabRow, orgName: string | null) => {
      if (!q) return true
      if (lab.name.toLowerCase().includes(q)) return true
      if (orgName && orgName.toLowerCase().includes(q)) return true
      return false
    }

    const filteredLabs = labs.filter((lab) => {
      if (!labMatchesStatus(lab, labsStatusFilter)) return false
      const orgName = lab.org_id ? orgById.get(lab.org_id)?.name ?? null : null
      return labMatchesSearch(lab, orgName)
    })

    if (labsTypeFilter === "single") {
      return filteredLabs
        .filter((l) => !l.org_id)
        .map((lab) => ({ kind: "single" as const, lab }))
    }

    if (labsTypeFilter === "organization") {
      const byOrg = new Map<string, LabRow[]>()
      for (const l of filteredLabs) {
        if (!l.org_id) continue
        if (!byOrg.has(l.org_id)) byOrg.set(l.org_id, [])
        byOrg.get(l.org_id)!.push(l)
      }
      const groups: GroupedLabDisplay[] = []
      for (const [orgId, labList] of byOrg) {
        const org = orgById.get(orgId)
        if (org && labList.length > 0) {
          labList.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          groups.push({ kind: "org", org, labs: labList })
        }
      }
      groups.sort((a, b) => {
        if (a.kind !== "org" || b.kind !== "org") return 0
        return new Date(b.org.created_at).getTime() - new Date(a.org.created_at).getTime()
      })
      return groups
    }

    const singles: GroupedLabDisplay[] = filteredLabs
      .filter((l) => !l.org_id)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .map((lab) => ({ kind: "single" as const, lab }))

    const byOrg = new Map<string, LabRow[]>()
    for (const l of filteredLabs) {
      if (!l.org_id) continue
      if (!byOrg.has(l.org_id)) byOrg.set(l.org_id, [])
      byOrg.get(l.org_id)!.push(l)
    }
    const orgGroups: GroupedLabDisplay[] = []
    for (const [orgId, labList] of byOrg) {
      const org = orgById.get(orgId)
      if (org && labList.length > 0) {
        labList.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        orgGroups.push({ kind: "org", org, labs: labList })
      }
    }
    orgGroups.sort((a, b) => {
      if (a.kind !== "org" || b.kind !== "org") return 0
      return new Date(b.org.created_at).getTime() - new Date(a.org.created_at).getTime()
    })

    return [...singles, ...orgGroups]
  }, [labs, labsSearch, labsTypeFilter, labsStatusFilter, orgById])

  const sortedBillingTenants = useMemo(() => {
    const rank = (status: string | null): number => {
      switch (status) {
        case "past_due":
          return 0
        case "suspended":
          return 1
        case "trialing":
          return 2
        case "active":
          return 3
        case null:
          return 4
        default:
          return 5
      }
    }
    return [...billingTenants].sort((a, b) => {
      const r = rank(a.billingStatus) - rank(b.billingStatus)
      if (r !== 0) return r
      return a.name.localeCompare(b.name)
    })
  }, [billingTenants])

  const trialCount = useMemo(
    () => billingTenants.filter((r) => r.billingStatus === "trialing").length,
    [billingTenants],
  )

  const expiringThisWeek = useMemo(() => {
    const now = new Date()
    const cutoff = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    return billingTenants.filter((r) => {
      if (r.billingStatus !== "trialing" || !r.currentPeriodEnd) return false
      const ends = new Date(r.currentPeriodEnd)
      return ends >= now && ends <= cutoff
    }).length
  }, [billingTenants])

  const activeCount = useMemo(
    () => billingTenants.filter((r) => r.billingStatus === "active").length,
    [billingTenants],
  )

  function anomalyKindLabel(kind: Anomaly["kind"]): string {
    switch (kind) {
      case "org_lab_billing_row":
        return "Org-lab billing row"
      case "orphan_billing_row":
        return "Orphan billing row"
      case "stale_unapplied_event":
        return "Stale unapplied event"
      case "period_end_passed":
        return "Period end passed"
      default:
        return kind
    }
  }

  function tenantStatusLabel(status: string | null): string {
    if (status === null) return "No billing account"
    if (status === "past_due") return "Payment issue"
    return status.replace(/_/g, " ")
  }

  function tenantStatusBadgeClass(status: string | null): string {
    switch (status) {
      case "active":
        return "bg-green-500/15 text-green-800 dark:text-green-400"
      case "trialing":
        return "bg-amber-500/15 text-amber-800 dark:text-amber-400"
      case "past_due":
        return "bg-amber-500/15 text-amber-800 dark:text-amber-400"
      case "suspended":
        return "bg-red-500/15 text-red-800 dark:text-red-400"
      case null:
        return "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400"
      default:
        return "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400"
    }
  }

  function truncateStripeId(id: string): string {
    if (id.length <= 14) return id
    return `${id.slice(0, 8)}…${id.slice(-4)}`
  }

  async function copyStripeId(id: string) {
    try {
      await navigator.clipboard.writeText(id)
    } catch {
      // Clipboard may be unavailable; title still exposes the full id.
    }
  }

  const handleGenerateInvite = async () => {
    setGenerateMsg(null)
    setGeneratedUrl(null)
    setCopyDone(false)

    const name = labNameInput.trim()
    if (!name) {
      setGenerateMsg({ kind: "error", text: "Enter a lab name." })
      return
    }

    setGenerateBusy(true)

    const { data: existingLab } = await supabase
      .from("labs")
      .select("id")
      .ilike("name", name)
      .maybeSingle()

    if (existingLab) {
      setGenerateMsg({
        kind: "error",
        text: `A lab named "${name}" already exists.`,
      })
      setGenerateBusy(false)
      return
    }

    const { data: existingInvite } = await supabase
      .from("lab_invites")
      .select("id")
      .ilike("lab_name", name)
      .eq("used", false)
      .maybeSingle()

    if (existingInvite) {
      setGenerateMsg({
        kind: "error",
        text: `An unused invite for "${name}" already exists.`,
      })
      setGenerateBusy(false)
      return
    }

    const token = crypto.randomUUID()
    const { error } = await supabase.from("lab_invites").insert({
      token,
      lab_name: name,
      used: false,
    })
    setGenerateBusy(false)

    if (error) {
      setGenerateMsg({ kind: "error", text: error.message })
      return
    }

    const url = `${window.location.origin}/register-lab?token=${token}`
    setGeneratedUrl(url)
    setLabNameInput("")
    setGenerateMsg({ kind: "success", text: "Invite link created." })
    await refreshAll()
  }

  const handleCopyUrl = async () => {
    if (!generatedUrl) return
    try {
      await navigator.clipboard.writeText(generatedUrl)
      setCopyDone(true)
      setTimeout(() => setCopyDone(false), 2000)
    } catch {
      setGenerateMsg({ kind: "error", text: "Could not copy to clipboard." })
    }
  }

  const handleCopyOrgUrl = async () => {
    if (!orgGeneratedUrl) return
    try {
      await navigator.clipboard.writeText(orgGeneratedUrl)
      setOrgCopyDone(true)
      setTimeout(() => setOrgCopyDone(false), 2000)
    } catch {
      setOrgCreateMsg({ kind: "error", text: "Could not copy to clipboard." })
    }
  }

  const addOrgLabRow = () => {
    setOrgLabNameInputs((prev) => (prev.length >= 10 ? prev : [...prev, ""]))
  }

  const removeOrgLabRow = (index: number) => {
    setOrgLabNameInputs((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((_, i) => i !== index)
    })
  }

  const updateOrgLabRow = (index: number, value: string) => {
    setOrgLabNameInputs((prev) => prev.map((s, i) => (i === index ? value : s)))
  }

  const handleCreateOrganization = async () => {
    setOrgCreateMsg(null)
    setOrgGeneratedUrl(null)
    setOrgCopyDone(false)

    const orgName = orgNameInput.trim()
    if (!orgName) {
      setOrgCreateMsg({ kind: "error", text: "Enter an organization name." })
      return
    }

    const trimmedLabs = orgLabNameInputs.map((s) => s.trim())
    if (trimmedLabs.some((t) => t === "")) {
      setOrgCreateMsg({
        kind: "error",
        text: "Every lab name field must be filled. Remove extra rows or enter a name for each.",
      })
      return
    }

    const lowerSet = new Set(trimmedLabs.map((t) => t.toLowerCase()))
    if (lowerSet.size !== trimmedLabs.length) {
      setOrgCreateMsg({
        kind: "error",
        text: "Duplicate lab names in this form. Each lab must have a unique name.",
      })
      return
    }

    setOrgCreateBusy(true)

    const {
      data: { session },
    } = await supabase.auth.getSession()
    const userId = session?.user?.id
    if (!userId) {
      setOrgCreateMsg({ kind: "error", text: "You must be signed in to create an organization." })
      setOrgCreateBusy(false)
      return
    }

    const { data: existingOrg } = await supabase
      .from("organizations")
      .select("id")
      .ilike("name", orgName)
      .maybeSingle()

    if (existingOrg) {
      setOrgCreateMsg({
        kind: "error",
        text: `An organization named "${orgName}" already exists.`,
      })
      setOrgCreateBusy(false)
      return
    }

    for (const labName of trimmedLabs) {
      const { data: conflictLab } = await supabase.from("labs").select("id").ilike("name", labName).maybeSingle()
      if (conflictLab) {
        setOrgCreateMsg({
          kind: "error",
          text: `A lab named "${labName}" already exists in the database. Choose a different name.`,
        })
        setOrgCreateBusy(false)
        return
      }
    }

    const { data: existingOrgInvite } = await supabase
      .from("lab_invites")
      .select("id")
      .ilike("lab_name", orgName)
      .eq("role", "org_admin")
      .eq("used", false)
      .is("revoked_at", null)
      .maybeSingle()

    if (existingOrgInvite) {
      setOrgCreateMsg({
        kind: "error",
        text: `An unused org admin invite for "${orgName}" already exists.`,
      })
      setOrgCreateBusy(false)
      return
    }

    const { data: newOrg, error: orgErr } = await supabase
      .from("organizations")
      .insert({
        name: orgName,
        created_by: userId,
      })
      .select("id")
      .single()

    if (orgErr || !newOrg?.id) {
      setOrgCreateMsg({
        kind: "error",
        text: orgErr?.message || "Could not create organization.",
      })
      setOrgCreateBusy(false)
      return
    }

    const orgId = newOrg.id as string
    const createdLabIds: string[] = []
    let lastLabError: string | null = null

    for (const labName of trimmedLabs) {
      const techKey = `provision-${crypto.randomUUID()}`
      const { data: labRow, error: labInsErr } = await supabase
        .from("labs")
        .insert({
          name: labName,
          org_id: orgId,
          tech_key: techKey,
        })
        .select("id")
        .single()

      if (labInsErr || !labRow?.id) {
        lastLabError = labInsErr?.message || "Unknown error creating lab."
        break
      }
      createdLabIds.push(labRow.id as string)
    }

    if (lastLabError) {
      setOrgCreateMsg({
        kind: "error",
        text:
          `Organization was created (id: ${orgId}), but lab provisioning failed: ${lastLabError}. ` +
          `Labs created so far: ${createdLabIds.length} of ${trimmedLabs.length}. ` +
          `Please fix data in Supabase or clean up manually.`,
      })
      setOrgCreateBusy(false)
      await refreshAll()
      return
    }

    const { data: activeOrgAdminInvite } = await supabase
      .from("lab_invites")
      .select("id")
      .eq("org_id", orgId)
      .eq("role", "org_admin")
      .eq("used", false)
      .is("revoked_at", null)
      .maybeSingle()

    if (activeOrgAdminInvite) {
      setOrgCreateMsg({
        kind: "error",
        text:
          `Organization and labs were created (org id: ${orgId}), but an active org admin invite already exists for this organization. ` +
          `Revoke or use the existing invite before creating another.`,
      })
      setOrgCreateBusy(false)
      await refreshAll()
      return
    }

    const token = crypto.randomUUID()
    const { error: inviteErr } = await supabase.from("lab_invites").insert({
      token,
      lab_name: orgName,
      used: false,
      org_id: orgId,
      lab_id: null,
      role: "org_admin",
      created_by: userId,
    })

    if (inviteErr) {
      setOrgCreateMsg({
        kind: "error",
        text:
          `Organization and ${trimmedLabs.length} lab(s) were created (org id: ${orgId}), but the org admin invite failed: ${inviteErr.message}. ` +
          `Create the invite manually or clean up in Supabase.`,
      })
      setOrgCreateBusy(false)
      await refreshAll()
      return
    }

    setOrgCreateBusy(false)
    const url = `${window.location.origin}/register-lab?token=${token}`
    setOrgGeneratedUrl(url)
    setOrgNameInput("")
    setOrgLabNameInputs([""])
    setOrgCreateMsg({
      kind: "success",
      text: `Organization "${orgName}" created with ${trimmedLabs.length} lab(s). Org admin invite link is ready.`,
    })
    await refreshAll()
  }

  const handleArchiveLab = async (lab: LabRow) => {
    setLabsMsg(null)
    setLabRowBusyId(lab.id)
    const { error } = await supabase
      .from("labs")
      .update({ is_archived: true, archived_at: new Date().toISOString() })
      .eq("id", lab.id)
    setLabRowBusyId(null)

    if (error) {
      setLabsMsg({ kind: "error", text: error.message })
      return
    }
    setLabsMsg({ kind: "success", text: `Archived "${lab.name}".` })
    await refreshAll()
  }

  const handleRestoreLab = async (lab: LabRow) => {
    setLabsMsg(null)
    setLabRowBusyId(lab.id)
    const { error } = await supabase
      .from("labs")
      .update({ is_archived: false, archived_at: null })
      .eq("id", lab.id)
    setLabRowBusyId(null)

    if (error) {
      setLabsMsg({ kind: "error", text: error.message })
      return
    }
    setLabsMsg({ kind: "success", text: `Restored "${lab.name}".` })
    await refreshAll()
  }

  const handleViewLab = (lab: LabRow) => {
    router.push(`/super-admin/labs/${lab.id}`)
  }

  const handleViewOrganization = (org: OrganizationRow) => {
    router.push(`/super-admin/orgs/${org.id}`)
  }

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    } catch {
      return iso
    }
  }

  const shortenToken = (t: string) => (t.length <= 8 ? t : `${t.slice(0, 8)}...`)

  const inviteRoleLabel = (role: string | null) =>
    role === "org_admin" ? "Org Admin" : "Manager"

  const inviteCreatorLabel = (createdBy: string | null) => {
    if (!createdBy) return "Super Admin"
    return creatorNameById[createdBy] || "Unknown"
  }

  const labsTableLoading = labsLoading || orgsLoading

  const handleSignOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    await recordSecurityEvent("logout", "success")
    await voluntarySignOut(authUser?.id)
    router.replace("/login")
  }

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
        <div className="mx-auto max-w-6xl px-6 py-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-primary/10 shrink-0">
              <Shield className="size-6 text-primary" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-black tracking-tight truncate">Super Admin</h1>
              <p className="text-xs text-muted-foreground truncate">Lab Inventory Management internal control panel</p>
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
              disabled={signingOut}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-border bg-background text-sm font-bold hover:bg-muted/50 disabled:opacity-50"
            >
              <LogOut className="size-4" aria-hidden />
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      </header>

      <ProfileSettingsDialog
        open={profileDialogOpen}
        onOpenChange={setProfileDialogOpen}
        user={authUser}
        role="super_admin"
      />

      <main className="mx-auto max-w-6xl px-6 py-10 space-y-12">
        {/* Section 1 — Provisioning */}
        <section className="rounded-2xl border border-border bg-card p-8 shadow-sm space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10">
              <Link2 className="size-5 text-primary" aria-hidden />
            </div>
            <div>
              <h2 className="text-lg font-bold">Provisioning</h2>
              <p className="text-xs text-muted-foreground">Create a single-lab invite or a multi-lab organization.</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 p-1 rounded-xl bg-muted/40 border border-border">
            <button
              type="button"
              onClick={() => {
                setProvisionMode("single")
                setOrgCreateMsg(null)
              }}
              className={`flex-1 min-w-[140px] h-10 rounded-lg text-xs font-bold transition-colors ${
                provisionMode === "single"
                  ? "bg-background text-foreground shadow-sm border border-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Single lab
            </button>
            <button
              type="button"
              onClick={() => {
                setProvisionMode("organization")
                setGenerateMsg(null)
              }}
              className={`flex-1 min-w-[140px] h-10 rounded-lg text-xs font-bold transition-colors ${
                provisionMode === "organization"
                  ? "bg-background text-foreground shadow-sm border border-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Organization
            </button>
          </div>

          {provisionMode === "single" ? (
            <>
              <InlineAlert msg={generateMsg} />

              <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
                <div className="flex-1 space-y-2">
                  <label
                    htmlFor="super-admin-lab-name"
                    className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1"
                  >
                    Lab name
                  </label>
                  <input
                    id="super-admin-lab-name"
                    type="text"
                    value={labNameInput}
                    onChange={(e) => setLabNameInput(e.target.value)}
                    placeholder="e.g. Acme Diagnostics Lab"
                    className="w-full h-12 border border-input bg-background rounded-xl px-4 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <button
                  type="button"
                  disabled={generateBusy}
                  onClick={() => void handleGenerateInvite()}
                  className="h-12 px-6 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-sm hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none inline-flex items-center justify-center gap-2"
                >
                  {generateBusy ? <Loader2 className="size-4 animate-spin" /> : null}
                  Generate invite link
                </button>
              </div>

              {generatedUrl && (
                <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Generated URL</p>
                  <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <code className="flex-1 text-xs font-mono break-all text-foreground bg-background border border-border rounded-lg px-3 py-2">
                      {generatedUrl}
                    </code>
                    <button
                      type="button"
                      onClick={() => void handleCopyUrl()}
                      className="shrink-0 h-10 px-4 rounded-lg border border-border bg-background font-bold text-xs inline-flex items-center justify-center gap-2 hover:bg-muted/50"
                    >
                      {copyDone ? <Check className="size-4 text-green-600" /> : <Copy className="size-4" />}
                      {copyDone ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <InlineAlert msg={orgCreateMsg} />

              <div className="space-y-2">
                <label
                  htmlFor="super-admin-org-name"
                  className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1"
                >
                  Organization name
                </label>
                <input
                  id="super-admin-org-name"
                  type="text"
                  value={orgNameInput}
                  onChange={(e) => setOrgNameInput(e.target.value)}
                  placeholder="e.g. City Blood Bank"
                  className="w-full h-12 border border-input bg-background rounded-xl px-4 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="space-y-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">Labs in this organization</p>
                {orgLabNameInputs.map((val, index) => (
                  <div key={index} className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={val}
                      onChange={(e) => updateOrgLabRow(index, e.target.value)}
                      placeholder={`Lab ${index + 1} name`}
                      className="flex-1 h-12 border border-input bg-background rounded-xl px-4 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20"
                    />
                    {orgLabNameInputs.length >= 2 ? (
                      <button
                        type="button"
                        aria-label={`Remove lab row ${index + 1}`}
                        onClick={() => removeOrgLabRow(index)}
                        className="shrink-0 size-12 rounded-xl border border-border bg-background flex items-center justify-center hover:bg-muted/50"
                      >
                        <X className="size-4" />
                      </button>
                    ) : null}
                  </div>
                ))}
                <button
                  type="button"
                  disabled={orgLabNameInputs.length >= 10}
                  onClick={addOrgLabRow}
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-dashed border-border text-xs font-bold text-primary hover:bg-primary/5 disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Plus className="size-4" />
                  Add another lab
                </button>
                <p className="text-xs text-muted-foreground">Up to 10 labs. Each name must be unique and must not match an existing lab.</p>
              </div>

              <button
                type="button"
                disabled={orgCreateBusy}
                onClick={() => void handleCreateOrganization()}
                className="h-12 px-6 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-sm hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none inline-flex items-center justify-center gap-2"
              >
                {orgCreateBusy ? <Loader2 className="size-4 animate-spin" /> : null}
                Create organization
              </button>

              {orgGeneratedUrl && (
                <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Org admin invite URL</p>
                  <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <code className="flex-1 text-xs font-mono break-all text-foreground bg-background border border-border rounded-lg px-3 py-2">
                      {orgGeneratedUrl}
                    </code>
                    <button
                      type="button"
                      onClick={() => void handleCopyOrgUrl()}
                      className="shrink-0 h-10 px-4 rounded-lg border border-border bg-background font-bold text-xs inline-flex items-center justify-center gap-2 hover:bg-muted/50"
                    >
                      {orgCopyDone ? <Check className="size-4 text-green-600" /> : <Copy className="size-4" />}
                      {orgCopyDone ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        {/* Billing Overview */}
        <section className="rounded-2xl border border-border bg-card p-8 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-primary/10">
                <CreditCard className="size-5 text-primary" aria-hidden />
              </div>
              <div>
                <h2 className="text-lg font-bold">Billing Overview</h2>
                <p className="text-xs text-muted-foreground">
                  Subscription status from billing accounts (orgs + standalone labs),
                  plus Stripe webhook history.
                </p>
                {billingGeneratedAt ? (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Generated {formatRenewalDate(billingGeneratedAt) ?? "—"}
                  </p>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void fetchBillingOverview()}
              disabled={billingOverviewLoading}
              className="h-10 px-4 rounded-xl border border-border text-sm font-bold hover:bg-muted/50 disabled:opacity-50 disabled:pointer-events-none inline-flex items-center justify-center gap-2 shrink-0"
            >
              {billingOverviewLoading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              Refresh
            </button>
          </div>

          {!billingOverviewError ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-800 dark:text-amber-400">
                  Total on Trial
                </p>
                <p className="text-3xl font-black text-amber-700 dark:text-amber-400">
                  {billingOverviewLoading ? "—" : trialCount}
                </p>
              </div>
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-5 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-red-800 dark:text-red-400">
                  Expiring This Week
                </p>
                <p className="text-3xl font-black text-red-700 dark:text-red-400">
                  {billingOverviewLoading ? "—" : expiringThisWeek}
                </p>
              </div>
              <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-5 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-green-800 dark:text-green-400">
                  Total Active
                </p>
                <p className="text-3xl font-black text-green-700 dark:text-green-400">
                  {billingOverviewLoading ? "—" : activeCount}
                </p>
              </div>
            </div>
          ) : null}

          {billingOverviewLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="size-6 text-muted-foreground animate-spin" aria-hidden />
            </div>
          ) : billingOverviewError ? (
            <div
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-4 space-y-1"
            >
              <p className="text-sm font-bold text-destructive">
                Billing overview could not be loaded.
              </p>
              <p className="text-xs text-destructive/90 font-mono">
                HTTP {billingOverviewError.status || "—"} · code=
                {billingOverviewError.code}
              </p>
            </div>
          ) : (
            <>
              <div
                className={
                  billingAnomalies.length === 0
                    ? "rounded-xl border border-border bg-muted/20 px-4 py-3"
                    : "rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 space-y-2"
                }
              >
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Anomalies
                </p>
                {billingAnomalies.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No billing anomalies detected.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {billingAnomalies.map((a, i) => (
                      <li
                        key={`${a.kind}-${i}`}
                        className="text-sm text-amber-900 dark:text-amber-200"
                      >
                        <span className="font-bold">{anomalyKindLabel(a.kind)}</span>
                        <span className="text-amber-800/80 dark:text-amber-200/80">
                          {" "}
                          — {a.detail}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {sortedBillingTenants.length === 0 ? (
                <p className="text-sm text-muted-foreground italic py-4">
                  No billing tenants yet.
                </p>
              ) : (
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/30 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          <th className="text-left px-4 py-3">Name</th>
                          <th className="text-left px-4 py-3">Type</th>
                          <th className="text-right px-4 py-3">Labs</th>
                          <th className="text-left px-4 py-3">Status</th>
                          <th className="text-left px-4 py-3">Current period end</th>
                          <th className="text-right px-4 py-3">Expected $/mo</th>
                          <th className="text-left px-4 py-3">Stripe customer</th>
                          <th className="text-left px-4 py-3">Stripe subscription</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedBillingTenants.map((row) => (
                          <tr key={row.key} className="border-b border-border last:border-0">
                            <td className="px-4 py-3 font-bold text-foreground">
                              {row.name}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">{row.type}</td>
                            <td className="px-4 py-3 text-right font-medium">
                              {row.labCount}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold capitalize ${tenantStatusBadgeClass(row.billingStatus)}`}
                              >
                                {tenantStatusLabel(row.billingStatus)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {formatRenewalDate(row.currentPeriodEnd) ?? "—"}
                            </td>
                            <td className="px-4 py-3 text-right font-medium">
                              {row.expectedMonthlyUsd !== null
                                ? `$${row.expectedMonthlyUsd.toLocaleString("en-US")}`
                                : "—"}
                            </td>
                            <td className="px-4 py-3">
                              {row.stripeCustomerId ? (
                                <button
                                  type="button"
                                  title={row.stripeCustomerId}
                                  onClick={() => void copyStripeId(row.stripeCustomerId!)}
                                  className="font-mono text-xs text-left hover:underline"
                                >
                                  {truncateStripeId(row.stripeCustomerId)}
                                </button>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {row.stripeSubscriptionId ? (
                                <button
                                  type="button"
                                  title={row.stripeSubscriptionId}
                                  onClick={() => void copyStripeId(row.stripeSubscriptionId!)}
                                  className="font-mono text-xs text-left hover:underline"
                                >
                                  {truncateStripeId(row.stripeSubscriptionId)}
                                </button>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-bold">Stripe webhook activity</h3>
                  <p className="text-xs text-muted-foreground">
                    Recent deliveries from processed_stripe_events (newest first).
                  </p>
                </div>
                {billingEvents.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic py-2">
                    No webhook events recorded yet.
                  </p>
                ) : (
                  <div className="rounded-xl border border-border overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border bg-muted/30 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            <th className="text-left px-4 py-3">Received</th>
                            <th className="text-left px-4 py-3">Event type</th>
                            <th className="text-left px-4 py-3">Tenant</th>
                            <th className="text-right px-4 py-3">Amount</th>
                            <th className="text-left px-4 py-3">Applied</th>
                          </tr>
                        </thead>
                        <tbody>
                          {billingEvents.map((ev) => (
                            <tr
                              key={ev.eventId}
                              className="border-b border-border last:border-0"
                            >
                              <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                                {formatRenewalDate(ev.receivedAt) ?? "—"}
                              </td>
                              <td className="px-4 py-3 font-mono text-xs">
                                {ev.eventType}
                              </td>
                              <td className="px-4 py-3">
                                {ev.tenantLabel === "Unresolved" ? (
                                  <span className="text-muted-foreground">
                                    Unresolved
                                    {ev.stripeCustomerId ? (
                                      <>
                                        {" · "}
                                        <button
                                          type="button"
                                          title={ev.stripeCustomerId}
                                          onClick={() =>
                                            void copyStripeId(ev.stripeCustomerId!)
                                          }
                                          className="font-mono text-xs hover:underline"
                                        >
                                          {truncateStripeId(ev.stripeCustomerId)}
                                        </button>
                                      </>
                                    ) : null}
                                  </span>
                                ) : (
                                  ev.tenantLabel
                                )}
                              </td>
                              <td className="px-4 py-3 text-right font-medium">
                                {ev.amountUsd !== null
                                  ? `$${ev.amountUsd.toLocaleString("en-US")}`
                                  : "—"}
                              </td>
                              <td className="px-4 py-3">
                                {ev.appliedAt === null ? (
                                  <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/15 text-amber-800 dark:text-amber-400">
                                    Pending
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">
                                    {formatRenewalDate(ev.appliedAt) ?? "—"}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        {/* Section 2 — All labs */}
        <section className="rounded-2xl border border-border bg-card p-8 shadow-sm space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10">
              <FlaskConical className="size-5 text-primary" aria-hidden />
            </div>
            <div>
              <h2 className="text-lg font-bold">All labs</h2>
              <p className="text-xs text-muted-foreground">Tenants grouped by organization where applicable.</p>
            </div>
          </div>

          <InlineAlert msg={labsMsg} />

          <div className="flex flex-col lg:flex-row gap-3 lg:items-end">
            <div className="flex-1 space-y-2">
              <label htmlFor="labs-search" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">
                Search
              </label>
              <input
                id="labs-search"
                type="search"
                value={labsSearch}
                onChange={(e) => setLabsSearch(e.target.value)}
                placeholder="Lab or organization name"
                className="w-full h-11 border border-input bg-background rounded-xl px-4 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-3 sm:flex-1">
              <div className="flex-1 space-y-2">
                <label htmlFor="labs-type-filter" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">
                  Type
                </label>
                <select
                  id="labs-type-filter"
                  value={labsTypeFilter}
                  onChange={(e) => setLabsTypeFilter(e.target.value as LabsFilterType)}
                  className="w-full h-11 border border-input bg-background rounded-xl px-3 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="all">All</option>
                  <option value="single">Single</option>
                  <option value="organization">Organization</option>
                </select>
              </div>
              <div className="flex-1 space-y-2">
                <label htmlFor="labs-status-filter" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">
                  Status
                </label>
                <select
                  id="labs-status-filter"
                  value={labsStatusFilter}
                  onChange={(e) => setLabsStatusFilter(e.target.value as LabsFilterStatus)}
                  className="w-full h-11 border border-input bg-background rounded-xl px-3 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="all">All</option>
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border overflow-hidden">
            <div className="hidden sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,0.85fr)_minmax(0,0.85fr)_minmax(0,1.5fr)] gap-2 px-4 py-3 bg-muted/30 border-b border-border text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <span>Name</span>
              <span>Created</span>
              <span>Type</span>
              <span>Status</span>
              <span className="text-right sm:text-left">Actions</span>
            </div>

            {labsTableLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="size-6 text-muted-foreground animate-spin" />
              </div>
            ) : labs.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground italic">No labs yet.</div>
            ) : groupedLabDisplay.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground italic">No labs match these filters.</div>
            ) : (
              groupedLabDisplay.map((entry) => {
                if (entry.kind === "single") {
                  const lab = entry.lab
                  return (
                    <div
                      key={lab.id}
                      className="grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,0.85fr)_minmax(0,0.85fr)_minmax(0,1.5fr)] gap-2 px-4 py-4 border-t border-border/60 text-sm items-center"
                    >
                      <span className="font-bold truncate">{lab.name}</span>
                      <span className="text-xs text-muted-foreground font-mono">{formatDate(lab.created_at)}</span>
                      <span>
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/15 text-sky-800 dark:text-sky-300">
                          Single
                        </span>
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
                      <div className="flex flex-wrap gap-2 justify-end sm:justify-start">
                        {!lab.is_archived ? (
                          <button
                            type="button"
                            disabled={labRowBusyId === lab.id}
                            onClick={() => void handleArchiveLab(lab)}
                            className="h-9 px-3 rounded-lg border border-border text-xs font-bold hover:bg-muted/50 disabled:opacity-50 inline-flex items-center gap-1.5"
                          >
                            {labRowBusyId === lab.id ? <Loader2 className="size-3.5 animate-spin" /> : <Archive className="size-3.5" />}
                            Archive
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={labRowBusyId === lab.id}
                            onClick={() => void handleRestoreLab(lab)}
                            className="h-9 px-3 rounded-lg border border-border text-xs font-bold hover:bg-muted/50 disabled:opacity-50 inline-flex items-center gap-1.5"
                          >
                            {labRowBusyId === lab.id ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                            Restore
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleViewLab(lab)}
                          className="h-9 px-3 rounded-lg bg-primary/10 text-primary text-xs font-bold hover:bg-primary/15 inline-flex items-center gap-1.5"
                        >
                          <Eye className="size-3.5" />
                          View lab
                        </button>
                      </div>
                    </div>
                  )
                }

                const { org, labs: orgLabs } = entry
                return (
                  <div key={org.id} className="border-t border-border/60">
                    <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,0.85fr)_minmax(0,0.85fr)_minmax(0,1.5fr)] gap-2 px-4 py-4 text-sm items-center bg-muted/20">
                      <span className="font-bold truncate flex items-center gap-2 min-w-0">
                        <ChevronRight className="size-4 text-muted-foreground shrink-0" aria-hidden />
                        <Building2 className="size-4 text-primary shrink-0" aria-hidden />
                        <span className="truncate">{org.name}</span>
                      </span>
                      <span className="text-xs text-muted-foreground font-mono">{formatDate(org.created_at)}</span>
                      <span>
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-500/15 text-violet-800 dark:text-violet-300">
                          Organization
                        </span>
                      </span>
                      <span className="text-xs text-muted-foreground font-medium">{orgLabs.length} lab(s)</span>
                      <div className="flex flex-wrap gap-2 justify-end sm:justify-start">
                        <button
                          type="button"
                          onClick={() => handleViewOrganization(org)}
                          className="h-9 px-3 rounded-lg bg-primary/10 text-primary text-xs font-bold hover:bg-primary/15 inline-flex items-center gap-1.5"
                        >
                          <Eye className="size-3.5" />
                          View organization
                        </button>
                      </div>
                    </div>
                    {orgLabs.map((lab) => (
                      <div
                        key={lab.id}
                        className="grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,0.85fr)_minmax(0,0.85fr)_minmax(0,1.5fr)] gap-2 pl-4 sm:pl-10 pr-4 py-3 border-t border-border/40 text-sm items-center"
                      >
                        <span className="font-bold truncate text-muted-foreground">{lab.name}</span>
                        <span className="text-xs text-muted-foreground font-mono">{formatDate(lab.created_at)}</span>
                        <span>
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-border/80 text-muted-foreground">
                            Lab
                          </span>
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
                        <div className="flex flex-wrap gap-2 justify-end sm:justify-start">
                          {!lab.is_archived ? (
                            <button
                              type="button"
                              disabled={labRowBusyId === lab.id}
                              onClick={() => void handleArchiveLab(lab)}
                              className="h-9 px-3 rounded-lg border border-border text-xs font-bold hover:bg-muted/50 disabled:opacity-50 inline-flex items-center gap-1.5"
                            >
                              {labRowBusyId === lab.id ? <Loader2 className="size-3.5 animate-spin" /> : <Archive className="size-3.5" />}
                              Archive
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={labRowBusyId === lab.id}
                              onClick={() => void handleRestoreLab(lab)}
                              className="h-9 px-3 rounded-lg border border-border text-xs font-bold hover:bg-muted/50 disabled:opacity-50 inline-flex items-center gap-1.5"
                            >
                              {labRowBusyId === lab.id ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                              Restore
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleViewLab(lab)}
                            className="h-9 px-3 rounded-lg bg-primary/10 text-primary text-xs font-bold hover:bg-primary/15 inline-flex items-center gap-1.5"
                          >
                            <Eye className="size-3.5" />
                            View lab
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })
            )}
          </div>
        </section>

        {/* Section 3 — Invite links */}
        <section className="rounded-2xl border border-border bg-card p-8 shadow-sm space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10">
              <Link2 className="size-5 text-primary" aria-hidden />
            </div>
            <div>
              <h2 className="text-lg font-bold">Invite links</h2>
              <p className="text-xs text-muted-foreground">All generated lab registration tokens.</p>
            </div>
          </div>

          <InlineAlert msg={invitesTableMsg} />

          <div className="rounded-2xl border border-border overflow-hidden">
            <div className="hidden lg:grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.75fr)_minmax(0,0.75fr)_minmax(0,0.9fr)_minmax(0,1fr)] gap-2 px-4 py-3 bg-muted/30 border-b border-border text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <span>Lab name</span>
              <span>Token</span>
              <span>Role</span>
              <span>Status</span>
              <span>Created</span>
              <span>Generated by</span>
            </div>

            {invitesLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="size-6 text-muted-foreground animate-spin" />
              </div>
            ) : invites.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground italic">No invite links yet.</div>
            ) : (
              invites.map((inv) => (
                <div
                  key={inv.id}
                  className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.75fr)_minmax(0,0.75fr)_minmax(0,0.9fr)_minmax(0,1fr)] gap-2 px-4 py-4 border-t border-border/60 text-sm items-center"
                >
                  <span className="font-bold truncate">{inv.lab_name}</span>
                  <code className="text-xs font-mono text-muted-foreground">{shortenToken(inv.token)}</code>
                  <span>
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        inv.role === "org_admin"
                          ? "bg-violet-500/15 text-violet-800 dark:text-violet-300"
                          : "bg-sky-500/15 text-sky-800 dark:text-sky-300"
                      }`}
                    >
                      {inviteRoleLabel(inv.role)}
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
                  <span className="text-xs text-muted-foreground font-mono">{formatDate(inv.created_at)}</span>
                  <span className="text-xs text-muted-foreground font-medium truncate">{inviteCreatorLabel(inv.created_by)}</span>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Section 4 — Security Log (global; RLS returns all rows for super_admin) */}
        <section className="rounded-2xl border border-border bg-card p-8 shadow-sm space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10">
              <ShieldAlert className="size-5 text-primary" aria-hidden />
            </div>
            <div>
              <h2 className="text-lg font-bold">Security Log</h2>
              <p className="text-xs text-muted-foreground">
                Global access-control trail — all labs and null-lab (system) events.
              </p>
            </div>
          </div>
          <SecurityLogPanel
            timezone="UTC"
            showLab
            labNamesById={Object.fromEntries(labs.map((l) => [l.id, l.name]))}
            currentUserName={
              authUser?.user_metadata?.full_name ||
              authUser?.email?.split("@")[0] ||
              "Super Admin"
            }
            currentUserRole="super_admin"
          />
        </section>
      </main>
    </div>
  )
}
