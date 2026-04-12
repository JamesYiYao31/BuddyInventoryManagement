"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation" 
import { Search, CalendarClock, CheckCircle2, Activity, ShieldCheck, User } from "lucide-react"
import { supabase } from "@/lib/supabase"

// Utilities & Types
import { 
  InventoryGroup, LabSettings, SidebarPage, daysUntilExpiry, 
  getEarliestExpiry, LotInUseEntry, ReorderRequest, ActivityLogEntry,
  fetchInventoryFromSupabase, fetchLogsFromSupabase, fetchActiveLotsFromSupabase,
  calculateDashboardStats, DashboardStats 
} from "@/lib/inventory-utils"

// UI Components
import { DashboardSidebar } from "@/components/dashboard/sidebar"
import { DashboardHeader } from "@/components/dashboard/header"
import { AlertCards } from "@/components/dashboard/alert-cards"
import { ActivityFeed } from "@/components/dashboard/activity-feed"
import InventoryTab from "@/components/dashboard/inventory-table"
import LotInUseTab from "@/components/dashboard/lot-in-use-table"
import RequestsTab from "@/components/dashboard/requests-table"
import ActivityLogTab from "@/components/dashboard/activity-log-table"
import AnalyticsTab from "@/components/dashboard/analytics-tab"
import LabSharingTab from "@/components/dashboard/lab-sharing-tab"
import MyTasksTab from "@/components/dashboard/my-tasks-tab"

