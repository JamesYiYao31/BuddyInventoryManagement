"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation" 
import { Search, CalendarClock, CalendarDays, CheckCircle2, User, Scan, Minus, PackagePlus, FlaskConical, AlertTriangle, Activity, Skull, DollarSign, ShieldCheck } from "lucide-react"
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts"
import { supabase } from "@/lib/supabase"

// Utilities & Types
import { 
  InventoryGroup, LabSettings, SidebarPage, daysUntilExpiry, 
  getEarliestExpiry, LotInUseEntry, ReorderRequest, ActivityLogEntry,
  fetchInventoryFromSupabase, fetchLogsFromSupabase, fetchActiveLotsFromSupabase,
  calculateDashboardStats, DashboardStats, fetchLabSettings, getLotTotalCount,
  getLabCurrentDateStr, ACTION_STYLES, resolveCurrentUserLabId, fetchLabName,
} from "@/lib/inventory-utils"

// UI Components
import { DashboardSidebar } from "@/components/dashboard/sidebar"
import { DashboardHeader } from "@/components/dashboard/header"
import { AlertCards } from "@/components/dashboard/alert-cards"
import InventoryTab from "@/components/dashboard/inventory-table"
import LotInUseTab from "@/components/dashboard/lot-in-use-table"
import RequestsTab from "@/components/dashboard/requests-table"
import ActivityLogTab from "@/components/dashboard/activity-log-table"
import AnalyticsTab from "@/components/dashboard/analytics-tab"
import LabSharingTab from "@/components/dashboard/lab-sharing-tab"
import LabSettingsTab from "@/components/dashboard/lab-settings-tab"
import ValidationTab from "@/components/dashboard/validation-tab"
import type { TechDashboardWidget } from "@/lib/inventory-utils"

// Builds a natural-language sentence for the "My Recent Activities" timeline.
const ACTION_VERBS: Record<string, string> = {
  "Added": "added",
  "Received": "received",
  "Opened": "opened",
  "Used": "used",
  "Ordered": "requested a reorder for",
  "Edited": "edited",
  "Disposed": "disposed",
  "Deleted from Bench": "removed from the bench",
  "Deleted from Storage": "deleted from storage",
}

function buildActivitySentence(
  action: string,
  itemName: string,
  details?: string,
  actor: string = "You",
): string {
  const verb = ACTION_VERBS[action] ?? action.toLowerCase()
  const base = `${actor} ${verb} ${itemName}`
  if (details && details.trim()) return `${base} — ${details}`
  return base
}

// ── Reusable widget panel for the dashboard ──

interface WidgetPanelProps {
  widget: TechDashboardWidget
  healthData: { name: string; value: number; color: string }[]
  totalLots: number
  wasteData: { items: any[]; totalLoss: number }
  expenseData: { items: any[]; total: number }
}

