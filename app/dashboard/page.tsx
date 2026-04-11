"use client"

import { useState } from "react"
import { Search, CalendarClock, CheckCircle2 } from "lucide-react"
import { 
  InventoryGroup, LabSettings, SidebarPage, 
  daysUntilExpiry, getEarliestExpiry, LotInUseEntry 
} from "@/lib/inventory-utils"

// UI Components
import { DashboardSidebar } from "@/components/dashboard/sidebar"
import { DashboardHeader } from "@/components/dashboard/header"
import { AlertCards } from "@/components/dashboard/alert-cards"
import { ActivityFeed } from "@/components/dashboard/activity-feed"
import InventoryTab from "@/components/dashboard/inventory-table"
import LotInUseTab from "@/components/dashboard/lot-in-use-table"

// ── INITIAL DATA ──
const INITIAL_INVENTORY: InventoryGroup[] = [
  { itemId: "g1", name: "HSA", lots: [{ lotId: "l1", lot: "13584230", expiry: "2027-08-20", receivedDate: "Mar 1, 2026", vendor: "Sigma Aldrich", storage: "Fridge C", status: "In Storage", notes: "", quantityType: "units_and_count", units: 1, unitLabel: "box", count: 20, countLabel: "vials" }] },
  { itemId: "g2", name: "BioBall", lots: [{ lotId: "l2", lot: "26542", expiry: "2027-04-10", receivedDate: "Mar 1, 2026", vendor: "Merck", storage: "Freezer A", status: "In Storage", notes: "", quantityType: "units_only", units: 5, unitLabel: "boxes", count: 1, countLabel: "" }] },
]

const MOCK_LOTS_IN_USE: LotInUseEntry[] = [
  { id: "u1", itemId: "g2", itemName: "BioBall", lotNumber: "26542-A", openedDate: "2026-03-20", workingExpiryDate: "2027-04-19", actualExpiryDate: "2028-04-10", quantityLeft: "15 vials", status: "Active" },
  { id: "u2", itemId: "g3", itemName: "SuperMix", lotNumber: "4928", openedDate: "2026-03-10", workingExpiryDate: "2026-10-10", actualExpiryDate: "2025-12-01", quantityLeft: "8%", status: "Active" },
  { id: "u3", itemId: "g4", itemName: "FACS Clean", lotNumber: "2687598", openedDate: "2026-02-28", workingExpiryDate: "2025-04-05", actualExpiryDate: "2028-10-15", quantityLeft: "450 mL", status: "Active" },
]