export default function DashboardPage() {
  const router = useRouter()
  
  // ── 1. STATE ──
  const [activePage, setActivePage] = useState<SidebarPage>("dashboard")
  const [user, setUser] = useState<any>(null)
  const [userRole, setUserRole] = useState<"manager" | "technician">("technician")
  
  const [inventory, setInventory] = useState<InventoryGroup[]>([])
  const [requests, setRequests] = useState<ReorderRequest[]>([])
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([])
  const [lotsInUse, setLotsInUse] = useState<LotInUseEntry[]>([]) 
  const [stats, setStats] = useState<DashboardStats | null>(null)
  
  const [labSettings] = useState<LabSettings>({ lowStockCount: 5, expiryWarnDays: 30, expiryUrgentDays: 7 })
  const [loading, setLoading] = useState(true)

  // Filter State
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set()) 
  const [expiryFilter, setExpiryFilter] = useState("all") 
  const [actionFilter, setActionFilter] = useState("all")

  // ── 2. DATABASE FETCH FUNCTIONS ──

  const refreshData = async () => {
    try {
      // Fetch core inventory, logs, and active lots in parallel
      const [invData, logData, activeData] = await Promise.all([
        fetchInventoryFromSupabase(),
        fetchLogsFromSupabase(),
        fetchActiveLotsFromSupabase()
      ])

      // Fetch Requests and map snake_case to camelCase
      const { data: reqData, error: reqError } = await supabase
        .from('requests')
        .select('*')
        .order('date_requested', { ascending: false })
      
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

      // Compute Analytics Stats
      const calculated = calculateDashboardStats(invData, activeData, mappedRequests, labSettings)
      setStats(calculated)
    } catch (err) {
      console.error("Dashboard Refresh Error:", err)
    }
  }

  useEffect(() => {
    const checkSessionAndRole = async () => {
      setLoading(true)
      const { data: { session } } = await supabase.auth.getSession()
      
      if (!session) {
        router.push("/") 
      } else {
        setUser(session.user)
        
        // Fetch specific role from profiles table
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', session.user.id)
          .single()

        if (profile) {
          setUserRole(profile.role as "manager" | "technician")
        }

        await refreshData()
        setLoading(false)
      }
    }
    checkSessionAndRole()
  }, [router])

  // ── 3. FILTER LOGIC ──

  const sortedFlatInventory = inventory.flatMap(g => g.lots.map(l => ({ ...l, itemName: g.name || "Unknown", itemId: g.itemId })))
    .filter(lot => {
      const matchSearch = (lot.itemName || "").toLowerCase().includes(searchQuery.toLowerCase()) || (lot.lot || "").toLowerCase().includes(searchQuery.toLowerCase())
      const matchItem = selectedItems.size === 0 || selectedItems.has(lot.itemName)
      const matchExpiry = expiryFilter === "all" || (daysUntilExpiry(lot.expiry) <= Number(expiryFilter) && daysUntilExpiry(lot.expiry) > 0)
      return matchSearch && matchItem && matchExpiry
    })
    .sort((a, b) => (a.itemName || "").localeCompare(b.itemName || ""))

  const filteredLotsInUse = lotsInUse.filter(lot => {
    const matchSearch = (lot.itemName || "").toLowerCase().includes(searchQuery.toLowerCase()) || (lot.lotNumber || "").toLowerCase().includes(searchQuery.toLowerCase())
    const matchItem = selectedItems.size === 0 || selectedItems.has(lot.itemName)
    const effectiveExpiry = getEarliestExpiry(lot.workingExpiryDate, lot.actualExpiryDate)
    const matchExpiry = expiryFilter === "all" || (daysUntilExpiry(effectiveExpiry) <= Number(expiryFilter) && daysUntilExpiry(effectiveExpiry) > 0)
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
    return matchSearch && matchItem && matchAction
  })

  const allItemNames = Array.from(new Set([
    ...inventory.map(g => g.name).filter(Boolean), 
    ...requests.map(r => r.itemName).filter(Boolean), 
    ...lotsInUse.map(l => l.itemName).filter(Boolean)
  ])).sort()

  // ── 4. RENDER ──
  return (
    <div className="flex h-screen bg-background overflow-hidden print:h-auto print:block print:bg-white">
      <div className="print:hidden">
        <DashboardSidebar activePage={activePage} setActivePage={setActivePage} userRole={userRole} />
      </div>

      <div className="flex flex-1 flex-col pl-64 print:pl-0 print:block">
        <div className="print:hidden">
          <DashboardHeader user={user} role={userRole} />
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
                      <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border-2 ${userRole === 'manager' ? 'border-primary/30 bg-primary/5 text-primary' : 'border-border bg-muted/50 text-muted-foreground'}`}>
                        {userRole === 'manager' ? <ShieldCheck className="size-5" /> : <User className="size-5" />}
                        <span className="text-[10px] font-black uppercase tracking-[0.2em]">{userRole} Credentials Active</span>
                      </div>
                    </div>
                    
                    <AlertCards stats={stats} />
                    
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                      <div className="lg:col-span-2 rounded-[2.5rem] border border-border bg-card p-10 flex flex-col justify-center items-center text-center text-muted-foreground">
                        <Activity className="size-12 mb-4 opacity-10" />
                        <p className="font-bold text-lg italic">System-wide inventory monitoring active.</p>
                        <p className="text-xs max-w-xs mt-2">Real-time stats are derived from current storage and bench tracking data.</p>
                      </div>
                      <ActivityFeed logs={activityLogs} />
                    </div>
                  </div>
                )}

                {activePage === "analytics" && userRole === "manager" && <AnalyticsTab stats={stats} requests={requests} inventory={inventory} />}
                {activePage === "mytasks" && userRole !== "manager" && <MyTasksTab />}
                {activePage === "labsharing" && <LabSharingTab />}

                {["inventory", "lotinuse", "requests", "activitylog"].includes(activePage) && (
                  <div className="flex gap-8 items-start print:block">
                    <div className="flex-1 min-w-0 print:w-full">
                      {activePage === "inventory" && <InventoryTab inventory={inventory} sortedFlatInventory={sortedFlatInventory} labSettings={labSettings} refreshData={refreshData} userRole={userRole} />}
                      {activePage === "lotinuse" && <LotInUseTab activeLots={filteredLotsInUse} inventory={inventory} refreshData={refreshData} userRole={userRole} />}
                      {activePage === "requests" && <RequestsTab requests={filteredRequests} refreshRequests={refreshData} userRole={userRole} />}
                      {activePage === "activitylog" && <ActivityLogTab logs={filteredLogs} />}
                    </div>
                    
                    <aside className="w-72 shrink-0 space-y-8 print:hidden">
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