function DashboardWidgetPanel({ widget, healthData, totalLots, wasteData, expenseData }: WidgetPanelProps) {
  if (widget === "donut") {
    return (
      <div className="rounded-[2.5rem] border border-border bg-card p-8 space-y-6 shadow-sm">
        <div>
          <h2 className="text-lg font-black text-foreground">Inventory Health</h2>
          <p className="text-xs text-muted-foreground mt-1">Distribution across {totalLots} tracked lots</p>
        </div>
        {totalLots > 0 ? (
          <div className="flex items-center gap-8">
            <div className="w-48 h-48 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={healthData.filter(d => d.value > 0)}
                    cx="50%" cy="50%"
                    innerRadius={50} outerRadius={80}
                    paddingAngle={3} dataKey="value" stroke="none"
                  >
                    {healthData.filter(d => d.value > 0).map(entry => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const d = payload[0].payload
                      const pct = totalLots > 0 ? ((d.value / totalLots) * 100).toFixed(1) : "0"
                      return (
                        <div className="bg-background border border-border rounded-lg px-3 py-2 text-xs shadow-lg">
                          <p className="font-bold">{d.name}</p>
                          <p className="text-muted-foreground">{d.value} lots ({pct}%)</p>
                        </div>
                      )
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-3 flex-1">
              {healthData.map(d => {
                const pct = totalLots > 0 ? ((d.value / totalLots) * 100).toFixed(1) : "0"
                return (
                  <div key={d.name} className="flex items-center gap-3">
                    <div className="size-3 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                    <span className="text-sm font-bold text-foreground flex-1">{d.name}</span>
                    <span className="text-sm font-black text-foreground">{d.value}</span>
                    <span className="text-xs text-muted-foreground w-14 text-right">{pct}%</span>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic py-8 text-center">No inventory lots to analyze.</p>
        )}
      </div>
    )
  }

  if (widget === "waste") {
    return (
      <div className="rounded-[2.5rem] border border-border bg-card p-8 space-y-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-foreground">Waste Exposure</h2>
            <p className="text-xs text-muted-foreground mt-1">Expired lots still holding stock</p>
          </div>
          <Skull className="size-6 text-red-500" />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-black text-red-500">${wasteData.totalLoss.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span className="text-sm font-bold text-muted-foreground">estimated loss</span>
        </div>
        {wasteData.items.length > 0 ? (
          <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
            {wasteData.items.map((item: any) => (
              <div key={item.lotId} className="flex items-center justify-between px-4 py-3 rounded-xl bg-red-500/5 border border-red-500/10">
                <div>
                  <p className="text-sm font-bold text-foreground">{item.itemName}</p>
                  <p className="text-xs text-muted-foreground">Lot {item.lot} &middot; {item.totalUnits ?? 0} units remaining</p>
                </div>
                <span className="text-sm font-black text-red-500">
                  ${item.estimatedLoss.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic py-4 text-center">No expired lots with remaining stock.</p>
        )}
      </div>
    )
  }

  if (widget === "expenses") {
    return (
      <div className="rounded-[2.5rem] border border-border bg-card p-8 space-y-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-foreground">Recent Expenses</h2>
            <p className="text-xs text-muted-foreground mt-1">Request spend this month</p>
          </div>
          <DollarSign className="size-6 text-green-500" />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-black text-foreground">${expenseData.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span className="text-sm font-bold text-muted-foreground">this month</span>
        </div>
        {expenseData.items.length > 0 ? (
          <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
            {expenseData.items.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-muted/50">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground truncate">{r.itemName}</p>
                  <p className="text-xs text-muted-foreground">{r.vendor} &middot; Qty {r.orderQty} &middot; {r.status}</p>
                </div>
                <span className="text-sm font-black text-foreground shrink-0 ml-3">${r.totalPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic py-4 text-center">No requests this month.</p>
        )}
      </div>
    )
  }

  return null
}

/** Map DB profile.role to dashboard UI role and super-admin nav visibility. */
function dashboardRoleFromProfile(role: string | null | undefined): {
  uiRole: "manager" | "technician"
  isSuperAdmin: boolean
} {
  if (role === "super_admin") return { uiRole: "technician", isSuperAdmin: true }
  if (role === "manager") return { uiRole: "manager", isSuperAdmin: false }
  if (role === "technician") return { uiRole: "technician", isSuperAdmin: false }
  return { uiRole: "technician", isSuperAdmin: false }
}

export default function DashboardPage() {
  const router = useRouter()
  
  // ── 1. STATE ──
  const [activePage, setActivePage] = useState<SidebarPage>("dashboard")
  const [user, setUser] = useState<any>(null)
  const [userRole, setUserRole] = useState<"manager" | "technician">("technician")
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  
  const [inventory, setInventory] = useState<InventoryGroup[]>([])
  const [requests, setRequests] = useState<ReorderRequest[]>([])
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([])
  const [lotsInUse, setLotsInUse] = useState<LotInUseEntry[]>([]) 
  const [stats, setStats] = useState<DashboardStats | null>(null)
  
  const [labSettings, setLabSettings] = useState<LabSettings>({
    lowStockThreshold: 5,
    expiringSoonDays: 30,
    urgentDays: 7,
    labTimezone: "America/Chicago",
    techDashboardWidget: "donut",
    techsCanEditThresholds: true,
  })
  const [labName, setLabName] = useState("My Lab")
  const [pendingValidationCount, setPendingValidationCount] = useState(0)
  const [profileFullName, setProfileFullName] = useState("")
  const [loading, setLoading] = useState(true)

  // Filter State
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set()) 
  const [expiryFilter, setExpiryFilter] = useState("all") 
  const [actionFilter, setActionFilter] = useState("all")
  const [logUserFilter, setLogUserFilter] = useState("all")
  const [logDateStart, setLogDateStart] = useState("")
  const [logDateEnd, setLogDateEnd] = useState("")

  // Resolve the authenticated user's display name — matches the header's logic
  // so that activity-log entries can be filtered by the current user.
  const currentUserName = user?.user_metadata?.full_name || profileFullName || user?.email?.split("@")[0] || ""

  // ── Refresh the authenticated user (called after profile edits so the
  // header and activity-log filters pick up the new display name). ──
  const refreshAuthUser = useCallback(async () => {
    const { data } = await supabase.auth.getUser()
    if (data?.user) setUser(data.user)

    if (data?.user?.id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, full_name")
        .eq("id", data.user.id)
        .single()
      if (profile?.role) {
        const { uiRole, isSuperAdmin: sa } = dashboardRoleFromProfile(profile.role)
        setUserRole(uiRole)
        setIsSuperAdmin(sa)
      } else {
        setUserRole("technician")
        setIsSuperAdmin(false)
      }
      if (profile?.full_name) {
        setProfileFullName(profile.full_name)
      }
    }
  }, [])

  // ── 2. DATABASE FETCH FUNCTIONS ──

  const refreshData = useCallback(async () => {
    try {
      const [invData, logData, activeData, settings, resolvedLabName] = await Promise.all([
        fetchInventoryFromSupabase(),
        fetchLogsFromSupabase(),
        fetchActiveLotsFromSupabase(),
        fetchLabSettings(),
        fetchLabName(),
      ])
      setLabSettings(settings)
      setLabName(resolvedLabName)

      // Fetch Requests and map snake_case to camelCase
      const labId = await resolveCurrentUserLabId()
      const { data: reqData, error: reqError } = await supabase
        .from('requests')
        .select('*')
        .eq('lab_id', labId ?? '')
        .order('date_requested', { ascending: false })

      // Count pending validation lots
      if (labId) {
        const { count: valCount } = await supabase
          .from("inventory_lots")
          .select("id", { count: "exact", head: true })
          .eq("lab_id", labId)
          .in("validation_status", ["pending_coa", "pending_validation", "pending_approval"])
        setPendingValidationCount(valCount ?? 0)
      }
      
      if (reqError) throw reqError

      const mappedRequests: ReorderRequest[] = reqData?.map((r: any) => ({
        id: r.id,
        catalogNumber: r.catalog_number || "",
        itemName: r.item_name || "Unknown Item",
        vendor: r.vendor || "",
        orderQty: r.order_qty || 0,
        unitPrice: r.unit_price || 0,
        totalPrice: r.total_price || 0,
        status: r.status || "Pending",
        notes: r.notes || "",
        dateRequested: r.date_requested || ""
      })) || []

      setInventory(invData)
      setActivityLogs(logData)
      setLotsInUse(activeData)
      setRequests(mappedRequests)

      const calculated = calculateDashboardStats(invData, activeData, mappedRequests, settings)
      setStats(calculated)
    } catch (err) {
      console.error("Dashboard Refresh Error:", err)
    }
  }, [])

  useEffect(() => {
    const checkSessionAndRole = async () => {
      setLoading(true)
      const { data: { session } } = await supabase.auth.getSession()
      
      if (!session) {
        router.push("/login") 
      } else {
        setUser(session.user)
        
        const { data: profile } = await supabase
          .from('profiles')
          .select('role, full_name, lab_id')
          .eq('id', session.user.id)
          .single()

        if (profile?.full_name) {
          setProfileFullName(profile.full_name)
        }

        // Super admins have no lab_id and should bypass archived-lab enforcement.
        if (profile?.lab_id) {
          const { data: lab } = await supabase
            .from("labs")
            .select("is_archived")
            .eq("id", profile.lab_id)
            .single()

          if (lab?.is_archived) {
            await supabase.auth.signOut()
            router.push(`/login?error=${encodeURIComponent("Your lab has been archived. Please contact support.")}`)
            setLoading(false)
            return
          }
        }

        const { uiRole, isSuperAdmin: sa } = dashboardRoleFromProfile(profile?.role)
        setUserRole(uiRole)
        setIsSuperAdmin(sa)

        await refreshData()
        setLoading(false)
      }
    }
    checkSessionAndRole()
  }, [router, refreshData])

  useEffect(() => {
    const interval = setInterval(async () => {
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        router.push("/login")
        return
      }

      // Check if user profile still exists and lab isn't archived
      const { data: profile } = await supabase
        .from("profiles")
        .select("lab_id, role")
        .eq("id", session.user.id)
        .single()

      if (!profile) {
        await supabase.auth.signOut()
        router.push("/login")
        return
      }

      if (profile.lab_id) {
        const { data: lab } = await supabase
          .from("labs")
          .select("is_archived")
          .eq("id", profile.lab_id)
          .single()

        if (lab?.is_archived) {
          await supabase.auth.signOut()
          router.push(
            `/login?error=${encodeURIComponent(
              "Your lab has been archived. Please contact support."
            )}`
          )
          return
        }
      }
    }, 30000) // Check every 30 seconds

    return () => clearInterval(interval)
  }, [router])

  // ── 3. FILTER LOGIC ──

  const tz = labSettings.labTimezone

  const sortedFlatInventory = inventory.flatMap(g => g.lots.map(l => ({ ...l, itemName: g.name || "Unknown", itemId: g.itemId })))
    .filter(lot => {
      const matchSearch = (lot.itemName || "").toLowerCase().includes(searchQuery.toLowerCase()) || (lot.lot || "").toLowerCase().includes(searchQuery.toLowerCase())
      const matchItem = selectedItems.size === 0 || selectedItems.has(lot.itemName)
      const days = daysUntilExpiry(lot.expiry, tz)
      const matchExpiry = expiryFilter === "all" || (days <= Number(expiryFilter) && days >= 0)
      return matchSearch && matchItem && matchExpiry
    })
    .sort((a, b) => (a.itemName || "").localeCompare(b.itemName || ""))

  const filteredLotsInUse = lotsInUse.filter(lot => {
    const matchSearch = (lot.itemName || "").toLowerCase().includes(searchQuery.toLowerCase()) || (lot.lotNumber || "").toLowerCase().includes(searchQuery.toLowerCase())
    const matchItem = selectedItems.size === 0 || selectedItems.has(lot.itemName)
    const effectiveExpiry = getEarliestExpiry(lot.workingExpiryDate, lot.actualExpiryDate)
    const days = daysUntilExpiry(effectiveExpiry, tz)
    const matchExpiry = expiryFilter === "all" || (days <= Number(expiryFilter) && days >= 0)
    return matchSearch && matchItem && matchExpiry
  })

  const filteredRequests = requests.filter(req => {
    const matchSearch = (req.itemName || "").toLowerCase().includes(searchQuery.toLowerCase()) || (req.catalogNumber || "").toLowerCase().includes(searchQuery.toLowerCase())
    const matchItem = selectedItems.size === 0 || selectedItems.has(req.itemName)
    return matchSearch && matchItem
  })

  const filteredLogs = activityLogs.filter(log => {
    const query = searchQuery.toLowerCase()
    const matchSearch = (log.itemName || "").toLowerCase().includes(query) || (log.lotNumber || "").toLowerCase().includes(query) || (log.user || "").toLowerCase().includes(query)
    const matchItem = selectedItems.size === 0 || selectedItems.has(log.itemName)
    const matchAction = actionFilter === "all" || log.actionType === actionFilter
    const matchUser = logUserFilter === "all" || log.user === logUserFilter

    let matchDate = true
    if (logDateStart || logDateEnd) {
      const logDate = new Date(log.date)
      logDate.setHours(0, 0, 0, 0)
      if (logDateStart) {
        const start = new Date(logDateStart + "T00:00:00")
        if (logDate < start) matchDate = false
      }
      if (logDateEnd) {
        const end = new Date(logDateEnd + "T00:00:00")
        if (logDate > end) matchDate = false
      }
    }

    return matchSearch && matchItem && matchAction && matchUser && matchDate
  })

  const allLogUsers = Array.from(new Set(activityLogs.map(l => l.user).filter(Boolean))).sort()

  const allItemNames = Array.from(new Set([
    ...inventory.map(g => g.name).filter(Boolean), 
    ...requests.map(r => r.itemName).filter(Boolean), 
    ...lotsInUse.map(l => l.itemName).filter(Boolean)
  ])).sort()

  // ── 4. WIDGET DATA ──
  const allFlatLots = useMemo(() => inventory.flatMap(g => g.lots.map(l => ({ ...l, itemName: g.name }))), [inventory])

  const healthData = useMemo(() => {
    let healthy = 0, lowStock = 0, expiringSoon = 0, expired = 0
    for (const lot of allFlatLots) {
      const days = daysUntilExpiry(lot.expiry, tz)
      const units = getLotTotalCount(lot)
      if (days < 0) { expired++; continue }
      if (days <= labSettings.expiringSoonDays) { expiringSoon++; continue }
      if (units <= labSettings.lowStockThreshold) { lowStock++; continue }
      healthy++
    }
    return [
      { name: "Healthy", value: healthy, color: "#22c55e" },
      { name: "Low Stock", value: lowStock, color: "#eab308" },
      { name: "Expiring Soon", value: expiringSoon, color: "#f97316" },
      { name: "Expired", value: expired, color: "#ef4444" },
    ]
  }, [allFlatLots, tz, labSettings.expiringSoonDays, labSettings.lowStockThreshold])

  const wasteData = useMemo(() => {
    const priceMap: Record<string, number> = {}
    const sorted = [...requests].sort((a, b) => new Date(b.dateRequested).getTime() - new Date(a.dateRequested).getTime())
    for (const r of sorted) {
      const key = r.itemName.toLowerCase()
      if (!priceMap[key] && r.unitPrice > 0) priceMap[key] = r.unitPrice
    }
    const expired = allFlatLots.filter(l => daysUntilExpiry(l.expiry, tz) < 0 && getLotTotalCount(l) > 0)
    const items = expired.map(l => {
      const price = priceMap[l.itemName.toLowerCase()] || 0
      return { ...l, estimatedLoss: getLotTotalCount(l) * price }
    })
    return { items, totalLoss: items.reduce((sum, i) => sum + i.estimatedLoss, 0) }
  }, [allFlatLots, requests, tz])

  const expenseData = useMemo(() => {
    const labNow = new Date(getLabCurrentDateStr(tz) + "T00:00:00")
    const monthRequests = requests.filter(r => {
      if (!r.dateRequested) return false
      const d = new Date(r.dateRequested)
      return d.getFullYear() === labNow.getFullYear() && d.getMonth() === labNow.getMonth()
    })
    return { items: monthRequests, total: monthRequests.reduce((s, r) => s + r.totalPrice, 0) }
  }, [requests, tz])

  // ── 5. RENDER ──
  return (
    <div className="flex h-screen bg-background overflow-hidden print:h-auto print:block print:bg-white">
      <div className="print:hidden">
        <DashboardSidebar
          activePage={activePage}
          setActivePage={setActivePage}
          isMobileOpen={mobileMenuOpen}
          onMobileClose={() => setMobileMenuOpen(false)}
          showSuperAdminLink={isSuperAdmin}
          userRole={userRole}
        />
      </div>

      <div className="flex flex-1 flex-col lg:pl-64 print:pl-0 print:block">
        <div className="print:hidden">
          <DashboardHeader user={user} role={userRole} stats={stats} inventory={inventory} activeLots={lotsInUse} labSettings={labSettings} labName={labName} onNavigate={setActivePage} onProfileUpdated={refreshAuthUser} onMobileMenuOpen={() => setMobileMenuOpen(true)} />
        </div>

        <main className="flex-1 overflow-y-auto p-8 print:overflow-visible print:p-0">
          <div className="max-w-[1600px] mx-auto space-y-8">
            
            {loading ? (
              <div className="flex flex-col items-center justify-center p-20 text-center space-y-4 h-full">
                <div className="size-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                <p className="text-muted-foreground font-bold tracking-widest uppercase animate-pulse">Initializing Secure Lab Link...</p>
              </div>
            ) : (
              <>
                {activePage === "dashboard" && (
                  <div className="space-y-8 animate-in fade-in duration-500 print:hidden">
                    <div className="flex items-center justify-between">
                      <h1 className="text-3xl font-black text-foreground">Lab Overview</h1>
                    </div>
                    
                    <AlertCards stats={stats} />

                    {pendingValidationCount > 0 && (
                      <button
                        onClick={() => setActivePage("validation")}
                        className="flex items-center gap-3 w-full rounded-2xl border border-yellow-500/20 bg-yellow-500/5 px-6 py-4 hover:bg-yellow-500/10 transition-all text-left"
                      >
                        <ShieldCheck className="size-5 text-yellow-600 shrink-0" />
                        <p className="text-sm font-bold text-yellow-700 flex-1">
                          {pendingValidationCount} lot{pendingValidationCount !== 1 ? "s" : ""} pending validation
                        </p>
                        <span className="text-xs font-bold text-yellow-700 opacity-70">View Queue →</span>
                      </button>
                    )}

                    {/* ── Unified Dashboard Layout (Managers & Technicians) ── */}
                    {(() => {
                      // Lab Bench — shared workspace, same filter for both roles
                      const flaggedBench = lotsInUse.filter(lot => {
                        const eff = getEarliestExpiry(lot.workingExpiryDate, lot.actualExpiryDate)
                        const days = daysUntilExpiry(eff, tz)
                        const qty = parseFloat(lot.quantityLeft) || 0
                        return days <= 7 || qty <= 1
                      })

                      // Activity feed — lab-wide for managers, personal for technicians
                      const activityList = userRole === "manager"
                        ? activityLogs.slice(0, 5)
                        : (currentUserName
                            ? activityLogs.filter(log => (log.user || "").toLowerCase() === currentUserName.toLowerCase()).slice(0, 5)
                            : [])

                      const activityTitle = userRole === "manager" ? "Lab-Wide Recent Activity" : "My Recent Activities"
                      const activitySubtitle = userRole === "manager"
                        ? "Latest actions from every user across the lab"
                        : "Your last 5 actions in the lab"
                      const activityEmpty = userRole === "manager"
                        ? "No activity has been logged in the lab yet."
                        : "No recent activity logged by you yet."

                      // Bottom analytics widget — both roles render whichever widget the
                      // Manager has selected in Lab Settings (saved on `labSettings.techDashboardWidget`).
                      // Edits made in the Settings tab flow back here via `refreshData()` → `setLabSettings`,
                      // so the Manager sees their change instantly without a page refresh.
                      const bottomWidget: TechDashboardWidget = labSettings.techDashboardWidget

                      return (
                        <div className="space-y-8">
                          {/* Section A: Lab Bench — Attention Needed */}
                          <div className="rounded-[2.5rem] border border-border bg-card p-8 space-y-6 shadow-sm">
                            <div className="flex items-center justify-between">
                              <div>
                                <h2 className="text-lg font-black text-foreground">Lab Bench &mdash; Attention Needed</h2>
                                <p className="text-xs text-muted-foreground mt-1">Shared lab lots expiring within 7 days or low on remaining volume</p>
                              </div>
                              <FlaskConical className="size-6 text-primary" />
                            </div>
                            {flaggedBench.length > 0 ? (
                              <div className="divide-y divide-border/50 rounded-2xl border border-border/60 overflow-hidden">
                                {flaggedBench.map(lot => {
                                  const eff = getEarliestExpiry(lot.workingExpiryDate, lot.actualExpiryDate)
                                  const days = daysUntilExpiry(eff, tz)
                                  const qty = parseFloat(lot.quantityLeft) || 0
                                  const expiryWarning = days < 0
                                    ? "Expired"
                                    : days === 0
                                      ? "Expires today"
                                      : `Expires in ${days} day${days === 1 ? "" : "s"}`
                                  return (
                                    <div key={lot.id} className="flex items-center gap-4 px-5 py-4 hover:bg-muted/30 transition-colors">
                                      <div className="flex-1 min-w-0">
                                        <p className="font-bold text-foreground truncate">{lot.itemName}</p>
                                        <p className="text-xs font-mono text-muted-foreground">Lot: {lot.lotNumber}</p>
                                      </div>
                                      <div className="flex flex-wrap items-center gap-2 justify-end">
                                        {days <= 7 && (
                                          <span className="flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-bold bg-red-500/10 text-red-600">
                                            <AlertTriangle className="size-3" />
                                            {expiryWarning}
                                          </span>
                                        )}
                                        {qty <= 1 && (
                                          <span className="px-3 py-1 rounded-full text-[10px] font-bold bg-orange-500/10 text-orange-600">
                                            {qty <= 0 ? "Empty" : `${lot.quantityLeft || "Low"} left`}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground italic py-4 text-center">All bench reagents are in good standing.</p>
                            )}
                          </div>

                          {/* Section B: Quick Actions (both roles) */}
                          <div className="grid grid-cols-3 gap-6">
                            <button onClick={() => setActivePage("inventory")} className="group flex flex-col items-center gap-4 p-8 rounded-[2.5rem] border border-border bg-card hover:border-primary/40 hover:bg-primary/5 transition-all shadow-sm">
                              <div className="p-4 rounded-2xl bg-primary/10 group-hover:scale-110 transition-transform"><Scan className="size-8 text-primary" /></div>
                              <span className="text-sm font-black uppercase tracking-widest text-foreground">Scan Reagent</span>
                            </button>
                            <button onClick={() => setActivePage("lotinuse")} className="group flex flex-col items-center gap-4 p-8 rounded-[2.5rem] border border-border bg-card hover:border-primary/40 hover:bg-primary/5 transition-all shadow-sm">
                              <div className="p-4 rounded-2xl bg-indigo-500/10 group-hover:scale-110 transition-transform"><Minus className="size-8 text-indigo-500" /></div>
                              <span className="text-sm font-black uppercase tracking-widest text-foreground">Log Usage</span>
                            </button>
                            <button onClick={() => setActivePage("requests")} className="group flex flex-col items-center gap-4 p-8 rounded-[2.5rem] border border-border bg-card hover:border-primary/40 hover:bg-primary/5 transition-all shadow-sm">
                              <div className="p-4 rounded-2xl bg-purple-500/10 group-hover:scale-110 transition-transform"><PackagePlus className="size-8 text-purple-500" /></div>
                              <span className="text-sm font-black uppercase tracking-widest text-foreground">Request Restock</span>
                            </button>
                          </div>

                          {/* Section C: Activity timeline (role-specific filter) */}
                          <div className="rounded-[2.5rem] border border-border bg-card p-8 space-y-6 shadow-sm">
                            <div className="flex items-center justify-between">
                              <div>
                                <h2 className="text-lg font-black text-foreground">{activityTitle}</h2>
                                <p className="text-xs text-muted-foreground mt-1">{activitySubtitle}</p>
                              </div>
                              <Activity className="size-6 text-primary" />
                            </div>
                            {activityList.length > 0 ? (
                              <ol className="relative border-l-2 border-border/60 ml-3 space-y-5 pl-6">
                                {activityList.map(log => {
                                  const styleClass = ACTION_STYLES[log.actionType] ?? "bg-muted text-muted-foreground"
                                  const isSelf = !!currentUserName && (log.user || "").toLowerCase() === currentUserName.toLowerCase()
                                  const actorLabel = userRole === "manager" && !isSelf ? (log.user || "Someone") : "You"
                                  const sentence = buildActivitySentence(log.actionType, log.itemName, log.details, actorLabel)
                                  return (
                                    <li key={log.id} className="relative">
                                      <span className={`absolute -left-[34px] top-0.5 flex size-5 items-center justify-center rounded-full ring-4 ring-card ${styleClass}`}>
                                        <span className="size-2 rounded-full bg-current" />
                                      </span>
                                      <div className="flex items-baseline justify-between gap-3">
                                        <p className="text-sm text-foreground font-medium">{sentence}</p>
                                        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground shrink-0">{log.date} &middot; {log.time}</span>
                                      </div>
                                      {log.lotNumber && (
                                        <p className="text-xs font-mono text-muted-foreground mt-0.5">Lot {log.lotNumber}</p>
                                      )}
                                    </li>
                                  )
                                })}
                              </ol>
                            ) : (
                              <p className="text-sm text-muted-foreground italic py-4 text-center">{activityEmpty}</p>
                            )}
                          </div>

                          {/* Section D: Bottom analytics widget (full width) */}
                          {bottomWidget !== "none" && (
                            <DashboardWidgetPanel
                              widget={bottomWidget}
                              healthData={healthData}
                              totalLots={allFlatLots.length}
                              wasteData={wasteData}
                              expenseData={expenseData}
                            />
                          )}
                        </div>
                      )
                    })()}
                  </div>
                )}

                {activePage === "analytics" && <AnalyticsTab inventory={inventory} requests={requests} activityLogs={activityLogs} labSettings={labSettings} userRole={userRole} />}
                {activePage === "labsharing" && <LabSharingTab labName={labName} />}
                {activePage === "settings" && <LabSettingsTab labSettings={labSettings} refreshData={refreshData} userRole={userRole} />}
                {activePage === "validation" && userRole === "manager" && <ValidationTab userRole={userRole} refreshData={refreshData} />}

                {["inventory", "lotinuse", "requests", "activitylog"].includes(activePage) && (
                  <div className="flex gap-8 items-start print:block">
                    <div className="w-full min-w-0 lg:flex-1 print:w-full">
                      {activePage === "inventory" && <InventoryTab inventory={inventory} sortedFlatInventory={sortedFlatInventory} labSettings={labSettings} refreshData={refreshData} userRole={userRole} requests={requests} />}
                      {activePage === "lotinuse" && <LotInUseTab activeLots={filteredLotsInUse} inventory={inventory} refreshData={refreshData} userRole={userRole} labSettings={labSettings} currentUserName={currentUserName} labName={labName} />}
                      {activePage === "requests" && <RequestsTab requests={filteredRequests} refreshRequests={refreshData} userRole={userRole} />}
                      {activePage === "activitylog" && <ActivityLogTab logs={filteredLogs} currentUserName={currentUserName} currentUserRole={userRole} labSettings={labSettings} filterUser={logUserFilter} filterAction={actionFilter} filterDateStart={logDateStart} filterDateEnd={logDateEnd} labName={labName} />}
                    </div>
                    
                    <aside className="hidden w-72 shrink-0 space-y-8 print:hidden lg:block">
                      <div className="rounded-2xl border border-border bg-card p-6 space-y-8 sticky top-0 shadow-sm">
                        <div className="space-y-3">
                          <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">Global Search</p>
                          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Type lot or item..." className="w-full h-11 px-4 text-sm bg-background border border-input rounded-xl focus:ring-2 focus:ring-primary/20 outline-none transition-all" />
                        </div>

                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                             <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">Filter Items</p>
                             {selectedItems.size > 0 && <button onClick={() => setSelectedItems(new Set())} className="text-[10px] text-primary font-bold hover:underline">RESET</button>}
                          </div>
                          <div className="space-y-1.5 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                            {allItemNames.map(name => (
                              <button key={name} onClick={() => {
                                const next = new Set(selectedItems)
                                if (next.has(name)) next.delete(name); else next.add(name);
                                setSelectedItems(next)
                              }} className={`flex items-center gap-3 w-full px-3 py-2 text-sm rounded-xl transition-all ${selectedItems.has(name) ? "bg-primary/10 text-primary font-bold" : "hover:bg-muted text-muted-foreground"}`}>
                                <div className={`size-4 rounded-md border flex items-center justify-center ${selectedItems.has(name) ? "bg-primary border-primary text-primary-foreground" : "border-border"}`}>{selectedItems.has(name) && <CheckCircle2 className="size-3" />}</div>
                                <span className="truncate">{name}</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        {(activePage === "inventory" || activePage === "lotinuse") && (
                          <div className="space-y-3 pt-6 border-t border-border">
                            <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest flex items-center gap-2"><CalendarClock className="size-4" /> Expiry Timeline</p>
                            <div className="space-y-1.5">
                              {[{ id: "all", label: "All Items" }, { id: "7", label: "Expiring < 7 Days" }, { id: "30", label: "Expiring < 30 Days" }].map((filter) => (
                                <button key={filter.id} onClick={() => setExpiryFilter(filter.id)} className={`w-full text-left px-4 py-2 text-sm rounded-xl transition-all ${expiryFilter === filter.id ? "bg-primary/10 text-primary font-bold" : "text-muted-foreground hover:bg-muted"}`}>{filter.label}</button>
                              ))}
                            </div>
                          </div>
                        )}

                        {activePage === "activitylog" && (
                          <>
                            <div className="space-y-3 pt-6 border-t border-border">
                              <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest flex items-center gap-2"><User className="size-4" /> Filter by User</p>
                              <select
                                value={logUserFilter}
                                onChange={e => setLogUserFilter(e.target.value)}
                                className="w-full h-10 border border-input bg-background rounded-xl px-3 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                              >
                                <option value="all">All Users</option>
                                {allLogUsers.map(name => (
                                  <option key={name} value={name}>{name}</option>
                                ))}
                              </select>
                            </div>

                            <div className="space-y-3 pt-6 border-t border-border">
                              <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest flex items-center gap-2"><CalendarDays className="size-4" /> Date Range</p>
                              <div className="space-y-2">
                                <div className="space-y-1">
                                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-1">Start Date</label>
                                  <input
                                    type="date"
                                    value={logDateStart}
                                    onChange={e => setLogDateStart(e.target.value)}
                                    className="w-full h-10 border border-input bg-background rounded-xl px-3 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-1">End Date</label>
                                  <input
                                    type="date"
                                    value={logDateEnd}
                                    onChange={e => setLogDateEnd(e.target.value)}
                                    className="w-full h-10 border border-input bg-background rounded-xl px-3 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                                  />
                                </div>
                              </div>
                              {(logUserFilter !== "all" || logDateStart || logDateEnd) && (
                                <button
                                  onClick={() => { setLogUserFilter("all"); setLogDateStart(""); setLogDateEnd("") }}
                                  className="w-full text-center px-4 py-2 text-xs font-bold text-primary rounded-xl hover:bg-primary/10 transition-all"
                                >
                                  Reset Log Filters
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </aside>
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}