export default function DashboardPage() {
  const [activePage, setActivePage] = useState<SidebarPage>("dashboard")
  const [inventory, setInventory] = useState<InventoryGroup[]>(INITIAL_INVENTORY)
  const [labSettings] = useState<LabSettings>({ lowStockCount: 5, expiryWarnDays: 30, expiryUrgentDays: 7 })

  // ── FILTER STATE ──
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set()) 
  const [expiryFilter, setExpiryFilter] = useState("all") 

  // ── LOGIC: FILTER INVENTORY ──
  const sortedFlatInventory = inventory.flatMap(g => g.lots.map(l => ({ ...l, itemName: g.name, itemId: g.itemId })))
    .filter(lot => {
      const matchSearch = lot.itemName.toLowerCase().includes(searchQuery.toLowerCase()) || lot.lot.toLowerCase().includes(searchQuery.toLowerCase())
      const matchItem = selectedItems.size === 0 || selectedItems.has(lot.itemName)
      const days = daysUntilExpiry(lot.expiry)
      const matchExpiry = expiryFilter === "all" || (days <= Number(expiryFilter) && days > 0)
      return matchSearch && matchItem && matchExpiry
    })
    .sort((a, b) => a.itemName.localeCompare(b.itemName))

  // ── LOGIC: FILTER LOT IN USE ──
  const filteredLotsInUse = MOCK_LOTS_IN_USE.filter(lot => {
    const matchSearch = lot.itemName.toLowerCase().includes(searchQuery.toLowerCase()) || lot.lotNumber.toLowerCase().includes(searchQuery.toLowerCase())
    const matchItem = selectedItems.size === 0 || selectedItems.has(lot.itemName)
    const effectiveExpiry = getEarliestExpiry(lot.workingExpiryDate, lot.actualExpiryDate)
    const days = daysUntilExpiry(effectiveExpiry)
    const matchExpiry = expiryFilter === "all" || (days <= Number(expiryFilter) && days > 0)
    return matchSearch && matchItem && matchExpiry
  })

  const allItemNames = Array.from(new Set([...inventory.map(g => g.name), ...MOCK_LOTS_IN_USE.map(l => l.itemName)])).sort()

  return (
    <div className="flex h-screen bg-background overflow-hidden print:h-auto print:block print:bg-white">
      {/* Sidebar */}
      <div className="print:hidden">
        <DashboardSidebar activePage={activePage} setActivePage={setActivePage} />
      </div>

      <div className="flex flex-1 flex-col pl-64 print:pl-0 print:block">
        <div className="print:hidden">
          <DashboardHeader />
        </div>

        <main className="flex-1 overflow-y-auto p-8 print:overflow-visible print:p-0">
          <div className="max-w-[1600px] mx-auto space-y-8">
            
            {/* 1. DASHBOARD OVERVIEW */}
            {activePage === "dashboard" && (
              <div className="space-y-8 animate-in fade-in duration-500">
                <h1 className="text-2xl font-bold">Lab Overview</h1>
                <AlertCards />
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2 rounded-xl border border-border bg-card p-10 text-center text-muted-foreground">Analytics Dashboard</div>
                  <ActivityFeed />
                </div>
              </div>
            )}

            {/* 2. INVENTORY & LOT IN USE (Shared Filter Layout) */}
            {(activePage === "inventory" || activePage === "lotinuse") && (
              <div className="flex gap-8 items-start print:block">
                
                <div className="flex-1 min-w-0 print:w-full">
                  {activePage === "inventory" && (
                    <InventoryTab inventory={inventory} setInventory={setInventory} sortedFlatInventory={sortedFlatInventory} labSettings={labSettings} />
                  )}
                  {activePage === "lotinuse" && (
                    <LotInUseTab activeLots={filteredLotsInUse} inventory={inventory} />
                  )}
                </div>
                
                {/* RIGHT SIDE FILTERS */}
                <aside className="w-72 shrink-0 space-y-8 print:hidden">
                  <div className="rounded-2xl border border-border bg-card p-6 space-y-8 sticky top-0">
                    
                    {/* Search */}
                    <div className="space-y-3">
                      <p className="text-xs font-bold uppercase text-muted-foreground tracking-widest">Search</p>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                        <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search..." className="w-full h-10 pl-10 pr-3 text-sm bg-background border border-input rounded-xl focus:ring-2 focus:ring-primary outline-none" />
                      </div>
                    </div>

                    {/* Filter by Item */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                         <p className="text-xs font-bold uppercase text-muted-foreground tracking-widest">Filter by Item</p>
                         {selectedItems.size > 0 && <button onClick={() => setSelectedItems(new Set())} className="text-[10px] text-primary font-bold hover:underline">CLEAR</button>}
                      </div>
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                        {allItemNames.map(name => (
                          <button key={name} onClick={() => {
                            const next = new Set(selectedItems)
                            if (next.has(name)) next.delete(name); else next.add(name);
                            setSelectedItems(next)
                          }} className={`flex items-center gap-3 w-full px-3 py-2 text-sm rounded-xl transition-all ${selectedItems.has(name) ? "bg-primary/10 text-primary font-bold" : "hover:bg-muted text-muted-foreground"}`}>
                            <div className={`size-4 rounded-md border flex items-center justify-center ${selectedItems.has(name) ? "bg-primary border-primary text-primary-foreground" : "border-border"}`}>
                              {selectedItems.has(name) && <CheckCircle2 className="size-3" />}
                            </div>
                            {name}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Filter by Expiry (Positioned here as requested!) */}
                    <div className="space-y-3 pt-6 border-t border-border">
                      <p className="text-xs font-bold uppercase text-muted-foreground tracking-widest flex items-center gap-2">
                        <CalendarClock className="size-4" /> Expiry Timeline
                      </p>
                      <div className="space-y-1.5">
                        {[
                          { id: "all", label: "All Items" },
                          { id: "7", label: "Expiring in 7 Days" },
                          { id: "30", label: "Expiring in 30 Days" },
                          { id: "60", label: "Expiring in 60 Days" },
                        ].map((filter) => (
                          <button key={filter.id} onClick={() => setExpiryFilter(filter.id)} className={`w-full text-left px-4 py-2.5 text-sm rounded-xl transition-all ${expiryFilter === filter.id ? "bg-primary/10 text-primary font-bold" : "text-muted-foreground hover:bg-muted"}`}>
                            {filter.label}
                          </button>
                        ))}
                      </div>
                    </div>

                  </div>
                </aside>
              </div>
            )}

            {activePage === "activitylog" && <ActivityFeed />}

          </div>
        </main>
      </div>
    </div>
  )
}